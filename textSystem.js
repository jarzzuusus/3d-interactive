// ============================================================
// textSystem.js  (reworked)
// - Peace sign → sequence: "WELCOME" → "JARZZ" → "HANDVERSE"
//   each line fades in separately with 1.8s delay between them
// - Thumb up → fade out all
// - Pinch → restart sequence
// - Subtle glow only (no over-bright bloom)
// ============================================================

import * as THREE from "three";

const SEQUENCE = ["WELCOME", "JARZZ", "HANDVERSE"];
const LINE_DELAY   = 1.8;   // seconds between each line appearing
const FADE_SPEED   = 3.5;   // opacity lerp speed (higher = faster fade in/out)

function makeTextTexture(text) {
  const canvas  = document.createElement("canvas");
  canvas.width  = 1024;
  canvas.height = 200;
  const ctx     = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.font         = "bold 96px 'Segoe UI', Arial, sans-serif";

  // Very subtle glow — small blur, low alpha
  ctx.shadowColor = "rgba(160, 200, 255, 0.45)";
  ctx.shadowBlur  = 18;
  ctx.fillStyle   = "rgba(210, 230, 255, 0.9)";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  // Crisp white core pass — no second shadow pass
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = "rgba(255, 255, 255, 0.95)";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture           = new THREE.CanvasTexture(canvas);
  texture.minFilter       = THREE.LinearFilter;
  texture.needsUpdate     = true;
  return texture;
}

class TextLine {
  constructor(scene, text, yOffset) {
    this.scene   = scene;
    this.opacity = 0;
    this.target  = 0;
    this.time    = 0;

    const mat = new THREE.SpriteMaterial({
      map:         makeTextTexture(text),
      transparent: true,
      opacity:     0,
      depthWrite:  false,
      // Standard blending — no additive over-brightness
      blending:    THREE.NormalBlending,
    });

    this.sprite   = new THREE.Sprite(mat);
    const scaleW  = 4.0;
    const scaleH  = scaleW * (200 / 1024);
    this.sprite.scale.set(scaleW, scaleH, 1);
    this.baseY    = yOffset;
    this.sprite.position.set(0, yOffset, 0);
    scene.add(this.sprite);
  }

  show() { this.target = 1; }
  hide() { this.target = 0; }

  update(delta, anchorX, anchorY, anchorZ) {
    this.time += delta;

    this.opacity += (this.target - this.opacity) * Math.min(1, FADE_SPEED * delta);

    this.sprite.material.opacity = this.opacity;
    this.sprite.visible = this.opacity > 0.005;

    // Gentle float bob
    const bob = Math.sin(this.time * 1.1) * 0.06;
    this.sprite.position.set(anchorX, anchorY + this.baseY + bob, anchorZ);
  }

  dispose() {
    this.sprite.material.map.dispose();
    this.sprite.material.dispose();
    this.scene.remove(this.sprite);
  }
}

export class TextSystem {
  constructor(scene) {
    this.scene    = scene;
    this.active   = false;
    this.timer    = 0;
    this.lineShown = 0;   // how many lines have been revealed so far

    // Create one sprite per line, stacked vertically
    // Spacing between lines
    const spacing = 0.72;
    this.lines = SEQUENCE.map((text, i) => {
      // Center the block: index 0 = top, last = bottom
      const mid    = (SEQUENCE.length - 1) / 2;
      const yOff   = (mid - i) * spacing + 2.2; // +2.2 to sit above the particle ball
      return new TextLine(scene, text, yOff);
    });
  }

  /** Peace gesture → start/restart the reveal sequence */
  spawn() {
    this.active    = true;
    this.timer     = 0;
    this.lineShown = 0;
    // Hide all first (in case of restart)
    this.lines.forEach(l => l.hide());
  }

  /** Thumb up → hide everything */
  remove() {
    this.active = false;
    this.lines.forEach(l => l.hide());
  }

  /** Pinch → restart sequence */
  changeText() {
    this.spawn();
  }

  update(delta, anchorPos) {
    if (this.active) {
      this.timer += delta;

      // Reveal lines one by one based on elapsed time
      const shouldShow = Math.min(
        SEQUENCE.length,
        Math.floor(this.timer / LINE_DELAY) + 1
      );

      if (shouldShow > this.lineShown) {
        for (let i = this.lineShown; i < shouldShow; i++) {
          this.lines[i].show();
        }
        this.lineShown = shouldShow;
      }
    }

    this.lines.forEach(line =>
      line.update(delta, anchorPos.x, anchorPos.y, anchorPos.z)
    );
  }
}