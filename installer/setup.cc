// Installateur maison d'IA CLI Launcher : une fenetre sans bordure aux
// couleurs du logiciel (fond sombre, degrade turquoise de l'icone, petit
// terminal anime). Il contient l'installateur NSIS d'electron-builder et le
// lance en silencieux : les mises a jour automatiques (electron-updater)
// continuent d'utiliser NSIS, sans fenetre.
//
//   IA-CLI-Launcher-Setup-x.exe        installation (fenetre)
//   IA-CLI-Launcher-Setup-x.exe /S     sans fenetre
//
// Fabrication : scripts/build-setup.ps1 (compile ce fichier puis ajoute
// l'installateur NSIS a la fin de l'executable, voir Footer).
#define NOMINMAX
#include <windows.h>

#include <algorithm>
namespace Gdiplus {
using std::max;
using std::min;
}  // namespace Gdiplus

#include <dwmapi.h>
#include <objidl.h>
#include <gdiplus.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <tlhelp32.h>

#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "resource.h"

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

using namespace Gdiplus;

namespace {

constexpr wchar_t kName[] = L"IA CLI Launcher";
constexpr wchar_t kExe[] = L"IA CLI Launcher.exe";
constexpr wchar_t kSite[] = L"github.com/TheViking83230/ia-cli-launcher";
constexpr wchar_t kRegKey[] = L"Software\\IA CLI Launcher";

// Pied ajoute a la fin de l'executable par scripts/build-setup.ps1.
#pragma pack(push, 1)
struct Footer {
  uint64_t offset;     // debut de l'installateur NSIS
  uint64_t size;       // sa taille
  uint64_t app_bytes;  // taille de l'application installee (progression)
  char version[24];    // "0.1.42"
  char magic[8];       // "IACLIPK1"
};
#pragma pack(pop)
constexpr char kMagic[8] = {'I', 'A', 'C', 'L', 'I', 'P', 'K', '1'};

constexpr float kW = 800, kH = 480;

enum class Stage { kWelcome, kWorking, kDone, kError };
enum Control { kNone, kClose, kMinimize, kPrimary, kSecondary, kDesktop, kJarvis, kLaunch };

struct State {
  Stage stage = Stage::kWelcome;
  bool silent = false;
  bool demo = false;  // /demo : simule l'installation (apercu, rien n'est modifie)
  bool desktop = true;
  bool jarvis = false;
  bool launch = true;
  std::wstring self, dir, version;
  uint64_t pak_offset = 0, pak_size = 0, app_bytes = 0;
  std::atomic<float> progress{0};
  std::mutex lock;
  std::wstring status, error;
  HWND hwnd = nullptr;
  float scale = 1;
  int hover = kNone, pressed = kNone;
  struct Hit {
    int id;
    RectF r;
  };
  std::vector<Hit> hits;
  ULONGLONG start = GetTickCount64();
  ULONGLONG stage_at = GetTickCount64();
  std::thread worker;
} g;

// --- Couleurs (celles de l'application) ---------------------------------------
const Color kBg(255, 11, 13, 16);
const Color kSurface(255, 18, 21, 27);
const Color kText(255, 232, 234, 238);
const Color kDim(255, 139, 147, 161);
const Color kFaint(255, 92, 101, 115);
const Color kLine(255, 38, 44, 56);
const Color kTeal1(255, 94, 234, 212);
const Color kTeal2(255, 52, 211, 153);
const Color kCyan(255, 34, 211, 238);
const Color kRed(255, 255, 107, 107);
const Color kInk(255, 6, 26, 22);

Bitmap* g_logo = nullptr;
FontFamily* g_title = nullptr;
FontFamily* g_body = nullptr;
FontFamily* g_mono = nullptr;
Bitmap* g_back = nullptr;
Bitmap* g_frame = nullptr;

std::wstring Fmt(const wchar_t* f, ...) {
  wchar_t buf[1024];
  va_list a;
  va_start(a, f);
  _vsnwprintf_s(buf, _TRUNCATE, f, a);
  va_end(a);
  return buf;
}

Bitmap* LoadPng(int id) {
  HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(id), RT_RCDATA);
  if (!res) return nullptr;
  const DWORD size = SizeofResource(nullptr, res);
  const void* data = LockResource(LoadResource(nullptr, res));
  IStream* stream = SHCreateMemStream(static_cast<const BYTE*>(data), size);
  if (!stream) return nullptr;
  Bitmap* tmp = Bitmap::FromStream(stream);
  Bitmap* copy = nullptr;
  if (tmp && tmp->GetLastStatus() == Ok) {
    copy = new Bitmap(tmp->GetWidth(), tmp->GetHeight(), PixelFormat32bppPARGB);
    Graphics gc(copy);
    gc.DrawImage(tmp, 0, 0, tmp->GetWidth(), tmp->GetHeight());
  }
  delete tmp;
  stream->Release();
  return copy;
}

FontFamily* FirstFamily(std::initializer_list<const wchar_t*> names) {
  for (const wchar_t* name : names) {
    auto* f = new FontFamily(name);
    if (f->GetLastStatus() == Ok) return f;
    delete f;
  }
  return new FontFamily(L"Segoe UI");
}

void LoadAssets() {
  g_logo = LoadPng(IDR_LOGO);
  g_title = FirstFamily({L"Segoe UI Variable Display", L"Segoe UI"});
  g_body = FirstFamily({L"Segoe UI Variable Text", L"Segoe UI"});
  g_mono = FirstFamily({L"Cascadia Mono", L"Cascadia Code", L"Consolas"});
}

