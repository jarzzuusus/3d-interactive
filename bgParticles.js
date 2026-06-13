// ============================================================
// bgParticles.js — Fullscreen 2D canvas particle background
// Soft floating orbs, drifting slowly, with subtle glow.
// ============================================================

export class BgParticles {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "bg-canvas";
    document.body.insertBefore(this.canvas, document.body.firstChild);
    this.ctx = this.canvas.getContext("2d");

    this.particles = [];
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this._init();
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _init() {
    const count = Math.floor((window.innerWidth * window.innerHeight) / 6000);
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push(this._make(true));
    }
  }

  _make(randomY = false) {
    const w = this.canvas.width, h = this.canvas.height;
    const hue = 180 + Math.random() * 120; // cyan → purple range
    return {
      x:    Math.random() * w,
      y:    randomY ? Math.random() * h : h + 10,
      r:    1.2 + Math.random() * 3.5,
      vx:   (Math.random() - 0.5) * 0.18,
      vy:   -(0.12 + Math.random() * 0.28),
      alpha: 0.08 + Math.random() * 0.22,
      hue,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.4 + Math.random() * 0.6,
    };
  }

  update(dt) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += p.pulseSpeed * dt;

      const alphaMod = p.alpha * (0.75 + 0.25 * Math.sin(p.pulse));
      const r = p.r * (0.9 + 0.1 * Math.sin(p.pulse * 0.7));

      // Soft glow via radial gradient
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.5);
      grad.addColorStop(0,   `hsla(${p.hue}, 80%, 75%, ${alphaMod})`);
      grad.addColorStop(0.4, `hsla(${p.hue}, 70%, 60%, ${alphaMod * 0.5})`);
      grad.addColorStop(1,   `hsla(${p.hue}, 60%, 50%, 0)`);

      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Respawn at bottom if went off top
      if (p.y < -20 || p.x < -30 || p.x > w + 30) {
        this.particles[i] = this._make(false);
      }
    }
  }
}
