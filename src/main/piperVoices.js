// Moteur et voix Piper embarques dans l'application (sans dependance a
// Electron : partage avec scripts/fetch-voice.js, qui les telecharge au build).
const ENGINE_URLS = {
  win32: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
  linux: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
};

const VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR";

// Voix francaises connues ; "bundled" = embarquee dans l'installateur (chaque
// voix ajoute environ 60 Mo). Voix retenue par l'utilisateur : Tom.
const VOICES = [
  {
    id: "tom",
    label: "Tom",
    file: "fr_FR-tom-medium",
    dir: "tom/medium",
    bundled: true,
    license: "Licence AGPL v3 (source : git.bksp.space/Tjiho/French-tts-model-piper)"
  },
  { id: "gilles", label: "Gilles", file: "fr_FR-gilles-low", dir: "gilles/low", bundled: false, license: "Licence CC0 (libre)" },
  {
    id: "pierre",
    label: "Pierre",
    file: "fr_FR-upmc-medium",
    dir: "upmc/medium",
    speaker: 1,
    bundled: false,
    license: "Licence CC BY-SA 4.0 : voix « UPMC Pierre » (MaryTTS)"
  }
];

// Reconnaissance vocale (dictee) : whisper.cpp, executable et modele embarques.
const WHISPER = {
  urls: {
    win32: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
    linux: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz"
  },
  // Chemin de l'executable dans l'archive extraite.
  exe: {
    win32: "Release/whisper-cli.exe",
    linux: "whisper-bin-ubuntu-x64/whisper-cli"
  },
  // Modele "base" quantifie : 57 Mo, transcription francaise fiable et rapide
  // sans carte graphique.
  model: "ggml-base-q5_1.bin",
  modelUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin"
};

// Mot d'activation « Hey Jarvis » : modeles openWakeWord (executes dans la
// fenetre par onnxruntime-web, dont les fichiers sont copies depuis node_modules).
const WAKEWORD = {
  modelsBase: "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1",
  models: { mel: "melspectrogram.onnx", embedding: "embedding_model.onnx", wakeword: "hey_jarvis_v0.1.onnx" },
  ortFiles: ["ort.wasm.min.js", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]
};

module.exports = { ENGINE_URLS, VOICES_BASE, VOICES, WHISPER, WAKEWORD };