// --- Outils -------------------------------------------------------------------
bool Exists(const std::wstring& p) { return GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES; }

std::wstring Parent(const std::wstring& path) {
  const size_t i = path.find_last_of(L"\\/");
  return i == std::wstring::npos ? path : path.substr(0, i);
}

void SetStatus(const std::wstring& s) {
  std::lock_guard<std::mutex> l(g.lock);
  g.status = s;
}

void Fail(const std::wstring& s) {
  std::lock_guard<std::mutex> l(g.lock);
  g.error = s;
}

std::wstring KnownFolder(REFKNOWNFOLDERID id) {
  PWSTR p = nullptr;
  std::wstring out;
  if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &p))) out = p;
  CoTaskMemFree(p);
  return out;
}

// Dossier d'une installation existante (cle de desinstallation NSIS), sinon
// le dossier par defaut d'electron-builder (Program Files\IA CLI Launcher).
std::wstring FindInstallDir() {
  const wchar_t* root = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
  HKEY h;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, root, 0, KEY_READ | KEY_WOW64_64KEY, &h) == ERROR_SUCCESS) {
    wchar_t sub[256];
    for (DWORD i = 0;; ++i) {
      DWORD n = 256;
      if (RegEnumKeyExW(h, i, sub, &n, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
      wchar_t name[256], loc[MAX_PATH * 2];
      DWORD sn = sizeof(name), sl = sizeof(loc);
      if (RegGetValueW(h, sub, L"DisplayName", RRF_RT_REG_SZ, nullptr, name, &sn) == ERROR_SUCCESS &&
          _wcsicmp(name, kName) == 0 &&
          RegGetValueW(h, sub, L"InstallLocation", RRF_RT_REG_SZ, nullptr, loc, &sl) == ERROR_SUCCESS && loc[0]) {
        RegCloseKey(h);
        std::wstring dir = loc;
        while (!dir.empty() && (dir.back() == L'\\' || dir.back() == L'"')) dir.pop_back();
        if (!dir.empty() && dir.front() == L'"') dir.erase(0, 1);
        return dir;
      }
    }
    RegCloseKey(h);
  }
  return KnownFolder(FOLDERID_ProgramFilesX64) + L"\\" + kName;
}

uint64_t DirSize(const std::wstring& dir) {
  uint64_t total = 0;
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileExW((dir + L"\\*").c_str(), FindExInfoBasic, &fd, FindExSearchNameMatch, nullptr,
                              FIND_FIRST_EX_LARGE_FETCH);
  if (h == INVALID_HANDLE_VALUE) return 0;
  do {
    const std::wstring name = fd.cFileName;
    if (name == L"." || name == L"..") continue;
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      total += DirSize(dir + L"\\" + name);
    } else {
      total += (static_cast<uint64_t>(fd.nFileSizeHigh) << 32) | fd.nFileSizeLow;
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return total;
}

// IA CLI Launcher ouvert depuis |dir| : on lui laisse le temps de se fermer,
// puis on l'arrete (sinon NSIS ne peut pas remplacer ses fichiers).
void CloseRunning(const std::wstring& dir) {
  const std::wstring prefix = dir + L"\\";
  std::vector<HANDLE> procs;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  PROCESSENTRY32W pe = {sizeof(pe)};
  if (snap != INVALID_HANDLE_VALUE && Process32FirstW(snap, &pe)) {
    do {
      if (pe.th32ProcessID == GetCurrentProcessId()) continue;
      HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE | PROCESS_TERMINATE, FALSE,
                             pe.th32ProcessID);
      if (!p) continue;
      wchar_t path[MAX_PATH * 2];
      DWORD len = MAX_PATH * 2;
      if (QueryFullProcessImageNameW(p, 0, path, &len) && _wcsnicmp(path, prefix.c_str(), prefix.size()) == 0) {
        procs.push_back(p);
      } else {
        CloseHandle(p);
      }
    } while (Process32NextW(snap, &pe));
  }
  if (snap != INVALID_HANDLE_VALUE) CloseHandle(snap);
  if (procs.empty()) return;
  SetStatus(L"fermeture d'IA CLI Launcher…");
  for (HANDLE p : procs) {
    if (WaitForSingleObject(p, 1500) != WAIT_OBJECT_0) {
      TerminateProcess(p, 0);
      WaitForSingleObject(p, 5000);
    }
    CloseHandle(p);
  }
  Sleep(400);
}

bool ReadAt(HANDLE f, uint64_t offset, void* buf, DWORD size) {
  LARGE_INTEGER li;
  li.QuadPart = static_cast<LONGLONG>(offset);
  DWORD got = 0;
  return SetFilePointerEx(f, li, nullptr, FILE_BEGIN) && ReadFile(f, buf, size, &got, nullptr) && got == size;
}

bool FindPayload() {
  HANDLE f = CreateFileW(g.self.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
  if (f == INVALID_HANDLE_VALUE) return false;
  LARGE_INTEGER size;
  Footer footer = {};
  const bool ok = GetFileSizeEx(f, &size) && size.QuadPart > static_cast<LONGLONG>(sizeof(footer)) &&
                  ReadAt(f, size.QuadPart - sizeof(footer), &footer, sizeof(footer)) &&
                  memcmp(footer.magic, kMagic, 8) == 0;
  CloseHandle(f);
  if (ok) {
    g.pak_offset = footer.offset;
    g.pak_size = footer.size;
    g.app_bytes = footer.app_bytes;
    footer.version[sizeof(footer.version) - 1] = 0;
    const std::string v = footer.version;
    g.version = std::wstring(v.begin(), v.end());
  }
  return ok;
}

// Copie l'installateur NSIS contenu dans ce fichier vers |out| (0 -> 12 %).
bool ExtractNsis(const std::wstring& out) {
  HANDLE in = CreateFileW(g.self.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                          FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (in == INVALID_HANDLE_VALUE) return false;
  HANDLE o = CreateFileW(out.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  bool ok = o != INVALID_HANDLE_VALUE;
  LARGE_INTEGER li;
  li.QuadPart = static_cast<LONGLONG>(g.pak_offset);
  ok = ok && SetFilePointerEx(in, li, nullptr, FILE_BEGIN);
  std::vector<char> buf(4 << 20);
  uint64_t left = g.pak_size;
  while (ok && left) {
    const DWORD n = static_cast<DWORD>(std::min<uint64_t>(left, buf.size()));
    DWORD got = 0, put = 0;
    ok = ReadFile(in, buf.data(), n, &got, nullptr) && got == n && WriteFile(o, buf.data(), n, &put, nullptr) && put == n;
    left -= n;
    g.progress = 0.12f * static_cast<float>(g.pak_size - left) / static_cast<float>(std::max<uint64_t>(1, g.pak_size));
  }
  if (o != INVALID_HANDLE_VALUE) CloseHandle(o);
  CloseHandle(in);
  return ok;
}

void WriteJarvisChoice() {
  SYSTEMTIME t;
  GetLocalTime(&t);
  // Meme format que l'installateur NSIS : "1|AAAAMMJJhhmmss".
  const std::wstring value = Fmt(L"1|%04d%02d%02d%02d%02d%02d", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
  HKEY h;
  if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, kRegKey, 0, nullptr, 0, KEY_SET_VALUE | KEY_WOW64_64KEY, nullptr, &h,
                      nullptr) == ERROR_SUCCESS) {
    RegSetValueExW(h, L"Jarvis", 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()),
                   static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
    RegCloseKey(h);
  }
}

// Apercu : la fenetre deroule une fausse installation.
bool DemoInstall() {
  const wchar_t* steps[] = {L"préparation des fichiers…", L"installation des fichiers…", L"copie de l'application…",
                            L"voix et modules…", L"finalisation…"};
  for (int i = 0; i <= 100; ++i) {
    g.progress = i / 100.f;
    SetStatus(steps[std::min(4, i / 22)]);
    Sleep(60);
  }
  return true;
}

bool Install() {
  if (g.demo) return DemoInstall();
  wchar_t tmp[MAX_PATH];
  GetTempPathW(MAX_PATH, tmp);
  const std::wstring nsis = Fmt(L"%sIA-CLI-Launcher-%llu.exe", tmp, GetTickCount64());
  SetStatus(L"préparation des fichiers…");
  if (!ExtractNsis(nsis)) {
    DeleteFileW(nsis.c_str());
    Fail(L"Impossible de préparer l'installation (disque plein ou installateur endommagé). Télécharge-le de nouveau.");
    return false;
  }
  CloseRunning(g.dir);

  SetStatus(L"installation des fichiers…");
  std::wstring cmd = L"\"" + nsis + L"\" /S";
  STARTUPINFOW si = {sizeof(si)};
  PROCESS_INFORMATION pi = {};
  if (!CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, tmp, &si, &pi)) {
    DeleteFileW(nsis.c_str());
    Fail(L"Impossible de lancer l'installation.");
    return false;
  }
  CloseHandle(pi.hThread);
  // Progression : taille du dossier installe par rapport a celle attendue
  // (NSIS retire d'abord l'ancienne version : la barre ne recule jamais).
  const ULONGLONG begin = GetTickCount64();
  float best = 0.12f;
  while (WaitForSingleObject(pi.hProcess, 350) == WAIT_TIMEOUT) {
    const float bySize = g.app_bytes ? static_cast<float>(DirSize(g.dir)) / static_cast<float>(g.app_bytes) : 0.f;
    // Repli au temps (environ 40 s) si la taille n'avance pas.
    const float byTime = 1.f - std::exp(-static_cast<float>(GetTickCount64() - begin) / 25000.f);
    const float p = 0.12f + 0.84f * std::min(0.99f, std::max(bySize, byTime * 0.9f));
    best = std::max(best, p);
    g.progress = best;
    if (bySize > 0.5f) SetStatus(L"copie de l'application…");
    if (bySize > 0.9f) SetStatus(L"voix et modules…");
  }
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess);
  DeleteFileW(nsis.c_str());
  if (code != 0 || !Exists(g.dir + L"\\" + kExe)) {
    Fail(Fmt(L"L'installation n'a pas abouti (code %lu). Ferme IA CLI Launcher s'il est ouvert, puis réessaie.", code));
    return false;
  }

  SetStatus(L"finalisation…");
  g.progress = 0.97f;
  if (g.jarvis) WriteJarvisChoice();
  if (!g.desktop) {
    // Raccourci cree par NSIS (Bureau public pour une installation machine).
    DeleteFileW((KnownFolder(FOLDERID_PublicDesktop) + L"\\" + kName + L".lnk").c_str());
    DeleteFileW((KnownFolder(FOLDERID_Desktop) + L"\\" + kName + L".lnk").c_str());
  }
  g.progress = 1.f;
  return true;
}

void Launch() {
  const std::wstring exe = g.dir + L"\\" + kExe;
  STARTUPINFOW si = {sizeof(si)};
  PROCESS_INFORMATION pi = {};
  std::wstring cmd = L"\"" + exe + L"\"";
  if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, g.dir.c_str(), &si, &pi)) {
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
  }
}

