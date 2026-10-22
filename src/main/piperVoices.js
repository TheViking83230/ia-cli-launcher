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

module.exports = { ENGINE_URLS, VOICES_BASE, VOICES };
