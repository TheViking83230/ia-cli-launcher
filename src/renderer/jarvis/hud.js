// Interface JARVIS « reacteur au centre » : ecran plein facon Iron Man.
//
// Composant autonome alimente par l'application (provider) :
//   sessions()            -> [{ id, title, profile, accent, aiState, waitingFor, context, cwd, active }]
//   activity(ids)         -> { id: [{ at, kind, label }] }
//   stats()               -> etat du PC (processeur, memoire, carte graphique)
//   usage(profileId)      -> quotas de l'IA ({ available, windows: [{ label, usedPercent, resetsAt }] })
//   git(cwd)              -> { isRepo, branch, files }
//   focus(id)             -> ouvre le terminal en grand
//   newSession(), listen(), sendText(text), openSettings(), exit()
//
// Deux modes : "home" (HUD plein ecran) et "focus" (terminal en grand, le
// HUD se replie en bandeau). Sons d'interface synthetises (desactivables).
(function () {
  const KIND_ICONS = { read: "◧", edit: "✎", run: "▶", search: "⌕", web: "◍", agent: "⧉", think: "◌", say: "❝", other: "•" };
  const STATE_LABELS = { busy: "EN COURS", idle: "EN ATTENTE", waiting: "ATTEND TA RÉPONSE" };
  const HISTORY = 60;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function relativeTime(at) {
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60) {
      return `${seconds}s`;
    }
    if (seconds < 3600) {
      return `${Math.round(seconds / 60)}min`;
    }
    return `${Math.round(seconds / 3600)}h`;
  }

  function formatBytes(bytes) {
    return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} Go`;
  }

  // Petits sons d'interface (aucun fichier : oscillateurs).
  class HudSounds {
    constructor() {
      this.ctx = null;
    }

    get enabled() {
      try {
        return window.localStorage.getItem("jarvisHudSounds") !== "0";
      } catch {
        return true;
      }
    }

    play(kind) {
      if (!this.enabled) {
        return;
      }
      try {
        this.ctx ??= new AudioContext();
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const tones = {
          blip: [[1320, 0, 0.05, 0.04]],
          open: [[520, 0, 0.09, 0.05], [780, 0.07, 0.09, 0.05], [1170, 0.14, 0.12, 0.05]],
          close: [[1170, 0, 0.08, 0.04], [780, 0.06, 0.08, 0.04], [520, 0.12, 0.1, 0.04]],
          boot: [[220, 0, 0.6, 0.05], [330, 0.25, 0.5, 0.04], [660, 0.55, 0.35, 0.04], [990, 0.8, 0.4, 0.035]],
          tick: [[2400, 0, 0.02, 0.015]],
          alert: [[880, 0, 0.12, 0.05], [880, 0.18, 0.12, 0.05]]
        }[kind] || [];
        for (const [frequency, start, duration, volume] of tones) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = kind === "boot" ? "sawtooth" : "sine";
          osc.frequency.setValueAtTime(frequency, now + start);
          gain.gain.setValueAtTime(0.0001, now + start);
          gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = 3200;
          osc.connect(filter).connect(gain).connect(ctx.destination);
          osc.start(now + start);
          osc.stop(now + start + duration + 0.05);
        }
      } catch {
        // audio indisponible : sans importance
      }
    }
  }

  // Fond : grille hexagonale fixe (dessinee une fois), particules a 20 images/s
  // sur un calque leger ; le balayage radar est une rotation CSS (sans dessin).
  const PARTICLE_FPS = 20;

  class HudBackdrop {
    constructor(gridCanvas, particleCanvas) {
      this.gridCanvas = gridCanvas;
      this.canvas = particleCanvas;
      this.ctx = particleCanvas.getContext("2d");
      this.particles = Array.from({ length: 60 }, () => this.particle(true));
      this.running = false;
      this.resize = this.resize.bind(this);
      window.addEventListener("resize", this.resize);
    }

    particle(anywhere) {
      return {
        x: Math.random(),
        y: anywhere ? Math.random() : 1.05,
        speed: 0.0012 + Math.random() * 0.0035,
        size: 0.6 + Math.random() * 1.6,
        alpha: 0.15 + Math.random() * 0.45
      };
    }

    resize() {
      const width = this.gridCanvas.clientWidth;
      const height = this.gridCanvas.clientHeight;
      if (!width || !height || (width === this.width && height === this.height)) {
        return;
      }
      this.width = width;
      this.height = height;
      // Particules en pleine resolution inutile : 1 pixel par pixel CSS.
      this.canvas.width = width;
      this.canvas.height = height;
      this.drawGrid();
    }

    drawGrid() {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = this;
      this.gridCanvas.width = width * ratio;
      this.gridCanvas.height = height * ratio;
      const g = this.gridCanvas.getContext("2d");
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      const size = 26;
      const h = size * Math.sqrt(3);
      const cx = width / 2;
      const cy = height / 2;
      const maxDistance = Math.hypot(cx, cy);
      for (let row = -1; row * h * 0.5 < height + h; row += 1) {
        for (let col = -1; col * size * 3 < width + size * 3; col += 1) {
          const x = col * size * 3 + (row % 2 ? size * 1.5 : 0);
          const y = row * h * 0.5;
          const fade = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / maxDistance);
          g.strokeStyle = `rgba(56, 232, 255, ${0.025 + fade * 0.06})`;
          g.beginPath();
          for (let i = 0; i <= 6; i += 1) {
            const angle = (Math.PI / 3) * i;
            const px = x + size * Math.cos(angle);
            const py = y + size * Math.sin(angle);
            if (i) {
              g.lineTo(px, py);
            } else {
              g.moveTo(px, py);
            }
          }
          g.stroke();
        }
      }
    }

    start() {
      if (this.running) {
        return;
      }
      this.running = true;
      this.resize();
      this.timer = window.setInterval(() => {
        // Fenetre cachee ou reduite : rien a dessiner.
        if (!document.hidden) {
          this.draw();
        }
      }, 1000 / PARTICLE_FPS);
    }

    stop() {
      this.running = false;
      window.clearInterval(this.timer);
    }

    draw() {
      this.resize();
      const { ctx, width, height } = this;
      if (!width) {
        return;
      }
      ctx.clearRect(0, 0, width, height);
      for (const p of this.particles) {
        p.y -= p.speed;
        if (p.y < -0.05) {
          Object.assign(p, this.particle(false));
        }
        ctx.fillStyle = `rgba(150, 240, 255, ${p.alpha})`;
        ctx.fillRect(p.x * width, p.y * height, p.size * 1.4, p.size * 1.4);
      }
    }

    destroy() {
      this.stop();
      window.removeEventListener("resize", this.resize);
    }
  }

  // Petite courbe d'historique (processeur, carte graphique...).
  function drawSparkline(canvas, values, color) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (values.length < 2) {
      return;
    }
    const step = width / (HISTORY - 1);
    const offset = (HISTORY - values.length) * step;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = offset + index * step;
      const y = height - (Math.min(100, Math.max(0, value)) / 100) * (height - 2) - 1;
      if (index) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.lineTo(width, height);
    ctx.lineTo(offset, height);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, color.replace("1)", "0.25)"));
    fill.addColorStop(1, color.replace("1)", "0)"));
    ctx.shadowBlur = 0;
    ctx.fillStyle = fill;
    ctx.fill();
  }

  class JarvisHud {
    constructor(provider) {
      this.provider = provider;
      this.sounds = new HudSounds();
      this.mode = "home";
      this.visible = false;
      this.history = { cpu: [], gpu: [], memory: [], vram: [] };
      this.seenActions = new Set();
      this.voiceLines = [];
      this.usageCache = new Map();
      this.gitCache = new Map();
      this.timers = [];
      this.build();
    }

    build() {
      const root = el("div", "jh2");
      root.innerHTML = `
        <canvas class="jh2-backdrop"></canvas>
        <div class="jh2-sweep"></div>
        <canvas class="jh2-particles"></canvas>
        <div class="jh2-scanlines"></div>
        <div class="jh2-vignette"></div>
        <header class="jh2-top">
          <div class="jh2-brand">
            <span class="jh2-logo">J.A.R.V.I.S.</span>
            <span class="jh2-tagline">Just A Rather Very Intelligent System</span>
          </div>
          <div class="jh2-status"><i></i><span>SYSTÈMES EN LIGNE</span></div>
          <div class="jh2-clock"><strong></strong><span></span></div>
          <div class="jh2-actions">
            <button type="button" data-action="home" class="jh2-btn jh2-home-btn" title="Revenir au HUD">◂ HUD</button>
            <button type="button" data-action="sounds" class="jh2-btn" title="Sons d'interface"></button>
            <button type="button" data-action="settings" class="jh2-btn" title="Voix, écoute et réglages de JARVIS">⚙</button>
            <button type="button" data-action="exit" class="jh2-btn" title="Revenir à l'interface classique">✕</button>
          </div>
        </header>
        <div class="jh2-mini-core" title="Revenir au HUD"></div>
        <section class="jh2-left">
          <div class="jh2-panel jh2-systems">
            <h3><span>SYSTÈMES</span><em class="jh2-host"></em></h3>
            <div class="jh2-metrics"></div>
          </div>
          <div class="jh2-panel jh2-quotas">
            <h3><span>QUOTAS DES IA</span><em></em></h3>
            <div class="jh2-quota-list"></div>
          </div>
        </section>
        <section class="jh2-center">
          <div class="jh2-reactor">
          <div class="jh2-rings">
            <!-- Un calque par anneau : la rotation est faite par la carte, sans redessin. -->
            <svg class="jh2-ring r1" viewBox="0 0 600 600" aria-hidden="true"><circle cx="300" cy="300" r="290" /></svg>
            <svg class="jh2-ring r2" viewBox="0 0 600 600" aria-hidden="true"><circle cx="300" cy="300" r="276" /></svg>
            <svg class="jh2-ring r3" viewBox="0 0 600 600" aria-hidden="true">
              <defs><path id="jh2-ring-text" d="M300,300 m-262,0 a262,262 0 1,1 524,0 a262,262 0 1,1 -524,0" /></defs>
              <text><textPath href="#jh2-ring-text">J.A.R.V.I.S. • INTERFACE NEURONALE • ANALYSE EN TEMPS RÉEL • PROTOCOLE STARK • J.A.R.V.I.S. • SYSTÈMES NOMINAUX •</textPath></text>
            </svg>
            <svg class="jh2-ring r4" viewBox="0 0 600 600" aria-hidden="true"><circle cx="300" cy="300" r="240" /></svg>
            <svg class="jh2-ring r5" viewBox="0 0 600 600" aria-hidden="true"><circle cx="300" cy="300" r="226" /></svg>
            <div class="jh2-core"></div>
          </div>
          </div>
          <div class="jh2-state"></div>
          <div class="jh2-caption"></div>
          <form class="jh2-command">
            <button type="button" class="jh2-mic" title="Parler à JARVIS">◉</button>
            <input type="text" placeholder="Parle (« OK Jarvis ») ou écris une demande pour l'IA…" spellcheck="false" />
            <select class="jh2-target" title="IA qui reçoit la demande"></select>
          </form>
        </section>
        <section class="jh2-right">
          <div class="jh2-panel jh2-sessions">
            <h3><span>SESSIONS</span><button type="button" class="jh2-new" title="Nouvelle session">＋</button></h3>
            <div class="jh2-session-list"></div>
          </div>
        </section>
        <section class="jh2-bottom">
          <div class="jh2-panel jh2-activity">
            <h3><span>ACTIVITÉ DES IA</span><em>temps réel</em></h3>
            <ol class="jh2-activity-list"></ol>
          </div>
          <div class="jh2-panel jh2-journal">
            <h3><span>JOURNAL VOCAL</span><em></em></h3>
            <ol class="jh2-journal-list"></ol>
          </div>
        </section>
        <div class="jh2-boot"></div>`;
      this.root = root;
      this.$ = (selector) => root.querySelector(selector);
      this.backdrop = new HudBackdrop(this.$(".jh2-backdrop"), this.$(".jh2-particles"));
      this.core = new window.JarvisCore(this.$(".jh2-core"), { size: this.coreSize() });
      this.miniCore = new window.JarvisCore(this.$(".jh2-mini-core"), { size: 34 });
      this.bindEvents();
      this.updateSoundButton();
      this.setCaption("EN VEILLE", "");
    }

    // Le reacteur suit la taille reelle des anneaux (fenetre reduite, autre ecran...).
    coreSize() {
      const rings = this.$(".jh2-rings").clientWidth;
      if (!rings) {
        return this.core ? this.core.size : 320;
      }
      return Math.round(Math.max(90, Math.min(340, rings * 0.6)));
    }

    bindEvents() {
      this.root.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (!action) {
          return;
        }
        this.sounds.play("blip");
        if (action === "home") {
          this.setMode("home");
        } else if (action === "sounds") {
          try {
            window.localStorage.setItem("jarvisHudSounds", this.sounds.enabled ? "0" : "1");
          } catch {}
          this.updateSoundButton();
        } else if (action === "settings") {
          this.provider.openSettings();
        } else if (action === "exit") {
          this.provider.exit();
        }
      });
      this.$(".jh2-mini-core").addEventListener("click", () => this.setMode("home"));
      this.$(".jh2-new").addEventListener("click", () => {
        this.sounds.play("blip");
        this.provider.newSession();
      });
      this.$(".jh2-mic").addEventListener("click", () => {
        this.sounds.play("blip");
        this.provider.listen();
      });
      const form = this.$(".jh2-command");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const input = form.querySelector("input");
        const text = input.value.trim();
        if (text && this.provider.sendText(text, this.$(".jh2-target").value)) {
          this.sounds.play("open");
          this.addVoiceLine("Vous", text);
          input.value = "";
        }
      });
      // Recreer le reacteur coute cher : on attend la fin du redimensionnement
      // et on ignore les petites variations.
      this.onResize = () => {
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => {
          const size = this.coreSize();
          if (Math.abs(size - this.core.size) < 8) {
            return;
          }
          this.core.destroy();
          this.core = new window.JarvisCore(this.$(".jh2-core"), { size });
          this.core.setState(this.coreState || "idle");
          if (!this.visible || this.mode === "focus") {
            this.core.pause();
          }
        }, 150);
      };
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.$(".jh2-rings"));
    }

    updateSoundButton() {
      const button = this.$('[data-action="sounds"]');
      button.textContent = this.sounds.enabled ? "♪" : "♪̸";
      button.classList.toggle("off", !this.sounds.enabled);
    }

    mount() {
      if (!this.root.isConnected) {
        document.body.appendChild(this.root);
      }
    }

    show() {
      this.mount();
      if (this.visible) {
        return;
      }
      this.visible = true;
      document.body.classList.add("jarvis-hud-on");
      this.setMode("home", true);
      this.root.classList.add("visible");
      this.miniCore.resume();
      this.backdrop.start();
      this.boot();
      this.tick();
      this.timers = [
        window.setInterval(() => this.updateClock(), 1000),
        window.setInterval(() => this.refreshStats(), 2000),
        window.setInterval(() => this.refreshSessions(), 2000),
        window.setInterval(() => this.refreshActivity(), 2500),
        window.setInterval(() => this.refreshQuotas(), 60000),
        window.setInterval(() => this.refreshGit(), 15000)
      ];
    }

    hide() {
      if (!this.visible) {
        return;
      }
      this.visible = false;
      this.timers.forEach((timer) => window.clearInterval(timer));
      this.timers = [];
      this.sounds.play("close");
      this.root.classList.remove("visible");
      document.body.classList.remove("jarvis-hud-on", "jarvis-hud-focus");
      this.backdrop.stop();
      this.core.pause();
      this.miniCore.pause();
      window.setTimeout(() => {
        if (!this.visible) {
          this.root.remove();
        }
      }, 450);
    }

    destroy() {
      this.hide();
      this.core.destroy();
      this.miniCore.destroy();
      this.backdrop.destroy();
      this.resizeObserver.disconnect();
      window.clearTimeout(this.resizeTimer);
    }

    // Sequence de demarrage : lignes de diagnostic puis ouverture des panneaux.
    boot() {
      const boot = this.$(".jh2-boot");
      const lines = [
        "INITIALISATION DE J.A.R.V.I.S.",
        "CHARGEMENT DE L'INTERFACE NEURONALE",
        "SYNCHRONISATION DES SESSIONS",
        "ANALYSE DES SYSTÈMES",
        "TOUS LES SYSTÈMES SONT OPÉRATIONNELS"
      ];
      boot.innerHTML = "";
      boot.classList.add("running");
      this.root.classList.add("booting");
      this.sounds.play("boot");
      lines.forEach((line, index) => {
        window.setTimeout(() => {
          const row = el("div", "jh2-boot-line", `> ${line}`);
          boot.appendChild(row);
          this.sounds.play("tick");
        }, 120 + index * 170);
      });
      window.setTimeout(() => {
        boot.classList.remove("running");
        this.root.classList.remove("booting");
      }, 120 + lines.length * 170 + 350);
    }

    setMode(mode, silent = false) {
      if (mode === this.mode && !silent) {
        return;
      }
      this.mode = mode;
      this.root.classList.toggle("focus", mode === "focus");
      document.body.classList.toggle("jarvis-hud-focus", mode === "focus");
      if (!silent) {
        this.sounds.play(mode === "focus" ? "open" : "close");
      }
      if (mode === "focus") {
        this.backdrop.stop();
        this.core.pause();
      } else if (this.visible) {
        this.core.resume();
        this.backdrop.start();
        this.tick();
      }
    }

    // Etat du reacteur central (idle, listening, thinking, speaking).
    setCoreState(state, analyser = null) {
      this.coreState = state;
      for (const core of [this.core, this.miniCore]) {
        core.setState(state);
        core.setAnalyser(analyser);
      }
      this.root.dataset.state = state;
    }

    setCaption(stateText, text = "") {
      this.$(".jh2-state").textContent = stateText;
      const caption = this.$(".jh2-caption");
      if (caption.dataset.full === text) {
        return;
      }
      caption.dataset.full = text;
      // Texte qui s'ecrit comme sur un terminal holographique.
      window.clearInterval(this.typing);
      let shown = 0;
      caption.textContent = "";
      if (!text) {
        return;
      }
      const step = Math.max(1, Math.ceil(text.length / 60));
      this.typing = window.setInterval(() => {
        shown = Math.min(text.length, shown + step);
        caption.textContent = text.slice(0, shown);
        if (shown >= text.length) {
          window.clearInterval(this.typing);
        }
      }, 16);
    }

    addVoiceLine(who, text) {
      this.voiceLines.push({ who, text, at: Date.now() });
      this.voiceLines = this.voiceLines.slice(-30);
      this.renderJournal();
    }

    renderJournal() {
      const list = this.$(".jh2-journal-list");
      list.innerHTML = "";
      for (const line of this.voiceLines.slice(-8)) {
        const item = el("li", line.who === "JARVIS" ? "jarvis" : "user");
        item.append(el("b", "", line.who), el("span", "", line.text), el("time", "", relativeTime(line.at)));
        list.appendChild(item);
      }
      this.$(".jh2-journal h3 em").textContent = this.voiceLines.length ? `${this.voiceLines.length} échange(s)` : "aucun échange";
      list.scrollTop = list.scrollHeight;
    }

    tick() {
      this.updateClock();
      this.refreshStats();
      this.refreshSessions();
      this.refreshActivity();
      this.refreshQuotas();
      this.refreshGit();
      this.renderJournal();
    }

    updateClock() {
      const now = new Date();
      this.$(".jh2-clock strong").textContent = now.toLocaleTimeString("fr-FR");
      this.$(".jh2-clock span").textContent = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }

    async refreshStats() {
      if (this.mode !== "home") {
        return;
      }
      let stats;
      try {
        stats = await this.provider.stats();
      } catch {
        return;
      }
      const push = (key, value) => {
        if (Number.isFinite(value)) {
          this.history[key].push(value);
          this.history[key] = this.history[key].slice(-HISTORY);
        }
      };
      const memory = stats.memory.total ? ((stats.memory.total - stats.memory.free) / stats.memory.total) * 100 : NaN;
      push("cpu", stats.cpu.usage);
      push("memory", memory);
      if (stats.gpu) {
        push("gpu", stats.gpu.usage);
        push("vram", (stats.gpu.memoryUsed / stats.gpu.memoryTotal) * 100);
      }
      this.$(".jh2-host").textContent = stats.host || "";
      const metrics = [
        { key: "cpu", label: "PROCESSEUR", value: stats.cpu.usage, detail: `${stats.cpu.cores} cœurs` },
        { key: "memory", label: "MÉMOIRE", value: memory, detail: `${formatBytes(stats.memory.total - stats.memory.free)} / ${formatBytes(stats.memory.total)}` }
      ];
      if (stats.gpu) {
        metrics.push(
          { key: "gpu", label: "CARTE GRAPHIQUE", value: stats.gpu.usage, detail: `${stats.gpu.temperature} °C` },
          { key: "vram", label: "MÉMOIRE GRAPHIQUE", value: (stats.gpu.memoryUsed / stats.gpu.memoryTotal) * 100, detail: `${(stats.gpu.memoryUsed / 1024).toFixed(1).replace(".", ",")} / ${(stats.gpu.memoryTotal / 1024).toFixed(0)} Go` }
        );
      }
      const container = this.$(".jh2-metrics");
      for (const metric of metrics) {
        let row = container.querySelector(`[data-key="${metric.key}"]`);
        if (!row) {
          row = el("div", "jh2-metric");
          row.dataset.key = metric.key;
          row.innerHTML = `<div class="jh2-metric-head"><span></span><strong></strong></div><canvas></canvas><small></small>`;
          container.appendChild(row);
        }
        const value = Number.isFinite(metric.value) ? Math.round(metric.value) : null;
        row.querySelector("span").textContent = metric.label;
        row.querySelector("strong").textContent = value === null ? "…" : `${value} %`;
        row.querySelector("small").textContent = metric.detail;
        row.classList.toggle("hot", value !== null && value >= 85);
        drawSparkline(row.querySelector("canvas"), this.history[metric.key], value !== null && value >= 85 ? "rgba(255, 170, 60, 1)" : "rgba(56, 232, 255, 1)");
      }
    }

    refreshSessions() {
      const sessions = this.provider.sessions();
      const list = this.$(".jh2-session-list");
      const ids = new Set(sessions.map((session) => session.id));
      for (const card of [...list.children]) {
        if (!ids.has(card.dataset.id)) {
          card.remove();
        }
      }
      if (!sessions.length) {
        if (!list.querySelector(".jh2-empty")) {
          list.innerHTML = "";
          list.appendChild(el("div", "jh2-empty", "Aucune session. ＋ pour en lancer une."));
        }
      } else {
        list.querySelector(".jh2-empty")?.remove();
      }
      for (const session of sessions) {
        let card = list.querySelector(`[data-id="${session.id}"]`);
        if (!card) {
          card = el("button", "jh2-session");
          card.type = "button";
          card.dataset.id = session.id;
          card.innerHTML = `<i></i><div><strong></strong><span></span></div><div class="jh2-session-meta"><em></em><small></small></div><div class="jh2-session-ctx"><b></b></div>`;
          card.addEventListener("click", () => {
            this.provider.focus(session.id);
            this.setMode("focus");
          });
          list.appendChild(card);
          card.classList.add("enter");
        }
        card.style.setProperty("--accent", session.accent || "#38e8ff");
        card.dataset.state = session.aiState || "idle";
        card.classList.toggle("active", Boolean(session.active));
        card.querySelector("strong").textContent = session.title;
        card.querySelector("span").textContent = session.profile;
        card.querySelector("em").textContent = session.aiState ? STATE_LABELS[session.aiState] || "" : "TERMINAL";
        const git = this.gitCache.get(session.cwd);
        card.querySelector("small").textContent = git?.isRepo ? `⎇ ${git.branch || "?"}${git.files?.length ? ` · ${git.files.length} modif.` : ""}` : "";
        const percent = session.context?.percent;
        card.querySelector(".jh2-session-ctx").hidden = !Number.isFinite(percent);
        card.querySelector(".jh2-session-ctx b").style.width = `${Math.min(100, percent || 0)}%`;
        card.querySelector(".jh2-session-ctx").title = Number.isFinite(percent) ? `Contexte de la conversation : ${Math.round(percent)} %` : "";
      }
      this.renderTargets(sessions);
    }

    renderTargets(sessions) {
      const select = this.$(".jh2-target");
      const signature = sessions.map((session) => `${session.id}:${session.title}`).join("|");
      if (select.dataset.signature === signature) {
        return;
      }
      const previous = select.value;
      select.dataset.signature = signature;
      select.innerHTML = "";
      for (const session of sessions) {
        const option = el("option", "", `→ ${session.title}`);
        option.value = session.id;
        select.appendChild(option);
      }
      const active = sessions.find((session) => session.active);
      select.value = sessions.some((session) => session.id === previous) ? previous : active?.id || sessions[0]?.id || "";
      select.hidden = !sessions.length;
    }

    async refreshActivity() {
      if (this.mode !== "home") {
        return;
      }
      const sessions = this.provider.sessions().filter((session) => session.aiState);
      if (!sessions.length) {
        this.renderActivity([]);
        return;
      }
      let byId = {};
      try {
        byId = (await this.provider.activity(sessions.map((session) => session.id))) || {};
      } catch {
        return;
      }
      const actions = [];
      for (const session of sessions) {
        let previous = null;
        for (const action of byId[session.id] || []) {
          // « Reflechit » repete : une seule ligne.
          if (action.kind === "think" && previous?.kind === "think") {
            continue;
          }
          previous = action;
          actions.push({ ...action, session });
        }
      }
      actions.sort((a, b) => a.at - b.at);
      this.renderActivity(actions.slice(-9));
    }

    renderActivity(actions) {
      const list = this.$(".jh2-activity-list");
      list.innerHTML = "";
      if (!actions.length) {
        list.appendChild(el("li", "jh2-empty", "Aucune activité récente."));
        return;
      }
      let fresh = false;
      for (const action of actions) {
        const key = `${action.session.id}|${action.at}|${action.label}`;
        const item = el("li", `kind-${action.kind}`);
        item.style.setProperty("--accent", action.session.accent || "#38e8ff");
        item.append(el("i", "", KIND_ICONS[action.kind] || "•"), el("b", "", action.session.title), el("span", "", action.label), el("time", "", relativeTime(action.at)));
        if (!this.seenActions.has(key)) {
          this.seenActions.add(key);
          if (this.seenActions.size > 1) {
            item.classList.add("enter");
            fresh = true;
          }
        }
        list.appendChild(item);
      }
      if (fresh) {
        this.sounds.play("tick");
      }
      if (this.seenActions.size > 500) {
        this.seenActions = new Set([...this.seenActions].slice(-200));
      }
    }

    async refreshQuotas() {
      const profiles = [...new Map(this.provider.sessions().filter((s) => s.profileId).map((s) => [s.profileId, s])).values()];
      for (const session of profiles) {
        try {
          this.usageCache.set(session.profileId, { session, data: await this.provider.usage(session.profileId) });
        } catch {}
      }
      const list = this.$(".jh2-quota-list");
      list.innerHTML = "";
      const shown = [...this.usageCache.values()].filter(({ session }) => profiles.some((p) => p.profileId === session.profileId));
      if (!shown.length) {
        list.appendChild(el("div", "jh2-empty", "Lance une IA pour voir ses quotas."));
        return;
      }
      for (const { session, data } of shown) {
        const block = el("div", "jh2-quota");
        block.style.setProperty("--accent", session.accent || "#38e8ff");
        block.appendChild(el("strong", "", session.profile));
        if (!data?.available) {
          block.appendChild(el("small", "", data?.reason || "Quota indisponible"));
        }
        for (const win of data?.available ? data.windows || [] : []) {
          const row = el("div", "jh2-quota-row");
          const percent = Math.round(win.usedPercent || 0);
          row.innerHTML = `<span></span><div class="jh2-gauge"><b></b></div><em></em>`;
          row.querySelector("span").textContent = win.label;
          row.querySelector("b").style.width = `${Math.min(100, percent)}%`;
          row.querySelector("em").textContent = `${percent} %`;
          row.classList.toggle("hot", percent >= 90);
          block.appendChild(row);
        }
        list.appendChild(block);
      }
    }

    async refreshGit() {
      const folders = [...new Set(this.provider.sessions().map((session) => session.cwd).filter(Boolean))];
      for (const cwd of folders) {
        try {
          this.gitCache.set(cwd, await this.provider.git(cwd));
        } catch {}
      }
      this.refreshSessions();
    }
  }

  window.JarvisHud = JarvisHud;
})();