void SetStage(Stage s) {
  g.stage = s;
  g.stage_at = GetTickCount64();
  if (g.hwnd) InvalidateRect(g.hwnd, nullptr, FALSE);
}

void StartWork() {
  SetStage(Stage::kWorking);
  g.progress = 0;
  if (g.worker.joinable()) g.worker.join();
  g.worker = std::thread([] {
    const bool ok = Install();
    SetStage(ok ? Stage::kDone : Stage::kError);
    if (ok && g.launch && !g.demo && g.hwnd) PostMessageW(g.hwnd, WM_APP, 0, 0);
  });
}

// --- Dessin -------------------------------------------------------------------
void RoundRect(GraphicsPath* p, RectF r, float rad) {
  const float d = rad * 2;
  p->AddArc(r.X, r.Y, d, d, 180, 90);
  p->AddArc(r.X + r.Width - d, r.Y, d, d, 270, 90);
  p->AddArc(r.X + r.Width - d, r.Y + r.Height - d, d, d, 0, 90);
  p->AddArc(r.X, r.Y + r.Height - d, d, d, 90, 90);
  p->CloseFigure();
}

LinearGradientBrush* TealBrush(RectF r) {
  auto* b = new LinearGradientBrush(PointF(r.X - 1, r.Y), PointF(r.X + r.Width + 1, r.Y + r.Height), kTeal1, kCyan);
  Color colors[] = {kTeal1, kTeal2, kCyan};
  REAL pos[] = {0, 0.5f, 1};
  b->SetInterpolationColors(colors, pos, 3);
  return b;
}

