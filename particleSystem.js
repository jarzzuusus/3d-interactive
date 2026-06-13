// ============================================================
// particleSystem.js
// Reusable glowing particle systems:
// - Ambient floating background particles
// - Burst particles for gesture events (love / hello / pinch)
// - Hand trail particles
// ============================================================

import * as THREE from "three";

/**
 * Ambient background particle field — gives the scene depth and
 * a "futuristic space" feeling.
 */
export class AmbientParticles {
  constructor(scene, count = 600) {
    this.scene = scene;
    this.count = count;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
      speeds[i] = 0.05 + Math.random() * 0.15;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.speeds = speeds;

    const material = new THREE.PointsMaterial({
      color: 0x66ddff,
      size: 0.05,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);
  }

  update(delta) {
    const positions = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      // Slow upward drift, wrap around
      positions[i * 3 + 1] += this.speeds[i] * delta;
      if (positions[i * 3 + 1] > 15) positions[i * 3 + 1] = -15;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * Burst particle effect — used for gesture confirmations
 * (e.g. pink glow burst on Open Palm -> Love morph).
 */
export class BurstParticles {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Color|number} color
   * @param {number} count
   */
  constructor(scene, color = 0xff4fd8, count = 200) {
    this.scene = scene;
    this.count = count;
    this.active = false;
    this.life = 0;
    this.maxLife = 1.4;

    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);

    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));

    const material = new THREE.PointsMaterial({
      color,
      size: 0.08,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.material = material;
    this.points = new THREE.Points(geometry, material);
    this.points.visible = false;
    scene.add(this.points);
  }

  /**
   * Trigger a burst from a given world position.
   */
  trigger(origin) {
    this.active = true;
    this.life = 0;
    this.points.visible = true;
    this.material.opacity = 1;

    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = origin.x;
      this.positions[i * 3 + 1] = origin.y;
      this.positions[i * 3 + 2] = origin.z;

      // Random outward velocity (sphere distribution)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.5 + Math.random() * 1.5;

      this.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      this.velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      this.velocities[i * 3 + 2] = Math.cos(phi) * speed;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  update(delta) {
    if (!this.active) return;

    this.life += delta;
    const t = this.life / this.maxLife;

    if (t >= 1) {
      this.active = false;
      this.points.visible = false;
      return;
    }

    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] += this.velocities[i * 3] * delta;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * delta;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * delta;
    }

    this.material.opacity = 1 - t;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * Hand trail — leaves a fading glowing trail behind the tracked hand.
 */
export class HandTrail {
  constructor(scene, color = 0x00f0ff, maxPoints = 40) {
    this.scene = scene;
    this.maxPoints = maxPoints;
    this.positions = new Float32Array(maxPoints * 3);
    this.head = 0;
    this.filled = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));

    const material = new THREE.PointsMaterial({
      color,
      size: 0.06,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);
  }

  /**
   * Add a new trail point at the given world position.
   */
  addPoint(position) {
    const idx = this.head * 3;
    this.positions[idx] = position.x;
    this.positions[idx + 1] = position.y;
    this.positions[idx + 2] = position.z;

    this.head = (this.head + 1) % this.maxPoints;
    this.filled = Math.min(this.filled + 1, this.maxPoints);

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.filled);
  }
}
