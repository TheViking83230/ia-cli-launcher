// Detection du mot d'activation « Hey Jarvis » (openWakeWord, local).
//
// Chaine de trois petits modeles ONNX executes par onnxruntime-web :
//   audio 16 kHz -> melspectrogramme -> embeddings (96) -> score « hey jarvis ».
// L'audio arrive par blocs de 80 ms (1280 echantillons) ; chaque bloc donne un
// score entre 0 et 1, sans attendre la fin de la phrase. « Jarvis », « Dis
// Jarvis » et « OK Jarvis » sont reconnus a part, par Whisper (renderer.js).
//
// Utilisation :
//   const detector = await WakeWordDetector.create(ort, { mel, embedding, wakeword });
//   const { hey } = await detector.process(float32Samples16k); // valeurs -1..1
(function (root) {
  const CHUNK = 1280;
  const MEL_CONTEXT = 160 * 3;
  const EMBEDDING_FRAMES = 76;
  const MODEL_FEATURES = 16;

  class WakeWordDetector {
    static async create(ort, models) {
      const options = { executionProviders: ["wasm"] };
      const [mel, embedding, wakeword] = await Promise.all([
        ort.InferenceSession.create(models.mel, options),
        ort.InferenceSession.create(models.embedding, options),
        ort.InferenceSession.create(models.wakeword, options)
      ]);
      return new WakeWordDetector(ort, mel, embedding, wakeword);
    }

    constructor(ort, mel, embedding, wakeword) {
      this.ort = ort;
      this.sessions = { mel, embedding, wakeword };
      this.reset();
    }

    reset() {
      this.pending = [];
      this.raw = new Float32Array(0);
      // Comme openWakeWord : tampon de melspectrogramme amorce a 1.
      this.melFrames = Array.from({ length: EMBEDDING_FRAMES }, () => new Float32Array(32).fill(1));
      this.features = [];
    }

    // samples : Float32Array 16 kHz (-1..1). Renvoie le meilleur score des blocs traites.
    async process(samples) {
      for (const value of samples) {
        this.pending.push(value * 32767);
      }
      let hey = 0;
      while (this.pending.length >= CHUNK) {
        hey = Math.max(hey, await this.processChunk(this.pending.splice(0, CHUNK)));
      }
      return { hey };
    }

    async processChunk(chunk) {
      const { ort, sessions } = this;
      const joined = new Float32Array(this.raw.length + chunk.length);
      joined.set(this.raw);
      joined.set(chunk, this.raw.length);
      const input = joined.slice(-(CHUNK + MEL_CONTEXT));
      this.raw = input;

      // Melspectrogramme du bloc (avec 30 ms de contexte), mis a l'echelle.
      const melOut = await sessions.mel.run({ [sessions.mel.inputNames[0]]: new ort.Tensor("float32", input, [1, input.length]) });
      const mel = melOut[sessions.mel.outputNames[0]];
      const frames = mel.dims[mel.dims.length - 2];
      for (let f = 0; f < frames; f += 1) {
        const frame = new Float32Array(32);
        for (let b = 0; b < 32; b += 1) {
          frame[b] = mel.data[f * 32 + b] / 10 + 2;
        }
        this.melFrames.push(frame);
      }
      if (this.melFrames.length > 970) {
        this.melFrames.splice(0, this.melFrames.length - 970);
      }

      // Embedding des 76 dernieres trames.
      const window = new Float32Array(EMBEDDING_FRAMES * 32);
      this.melFrames.slice(-EMBEDDING_FRAMES).forEach((frame, i) => window.set(frame, i * 32));
      const embOut = await sessions.embedding.run({
        [sessions.embedding.inputNames[0]]: new ort.Tensor("float32", window, [1, EMBEDDING_FRAMES, 32, 1])
      });
      this.features.push(Float32Array.from(embOut[sessions.embedding.outputNames[0]].data));
      if (this.features.length > 120) {
        this.features.shift();
      }
      if (this.features.length < MODEL_FEATURES) {
        return 0;
      }

      const features = new Float32Array(MODEL_FEATURES * 96);
      this.features.slice(-MODEL_FEATURES).forEach((feature, i) => features.set(feature, i * 96));
      const out = await sessions.wakeword.run({
        [sessions.wakeword.inputNames[0]]: new ort.Tensor("float32", features, [1, MODEL_FEATURES, 96])
      });
      return out[sessions.wakeword.outputNames[0]].data[0];
    }
  }

  root.WakeWordDetector = WakeWordDetector;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = WakeWordDetector;
  }
})(typeof window !== "undefined" ? window : globalThis);