void Text(Graphics& gr, const std::wstring& s, FontFamily* fam, float size, int style, const Color& c, RectF r,
          StringAlignment align = StringAlignmentNear, StringAlignment valign = StringAlignmentNear) {
  Font font(fam, size, style, UnitPixel);
  SolidBrush brush(c);
  StringFormat fmt;
  fmt.SetAlignment(align);
  fmt.SetLineAlignment(valign);
  fmt.SetTrimming(StringTrimmingEllipsisCharacter);
  gr.DrawString(s.c_str(), -1, &font, r, &fmt, &brush);
}

void Glow(Graphics& gr, float cx, float cy, float rad, Color c) {
  GraphicsPath p;
  p.AddEllipse(cx - rad, cy - rad, rad * 2, rad * 2);
  PathGradientBrush b(&p);
  b.SetCenterColor(c);
  Color edge(0, c.GetR(), c.GetG(), c.GetB());
  INT n = 1;
  b.SetSurroundColors(&edge, &n);
  gr.FillPath(&b, &p);
}

void BuildBackground(int w, int h) {
  delete g_back;
  g_back = new Bitmap(w, h, PixelFormat32bppPARGB);
  Graphics gr(g_back);
  gr.SetSmoothingMode(SmoothingModeAntiAlias);
  gr.ScaleTransform(g.scale, g.scale);
  SolidBrush bg(kBg);
  gr.FillRectangle(&bg, 0.f, 0.f, kW, kH);
  // Panneau gauche legerement plus clair.
  SolidBrush side(kSurface);
  gr.FillRectangle(&side, 0.f, 0.f, 300.f, kH);
  Pen sep(kLine, 1);
  gr.DrawLine(&sep, 300.f, 0.f, 300.f, kH);
  Glow(gr, 150, 190, 210, Color(60, 52, 211, 153));
  Glow(gr, 820, -40, 260, Color(30, 34, 211, 238));
  // Trame de points.
  SolidBrush dot(Color(20, 255, 255, 255));
  for (float y = 14; y < kH; y += 18) {
    for (float x = 14; x < kW; x += 18) gr.FillRectangle(&dot, x, y, 1.4f, 1.4f);
  }
  // Fines lignes de balayage (ecran de terminal).
  gr.ResetTransform();
  SolidBrush scan(Color(22, 0, 0, 0));
  for (int y = 0; y < h; y += 3) gr.FillRectangle(&scan, 0, y, w, 1);
  gr.ScaleTransform(g.scale, g.scale);
  // Lisere degrade en haut.
  RectF top(0, 0, kW, 2.5f);
  LinearGradientBrush* b = TealBrush(top);
  gr.FillRectangle(b, top);
  delete b;
  Pen border(Color(255, 32, 38, 48), 1);
  gr.DrawRectangle(&border, 0.5f, 0.5f, kW - 1, kH - 1);
}

void Hit(int id, RectF r) { g.hits.push_back({id, r}); }

