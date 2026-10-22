// Icone "coeur" de JARVIS : reacteur anime qui reagit au son.
//
// Composant autonome (aucune dependance), pense pour la future interface
// vocale. Etats :
//  - "idle"      : en veille, respiration lente ;
//  - "listening" : a l'ecoute, les barres suivent le micro ;
//  - "thinking"  : reflexion, un arc lumineux tourne autour du reacteur ;
//  - "speaking"  : JARVIS parle, les barres suivent la voix jouee.
//
// Utilisation :
//   const core = new JarvisCore(element, { size: 320 });
//   core.setState("listening");
//   core.setAnalyser(analyserNode);   // source du niveau sonore (ou null)
//   core.destroy();
(function () {
  const BARS = 72;
  const STATE_COLORS = {
    idle: [56, 232, 255],
    listening: [56, 232, 255],
    thinking: [120, 170, 255],
    speaking: [190, 248, 255]
  };

  class JarvisCore {
    constructor(container, { size = 320 } = {}) {
      this.size = size;
      this.state = "idle";
      this.analyser = null;
      this.bins = null;
      this.values = new Float32Array(BARS);
      this.color = [...STATE_COLORS.idle];
      this.level = 0;
      this.start = performance.now();

      const ratio = window.devicePixelRatio || 1;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "jarvis-core";
      this.canvas.width = size * ratio;
      this.canvas.height = size * ratio;
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
      this.ctx = this.canvas.getContext("2d");
      this.ctx.scale(ratio, ratio);
      container.appendChild(this.canvas);

      this.frame = this.frame.bind(this);
      this.raf = requestAnimationFrame(this.frame);
    }

    setState(state) {
      if (STATE_COLORS[state]) {
        this.state = state;
      }
    }

    setAnalyser(analyser) {
      this.analyser = analyser;
      this.bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.canvas.remove();
    }

    // Valeur cible (0..1) de chaque barre selon l'etat.
    targets(time) {
      const targets = new Float32Array(BARS);
      const audio = (this.state === "listening" || this.state === "speaking") && this.analyser;
      if (audio) {
        this.analyser.getByteFrequencyData(this.bins);
        // Graves -> aigus sur une moitie, en miroir sur l'autre : forme symetrique.
        const usable = Math.floor(this.bins.length * 0.55);
        const half = BARS / 2;
        for (let i = 0; i < half; i += 1) {
          const bin = Math.floor((i / half) * usable);
          const value = Math.pow(this.bins[bin] / 255, 1.4);
          targets[i] = value;
          targets[BARS - 1 - i] = value;
        }
      } else if (this.state === "speaking") {
        // Parole sans source analysable (voix de Windows) : animation simulee.
        const syllable = 0.5 + 0.5 * Math.sin(time * 11) * Math.sin(time * 3.7);
        for (let i = 0; i < BARS / 2; i += 1) {
          const value = syllable * (0.25 + 0.35 * Math.abs(Math.sin(time * 6 + i * 0.45)));
          targets[i] = value;
          targets[BARS - 1 - i] = value;
        }
      } else if (this.state === "thinking") {
        for (let i = 0; i < BARS; i += 1) {
          const angle = (i / BARS) * Math.PI * 2;
          targets[i] = 0.08 + 0.55 * Math.pow(Math.max(0, Math.cos(angle - time * 3.2)), 10);
        }
      } else {
        for (let i = 0; i < BARS; i += 1) {
          targets[i] = 0.05 + 0.03 * Math.sin(time * 1.4 + i * 0.5);
        }
      }
      return targets;
    }

    frame(now) {
      const time = (now - this.start) / 1000;
      const { ctx, size } = this;
      const center = size / 2;

      // Lissage des barres (montee rapide, descente douce) et de la couleur.
      const targets = this.targets(time);
      let sum = 0;
      for (let i = 0; i < BARS; i += 1) {
        const speed = targets[i] > this.values[i] ? 0.45 : 0.12;
        this.values[i] += (targets[i] - this.values[i]) * speed;
        sum += this.values[i];
      }
      this.level += (sum / BARS - this.level) * 0.2;
      const goal = STATE_COLORS[this.state];
      for (let c = 0; c < 3; c += 1) {
        this.color[c] += (goal[c] - this.color[c]) * 0.08;
      }
      const [r, g, b] = this.color.map(Math.round);
      const rgba = (alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
      const idle = this.state === "idle";
      const breath = idle ? 0.5 + 0.5 * Math.sin(time * 1.2) : 1;

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(center, center);

      // Barres radiales.
      const inner = size * 0.3;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, size * 0.009);
      for (let i = 0; i < BARS; i += 1) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const length = size * 0.015 + this.values[i] * size * 0.16;
        ctx.strokeStyle = rgba(0.35 + this.values[i] * 0.65);
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        ctx.lineTo(Math.cos(angle) * (inner + length), Math.sin(angle) * (inner + length));
        ctx.stroke();
      }

      // Anneaux segmentes tournants (plus rapides en reflexion).
      const spin = this.state === "thinking" ? 2.2 : 1;
      const ring = (radius, width, dash, speed, alpha) => {
        ctx.save();
        ctx.rotate(time * speed * spin);
        ctx.setLineDash(dash);
        ctx.lineWidth = width;
        ctx.strokeStyle = rgba(alpha);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      };
      ring(size * 0.27, 1, [2, 6], 0.15, 0.5);
      ring(size * 0.235, size * 0.022, [size * 0.11, size * 0.03, size * 0.015, size * 0.03], -0.35, 0.75);
      ring(size * 0.19, 2, [size * 0.05, size * 0.02], 0.6, 0.6);
      ring(size * 0.15, size * 0.03, [size * 0.035, size * 0.012], -0.9, 0.55);

      // Coeur lumineux : grossit avec le son, respire en veille.
      const coreRadius = size * (0.075 + this.level * 0.05) * (idle ? 0.92 + 0.08 * breath : 1);
      ctx.setLineDash([]);
      ctx.shadowColor = rgba(1);
      ctx.shadowBlur = size * (0.05 + this.level * 0.12) * (idle ? 0.6 + 0.4 * breath : 1);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, coreRadius);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
      gradient.addColorStop(0.45, rgba(0.95));
      gradient.addColorStop(1, rgba(0.15));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  window.JarvisCore = JarvisCore;
})();
