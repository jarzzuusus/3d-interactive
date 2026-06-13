// ============================================================
// textSystem.js
// Floating holographic 3D text, driven by gestures:
//  - Peace sign  -> spawn
//  - Thumb up    -> remove (fade out)
//  - Pinch       -> cycle to next text
//
// Text is rendered onto a canvas texture and shown on a Sprite so
// it always faces the camera, with a glow look (additive blending
// + bloom in the composer does the rest) and a gentle float/fade.
// ============================================================

import * as THREE from "three";

const TEXTS = ["HELLO", "HANDVERSE", "WELCOME", "THE FUTURE IS NOW", "AI POWERED"];

function makeTextTexture(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 110px 'Segoe UI', Arial, sans-serif";

  // Glow pass
  ctx.shadowColor = "#00f0ff";
  ctx.shadowBlur = 40;
  ctx.fillStyle = "#aef9ff";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  // Sharper core pass
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class TextSystem {
  constructor(scene) {
    this.scene = scene;
    this.index = 0;
    this.active = false;
    this.opacity = 0;
    this.targetOpacity = 0;
    this.time = 0;

    const material = new THREE.SpriteMaterial({
      map: makeTextTexture(TEXTS[0]),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.baseScale = 4.2;
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(this.baseScale, this.baseScale * 0.25, 1);
    this.sprite.position.set(0, 2.4, 0);
    scene.add(this.sprite);

    // Small particle ring around the text for extra "hologram" feel
    const ringCount = 60;
    const ringGeo = new THREE.BufferGeometry();
    this.ringPositions = new Float32Array(ringCount * 3);
    this.ringAngles = new Float32Array(ringCount);
    for (let i = 0; i < ringCount; i++) {
      this.ringAngles[i] = (i / ringCount) * Math.PI * 2;
    }
    ringGeo.setAttribute("position", new THREE.BufferAttribute(this.ringPositions, 3));
    const ringMat = new THREE.PointsMaterial({
      color: 0x00f0ff,
      size: 0.04,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ring = new THREE.Points(ringGeo, ringMat);
    this.ringCount = ringCount;
    scene.add(this.ring);
  }

  spawn() {
    this.active = true;
    this.targetOpacity = 1;
  }

  remove() {
    this.targetOpacity = 0;
  }

  changeText() {
    this.index = (this.index + 1) % TEXTS.length;
    this.sprite.material.map = makeTextTexture(TEXTS[this.index]);
    this.sprite.material.needsUpdate = true;
    if (!this.active) this.spawn();
  }

  update(delta, anchorPos) {
    this.time += delta;

    // Smooth fade
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(1, delta * 4);
    if (this.opacity < 0.001 && this.targetOpacity === 0) {
      this.active = false;
      this.opacity = 0;
    }

    this.sprite.material.opacity = this.opacity;
    this.ring.material.opacity = this.opacity * 0.6;

    const bob = Math.sin(this.time * 1.2) * 0.08;
    const x = anchorPos.x;
    const y = anchorPos.y + 2.4 + bob;
    const z = anchorPos.z;

    const scale = this.baseScale * (0.92 + this.opacity * 0.08);
    this.sprite.position.set(x, y, z);
    this.sprite.scale.set(scale, scale * 0.25, 1);

    // Animate the surrounding particle ring
    for (let i = 0; i < this.ringCount; i++) {
      const a = this.ringAngles[i] + this.time * 0.6;
      const radius = 2.2 + Math.sin(this.time * 2 + i) * 0.1;
      this.ringPositions[i * 3] = x + Math.cos(a) * radius;
      this.ringPositions[i * 3 + 1] = y + Math.sin(a * 1.7) * 0.25;
      this.ringPositions[i * 3 + 2] = z + Math.sin(a) * radius * 0.3;
    }
    this.ring.geometry.attributes.position.needsUpdate = true;
  }
}