void Button(Graphics& gr, int id, RectF r, const std::wstring& label, bool primary, ULONGLONG t) {
  Hit(id, r);
  const bool hover = g.hover == id, down = g.pressed == id && hover;
  GraphicsPath p;
  RoundRect(&p, r, 10);
  if (primary) {
    if (hover) Glow(gr, r.X + r.Width / 2, r.Y + r.Height / 2, r.Width * 0.75f, Color(55, 52, 211, 153));
    LinearGradientBrush* b = TealBrush(r);
    gr.FillPath(b, &p);
    delete b;
    // Reflet qui traverse le bouton.
    const float phase = std::fmod(t / 2200.0f, 1.0f);
    gr.SetClip(&p);
    LinearGradientBrush shine(PointF(r.X - 60 + phase * (r.Width + 120), r.Y),
                              PointF(r.X + phase * (r.Width + 120), r.Y), Color(0, 255, 255, 255),
                              Color(0, 255, 255, 255));
    Color sc[] = {Color(0, 255, 255, 255), Color(70, 255, 255, 255), Color(0, 255, 255, 255)};
    REAL sp[] = {0, 0.5f, 1};
    shine.SetInterpolationColors(sc, sp, 3);
    gr.FillRectangle(&shine, r);
    gr.ResetClip();
    if (down) {
      SolidBrush dark(Color(40, 0, 0, 0));
      gr.FillPath(&dark, &p);
    }
    Text(gr, label, g_title, 15, FontStyleBold, kInk, r, StringAlignmentCenter, StringAlignmentCenter);
  } else {
    SolidBrush b(Color(hover ? 34 : 14, 255, 255, 255));
    gr.FillPath(&b, &p);
    Pen border(hover ? Color(255, 70, 80, 96) : kLine, 1);
    gr.DrawPath(&border, &p);
    Text(gr, label, g_body, 14, FontStyleRegular, hover ? kText : kDim, r, StringAlignmentCenter, StringAlignmentCenter);
  }
}

void Check(Graphics& gr, int id, float x, float y, const std::wstring& label, const std::wstring& sub, bool on) {
  RectF r(x, y, 440, sub.empty() ? 24.f : 40.f);
  Hit(id, r);
  const bool hover = g.hover == id;
  RectF box(x, y + 2, 20, 20);
  GraphicsPath p;
  RoundRect(&p, box, 5);
  if (on) {
    LinearGradientBrush* b = TealBrush(box);
    gr.FillPath(b, &p);
    delete b;
    Pen tick(kInk, 2.4f);
    tick.SetStartCap(LineCapRound);
    tick.SetEndCap(LineCapRound);
    tick.SetLineJoin(LineJoinRound);
    PointF pts[] = {PointF(x + 5, y + 12.5f), PointF(x + 8.6f, y + 16), PointF(x + 15, y + 8.5f)};
    gr.DrawLines(&tick, pts, 3);
  } else {
    SolidBrush fill(Color(10, 255, 255, 255));
    gr.FillPath(&fill, &p);
    Pen border(hover ? Color(255, 94, 234, 212) : Color(255, 70, 80, 96), 1.4f);
    gr.DrawPath(&border, &p);
  }
  Text(gr, label, g_body, 14.5f, FontStyleRegular, hover ? kText : Color(255, 205, 210, 218), RectF(x + 32, y + 1, 400, 22));
  if (!sub.empty()) Text(gr, sub, g_body, 12, FontStyleRegular, kFaint, RectF(x + 32, y + 21, 400, 18));
}

// Petit terminal qui tape les commandes des IA prises en charge.
void DrawTerminal(Graphics& gr, RectF r, ULONGLONG t) {
  GraphicsPath p;
  RoundRect(&p, r, 10);
  SolidBrush bg(Color(235, 8, 10, 13));
  gr.FillPath(&bg, &p);
  Pen border(kLine, 1);
  gr.DrawPath(&border, &p);
  // Pastilles de fenetre.
  const Color dots[] = {Color(255, 255, 95, 87), Color(255, 254, 188, 46), Color(255, 40, 200, 64)};
  for (int i = 0; i < 3; ++i) {
    SolidBrush d(Color(150, dots[i].GetR(), dots[i].GetG(), dots[i].GetB()));
    gr.FillEllipse(&d, r.X + 12 + i * 14.f, r.Y + 10, 8.f, 8.f);
  }
  static const wchar_t* cmds[] = {L"claude", L"codex", L"gemini", L"qwen", L"aider", L"opencode"};
  const int n = 6;
  const ULONGLONG per = 1700;
  const int current = static_cast<int>((t / per) % n);
  const float local = static_cast<float>(t % per);
  float y = r.Y + 30;
  // Lignes deja tapees (les deux precedentes), puis la ligne en cours.
  for (int k = 2; k >= 0; --k) {
    const int idx = (current - k + n * 4) % n;
    std::wstring cmd = cmds[idx];
    if (k == 0) {
      const size_t shown = std::min<size_t>(cmd.size(), static_cast<size_t>(local / 90));
      cmd = cmd.substr(0, shown);
    }
    Text(gr, L"❯", g_mono, 13, FontStyleRegular, k == 0 ? kTeal2 : kFaint, RectF(r.X + 14, y, 20, 20));
    Text(gr, cmd, g_mono, 13, FontStyleRegular, k == 0 ? kText : kFaint, RectF(r.X + 32, y, r.Width - 40, 20));
    if (k == 0 && (t / 480) % 2 == 0) {
      Font f(g_mono, 13, FontStyleRegular, UnitPixel);
      RectF bounds;
      gr.MeasureString(cmd.c_str(), -1, &f, PointF(0, 0), &bounds);
      SolidBrush caret(kTeal1);
      gr.FillRectangle(&caret, r.X + 32 + (cmd.empty() ? 2 : bounds.Width - 2), y + 3, 7.f, 14.f);
    }
    y += 22;
  }
}

void DrawLogo(Graphics& gr, RectF r, ULONGLONG t) {
  const float bob = std::sin(t / 950.0f) * 4;
  const float pulse = 0.5f + 0.5f * std::sin(t / 700.0f);
  Glow(gr, r.X + r.Width / 2, r.Y + r.Height / 2 + bob, r.Width * 0.85f, Color(static_cast<BYTE>(45 + pulse * 35), 52, 211, 153));
  if (!g_logo) return;
  const float iw = static_cast<float>(g_logo->GetWidth()), ih = static_cast<float>(g_logo->GetHeight());
  gr.DrawImage(g_logo, RectF(r.X, r.Y + bob, r.Width, r.Height), 0, 0, iw, ih, UnitPixel);
}

void DrawTitle(Graphics& gr, PointF at) {
  GraphicsPath path;
  StringFormat fmt;
  path.AddString(L"IA CLI", -1, g_title, FontStyleBold, 64, at, &fmt);
  RectF bounds;
  path.GetBounds(&bounds);
  LinearGradientBrush* b = TealBrush(bounds);
  gr.FillPath(b, &path);
  delete b;
  // "LAUNCHER" en capitales espacees.
  Font f(g_mono, 15, FontStyleRegular, UnitPixel);
  SolidBrush c(kText);
  const wchar_t* word = L"L A U N C H E R";
  gr.DrawString(word, -1, &f, PointF(bounds.X + bounds.Width + 16, bounds.Y + bounds.Height - 22), &c);
}

void Paint(Graphics& gr) {
  const ULONGLONG t = GetTickCount64();
  g.hits.clear();
  gr.SetSmoothingMode(SmoothingModeAntiAlias);
  gr.SetTextRenderingHint(TextRenderingHintAntiAliasGridFit);
  gr.SetInterpolationMode(InterpolationModeHighQualityBicubic);
  gr.SetPixelOffsetMode(PixelOffsetModeHalf);
  gr.DrawImage(g_back, 0, 0, static_cast<INT>(g_back->GetWidth()), static_cast<INT>(g_back->GetHeight()));
  gr.ScaleTransform(g.scale, g.scale);

  // Barre du haut.
  Text(gr, L"ia-cli-launcher  ·  installation", g_mono, 12, FontStyleRegular, kDim, RectF(20, 14, 300, 18));
  auto top_button = [&](int id, float x, bool close) {
    RectF r(x, 6, 38, 30);
    Hit(id, r);
    if (g.hover == id) {
      SolidBrush b(close ? Color(255, 196, 43, 28) : Color(30, 255, 255, 255));
      gr.FillRectangle(&b, r);
    }
    Pen pen(Color(255, 205, 210, 218), 1.2f);
    const float cx = x + 19, cy = 21;
    if (close) {
      gr.DrawLine(&pen, cx - 5, cy - 5, cx + 5, cy + 5);
      gr.DrawLine(&pen, cx - 5, cy + 5, cx + 5, cy - 5);
    } else {
      gr.DrawLine(&pen, cx - 5, cy, cx + 5, cy);
    }
  };
  top_button(kMinimize, kW - 84, false);
  if (g.stage != Stage::kWorking) top_button(kClose, kW - 46, true);

  // Colonne gauche : icone et terminal.
  DrawLogo(gr, RectF(80, 70, 140, 140), t);
  DrawTerminal(gr, RectF(32, 262, 236, 108), t);
  Text(gr, kSite, g_mono, 10.5f, FontStyleRegular, kFaint, RectF(20, kH - 30, 270, 16));

  // Colonne droite.
  const float x = 336;
  DrawTitle(gr, PointF(x - 6, 52));
  Text(gr, L"Tes IA en ligne de commande, réunies au même endroit.", g_body, 14, FontStyleRegular, kDim,
       RectF(x, 134, 440, 20));
  {
    const std::wstring badge = g.version.empty() ? L"version" : L"v" + g.version;
    RectF b(x, 164, 86, 24);
    GraphicsPath p;
    RoundRect(&p, b, 12);
    SolidBrush fill(Color(28, 52, 211, 153));
    gr.FillPath(&fill, &p);
    Pen border(Color(120, 52, 211, 153), 1);
    gr.DrawPath(&border, &p);
    Text(gr, badge, g_mono, 12, FontStyleRegular, kTeal1, b, StringAlignmentCenter, StringAlignmentCenter);
  }

  std::wstring status, error;
  {
    std::lock_guard<std::mutex> l(g.lock);
    status = g.status;
    error = g.error;
  }
  const float y0 = 214;
  const RectF primary(x, 398, 210, 48), secondary(x + 224, 398, 120, 48);
  if (g.stage == Stage::kWelcome) {
    Check(gr, kDesktop, x, y0, L"Créer un raccourci sur le Bureau", L"", g.desktop);
    Check(gr, kJarvis, x, y0 + 36, L"Installer JARVIS", L"Interface façon Iron Man, avec voix (désactivable à tout moment)", g.jarvis);
    Check(gr, kLaunch, x, y0 + 88, L"Lancer IA CLI Launcher à la fin", L"", g.launch);
    Text(gr, L"DOSSIER", g_mono, 10.5f, FontStyleRegular, kFaint, RectF(x, y0 + 128, 80, 16));
    Text(gr, g.dir, g_mono, 12, FontStyleRegular, kDim, RectF(x, y0 + 144, 440, 18));
    Button(gr, kPrimary, primary, L"Installer", true, t);
    Button(gr, kSecondary, secondary, L"Annuler", false, t);
  } else if (g.stage == Stage::kWorking) {
    const float pct = std::min(1.0f, g.progress.load());
    Text(gr, L"Installation", g_title, 26, FontStyleBold, kText, RectF(x, y0, 300, 34));
    Text(gr, Fmt(L"%d %%", static_cast<int>(pct * 100)), g_mono, 24, FontStyleRegular, kTeal1, RectF(x, y0 + 2, 430, 34),
         StringAlignmentFar);
    RectF bar(x, y0 + 50, 430, 8);
    GraphicsPath track;
    RoundRect(&track, bar, 4);
    SolidBrush tb(Color(26, 255, 255, 255));
    gr.FillPath(&tb, &track);
    if (pct > 0.005f) {
      RectF fill(bar.X, bar.Y, std::max(8.f, bar.Width * pct), bar.Height);
      GraphicsPath fp;
      RoundRect(&fp, fill, 4);
      LinearGradientBrush* b = TealBrush(bar);
      gr.FillPath(b, &fp);
      delete b;
      Glow(gr, fill.X + fill.Width, bar.Y + 4, 18, Color(120, 94, 234, 212));
      // Reflet qui parcourt la barre.
      const float phase = std::fmod(t / 1400.0f, 1.0f);
      gr.SetClip(&fp);
      SolidBrush shine(Color(70, 255, 255, 255));
      gr.FillRectangle(&shine, fill.X + phase * (fill.Width + 60) - 60, bar.Y, 40.f, bar.Height);
      gr.ResetClip();
    }
    Text(gr, L"$ " + status, g_mono, 12.5f, FontStyleRegular, kDim, RectF(x, y0 + 72, 430, 18));
    const bool blink = (t / 450) % 2 == 0;
    Text(gr, blink ? L"> ne ferme pas cette fenêtre_" : L"> ne ferme pas cette fenêtre", g_mono, 12, FontStyleRegular,
         kFaint, RectF(x, y0 + 100, 430, 18));
  } else if (g.stage == Stage::kDone) {
    Text(gr, L"C'est prêt !", g_title, 34, FontStyleBold, kText, RectF(x, y0 - 4, 430, 44));
    Text(gr, L"IA CLI Launcher est installé. Choisis un dossier, une IA, et c'est parti.", g_body, 14.5f, FontStyleRegular,
         Color(255, 205, 210, 218), RectF(x, y0 + 46, 430, 40));
    Text(gr, L"Ctrl+T  nouvelle session   ·   Ctrl+K  actions", g_mono, 12, FontStyleRegular, kFaint,
         RectF(x, y0 + 96, 440, 18));
    Button(gr, kPrimary, primary, L"Lancer IA CLI Launcher", true, t);
    Button(gr, kSecondary, secondary, L"Fermer", false, t);
  } else {
    Text(gr, L"Oups…", g_title, 34, FontStyleBold, kRed, RectF(x, y0 - 4, 430, 44));
    Text(gr, error.empty() ? L"L'installation n'a pas abouti." : error, g_body, 14, FontStyleRegular,
         Color(255, 230, 210, 214), RectF(x, y0 + 46, 430, 70));
    Button(gr, kPrimary, primary, L"Réessayer", true, t);
    Button(gr, kSecondary, secondary, L"Fermer", false, t);
  }
}

void Render(HWND hwnd, HDC hdc) {
  RECT rc;
  GetClientRect(hwnd, &rc);
  const int w = rc.right, h = rc.bottom;
  if (w <= 0 || h <= 0) return;
  if (!g_back || static_cast<int>(g_back->GetWidth()) != w || static_cast<int>(g_back->GetHeight()) != h) {
    BuildBackground(w, h);
    delete g_frame;
    g_frame = new Bitmap(w, h, PixelFormat32bppPARGB);
  }
  {
    Graphics gr(g_frame);
    Paint(gr);
  }
  Graphics screen(hdc);
  screen.DrawImage(g_frame, 0, 0, w, h);
}

// --- Fenetre -------------------------------------------------------------------
void Quit(HWND hwnd) {
  if (g.stage == Stage::kWorking) return;
  DestroyWindow(hwnd);
}

void Click(HWND hwnd, int id) {
  switch (id) {
    case kClose:
      Quit(hwnd);
      break;
    case kMinimize:
      ShowWindow(hwnd, SW_MINIMIZE);
      break;
    case kDesktop:
      g.desktop = !g.desktop;
      break;
    case kJarvis:
      g.jarvis = !g.jarvis;
      break;
    case kLaunch:
      g.launch = !g.launch;
      break;
    case kPrimary:
      if (g.stage == Stage::kWelcome || g.stage == Stage::kError) {
        {
          std::lock_guard<std::mutex> l(g.lock);
          g.error.clear();
        }
        StartWork();
      } else if (g.stage == Stage::kDone) {
        if (!g.demo) Launch();
        Quit(hwnd);
      }
      break;
    case kSecondary:
      Quit(hwnd);
      break;
  }
  InvalidateRect(hwnd, nullptr, FALSE);
}

int HitTest(HWND hwnd, LPARAM lp, bool screen) {
  POINT pt = {static_cast<short>(LOWORD(lp)), static_cast<short>(HIWORD(lp))};
  if (screen) ScreenToClient(hwnd, &pt);
  const float x = pt.x / g.scale, y = pt.y / g.scale;
  for (const auto& h : g.hits) {
    if (h.r.Contains(x, y)) return h.id;
  }
  return kNone;
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_NCHITTEST: {
      const LRESULT hit = DefWindowProcW(hwnd, msg, wp, lp);
      if (hit == HTCLIENT && HitTest(hwnd, lp, true) == kNone) return HTCAPTION;
      return hit;
    }
    case WM_MOUSEMOVE: {
      const int id = HitTest(hwnd, lp, false);
      if (id != g.hover) {
        g.hover = id;
        TRACKMOUSEEVENT tme = {sizeof(tme), TME_LEAVE, hwnd, 0};
        TrackMouseEvent(&tme);
        SetCursor(LoadCursorW(nullptr, id != kNone ? IDC_HAND : IDC_ARROW));
      }
      return 0;
    }
    case WM_SETCURSOR:
      if (LOWORD(lp) == HTCLIENT) {
        SetCursor(LoadCursorW(nullptr, g.hover != kNone ? IDC_HAND : IDC_ARROW));
        return TRUE;
      }
      break;
    case WM_MOUSELEAVE:
      g.hover = kNone;
      return 0;
    case WM_LBUTTONDOWN:
      g.pressed = HitTest(hwnd, lp, false);
      SetCapture(hwnd);
      return 0;
    case WM_LBUTTONUP: {
      ReleaseCapture();
      const int id = HitTest(hwnd, lp, false);
      const int pressed = g.pressed;
      g.pressed = kNone;
      if (id != kNone && id == pressed) Click(hwnd, id);
      return 0;
    }
    case WM_KEYDOWN:
      if (wp == VK_RETURN) Click(hwnd, kPrimary);
      if (wp == VK_ESCAPE) Quit(hwnd);
      return 0;
    case WM_APP:
      // Installation terminee avec « Lancer a la fin » coche.
      Launch();
      SetTimer(hwnd, 2, 1200, nullptr);
      return 0;
    case WM_TIMER:
      if (wp == 2) {
        DestroyWindow(hwnd);
        return 0;
      }
      InvalidateRect(hwnd, nullptr, FALSE);
      return 0;
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC hdc = BeginPaint(hwnd, &ps);
      Render(hwnd, hdc);
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_DPICHANGED: {
      g.scale = HIWORD(wp) / 96.0f;
      const RECT* r = reinterpret_cast<RECT*>(lp);
      SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      delete g_back;
      g_back = nullptr;
      return 0;
    }
    case WM_CLOSE:
      Quit(hwnd);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

int RunWindow(HINSTANCE inst) {
  WNDCLASSEXW wc = {sizeof(wc)};
  wc.style = CS_DROPSHADOW;
  wc.lpfnWndProc = WndProc;
  wc.hInstance = inst;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(IDI_APP));
  wc.hIconSm = wc.hIcon;
  wc.lpszClassName = L"IaCliLauncherSetup";
  RegisterClassExW(&wc);

  POINT origin = {0, 0};
  HMONITOR mon = MonitorFromPoint(origin, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO mi = {sizeof(mi)};
  GetMonitorInfoW(mon, &mi);
  UINT dpi = 96;
  if (HDC screen = GetDC(nullptr)) {
    dpi = GetDeviceCaps(screen, LOGPIXELSX);
    ReleaseDC(nullptr, screen);
  }
  g.scale = dpi / 96.0f;
  const int w = static_cast<int>(kW * g.scale), h = static_cast<int>(kH * g.scale);
  const RECT& wa = mi.rcWork;
  g.hwnd = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, L"Installation d'IA CLI Launcher",
                           WS_POPUP | WS_MINIMIZEBOX | WS_SYSMENU, wa.left + (wa.right - wa.left - w) / 2,
                           wa.top + (wa.bottom - wa.top - h) / 2, w, h, nullptr, nullptr, inst, nullptr);
  const UINT real = GetDpiForWindow(g.hwnd);
  if (real && real != dpi) {
    g.scale = real / 96.0f;
    SetWindowPos(g.hwnd, nullptr, 0, 0, static_cast<int>(kW * g.scale), static_cast<int>(kH * g.scale),
                 SWP_NOMOVE | SWP_NOZORDER);
  }
  const DWORD round = 2;  // coins arrondis de Windows 11
  DwmSetWindowAttribute(g.hwnd, 33, &round, sizeof(round));
  const BOOL dark = TRUE;
  DwmSetWindowAttribute(g.hwnd, 20, &dark, sizeof(dark));
  ShowWindow(g.hwnd, SW_SHOW);
  SetTimer(g.hwnd, 1, 33, nullptr);

  MSG m;
  while (GetMessageW(&m, nullptr, 0, 0) > 0) {
    TranslateMessage(&m);
    DispatchMessageW(&m);
  }
  if (g.worker.joinable()) g.worker.join();
  return g.stage == Stage::kError ? 1 : 0;
}

bool HasArg(const wchar_t* cmd, const wchar_t* arg) {
  const size_t n = wcslen(arg);
  for (const wchar_t* p = cmd; (p = StrStrIW(p, arg)) != nullptr; p += n) {
    const wchar_t after = p[n];
    if ((p == cmd || p[-1] == L' ') && (after == 0 || after == L' ')) return true;
  }
  return false;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  const wchar_t* cmd = GetCommandLineW();
  wchar_t self[MAX_PATH * 2];
  GetModuleFileNameW(nullptr, self, MAX_PATH * 2);
  g.self = self;
  g.demo = HasArg(cmd, L"/demo");
  g.silent = HasArg(cmd, L"/S") || HasArg(cmd, L"/SILENT") || HasArg(cmd, L"/VERYSILENT");
  if (!FindPayload()) {
    MessageBoxW(nullptr, L"Installateur incomplet : télécharge-le de nouveau.", kName, MB_ICONERROR);
    return 2;
  }
  g.dir = FindInstallDir();

  int code = 0;
  if (g.silent) {
    g.launch = false;
    code = Install() ? 0 : 1;
  } else {
    GdiplusStartupInput gsi;
    ULONG_PTR token = 0;
    GdiplusStartup(&token, &gsi, nullptr);
    LoadAssets();
    code = RunWindow(inst);
    delete g_back;
    delete g_frame;
    delete g_logo;
    delete g_title;
    delete g_body;
    delete g_mono;
    GdiplusShutdown(token);
  }
  CoUninitialize();
  return code;
}
