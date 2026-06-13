// ============================================================
// particleSystem.js
// Core point-cloud "object" made of thousands of glowing
// particles. Handles:
//  - Idle floating / noise-based motion
//  - Destruction (scatter -> hold -> reassemble) physics
//  - Velocity, drag, turbulence
// Plus a lightweight ambient background particle field.
// ============================================================

import * as THREE from "three";

// Cheap trig-based 3D "noise" — no external noise lib needed,
// stays GPU/CPU friendly even at thousands of particles.
function noise3(x, y, z, t) {
  return (
    Math.sin(x * 1.7 + t) * Math.cos(y * 1.3 - t * 0.7) +
    Math.sin(y * 2.1 - t * 0.5) * Math.cos(z * 1.9 + t * 0.6) +
    Math.sin(z * 1.5 + t * 0.8) * Math.cos(x * 2.3 - t * 0.4)
  ) / 3;
}

/**
 * The main interactive object: a glowing point cloud shaped like
 * a sphere/orb, built from a Fibonacci sphere distribution so the
 * particles are evenly spread with no clumping.
 */
export class ParticleObject {
  constructor(scene, count = 7000) {
    this.scene = scene;
    this.count = count;

    // states: idle -> scattering -> hold -> reassembling -> idle
    this.state = "idle";
    this.stateTime = 0;
    this.scatterDuration = 1.0;
    this.holdDuration = 0.6;
    this.reassembleDuration = 1.6;

    const positions = new Float32Array(count * 3);
    const original = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const colorA = new THREE.Color(0x00f0ff);
    const colorB = new THREE.Color(0x7c4dff);
    const colorC = new THREE.Color(0xff2bd6);

    for (let i = 0; i < count; i++) {
      // Fibonacci sphere distribution
      const idx = i + 0.5;
      const phi = Math.acos(1 - 2 * idx / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * idx;

      // Most particles on a "shell", a few scattered inside for depth/glow
      const shell = 1.35 + (Math.random() - 0.5) * 0.3;
      const r = Math.random() < 0.12 ? Math.random() * 1.25 : shell;

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      original[i * 3] = x;
      original[i * 3 + 1] = y;
      original[i * 3 + 2] = z;

      phase[i] = Math.random() * Math.PI * 2;
      sizes[i] = 0.018 + Math.random() * 0.035;

      const mix = Math.random();
      const c =
        mix < 0.5
          ? colorA.clone().lerp(colorB, mix * 2)
          : colorB.clone().lerp(colorC, (mix - 0.5) * 2);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    this.positions = positions;
    this.original = original;
    this.velocities = velocities;
    this.phase = phase;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.045,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Glow trail behind the moving group (a faint shadow cloud)
    const trailGeo = new THREE.BufferGeometry();
    const trailCount = 24;
    this.trailPositions = new Float32Array(trailCount * 3);
    trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    const trailMat = new THREE.PointsMaterial({
      color: 0x66ddff,
      size: 0.3,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trail = new THREE.Points(trailGeo, trailMat);
    this.trailCount = trailCount;
    this.trailHead = 0;
    this.trailFilled = 0;
    scene.add(this.trail);

    this.time = 0;
  }

  /**
   * Explode the point cloud outward with velocity + randomness.
   * Safe to call repeatedly — ignored while already animating.
   */
  triggerDestruction() {
    if (this.state !== "idle") return;
    this.state = "scattering";
    this.stateTime = 0;

    for (let i = 0; i < this.count; i++) {
      const dir = new THREE.Vector3(
        this.original[i * 3],
        this.original[i * 3 + 1],
        this.original[i * 3 + 2]
      );
      if (dir.lengthSq() < 0.0001) {
        dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      }
      dir.normalize();

      const speed = 2.2 + Math.random() * 4.5;
      this.velocities[i * 3] = dir.x * speed + (Math.random() - 0.5) * 1.5;
      this.velocities[i * 3 + 1] = dir.y * speed + (Math.random() - 0.5) * 1.5;
      this.velocities[i * 3 + 2] = dir.z * speed + (Math.random() - 0.5) * 1.5;
    }
  }

  _addTrailPoint(pos) {
    const idx = this.trailHead * 3;
    this.trailPositions[idx] = pos.x;
    this.trailPositions[idx + 1] = pos.y;
    this.trailPositions[idx + 2] = pos.z;
    this.trailHead = (this.trailHead + 1) % this.trailCount;
    this.trailFilled = Math.min(this.trailFilled + 1, this.trailCount);
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailFilled);
  }

  update(delta) {
    this.time += delta;
    const pos = this.positions;

    if (this.state === "idle") {
      // Slow organic float + noise drift around the resting shape
      for (let i = 0; i < this.count; i++) {
        const t = this.time * 0.6 + this.phase[i];
        const ox = this.original[i * 3];
        const oy = this.original[i * 3 + 1];
        const oz = this.original[i * 3 + 2];

        const nx = noise3(ox, oy, oz, t) * 0.06;
        const ny = noise3(oy, oz, ox, t * 1.1) * 0.06;
        const nz = noise3(oz, ox, oy, t * 0.9) * 0.06;

        pos[i * 3] = ox + nx + Math.sin(t) * 0.02;
        pos[i * 3 + 1] = oy + ny + Math.cos(t * 0.8) * 0.02;
        pos[i * 3 + 2] = oz + nz;
      }
    } else if (this.state === "scattering") {
      this.stateTime += delta;
      const turb = 0.6;
      for (let i = 0; i < this.count; i++) {
        const t = this.time * 1.5 + this.phase[i];

        this.velocities[i * 3] += noise3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], t) * turb * delta;
        this.velocities[i * 3 + 1] += noise3(pos[i * 3 + 1], pos[i * 3 + 2], pos[i * 3], t * 1.2) * turb * delta;
        this.velocities[i * 3 + 2] += noise3(pos[i * 3 + 2], pos[i * 3], pos[i * 3 + 1], t * 0.8) * turb * delta;

        const drag = 0.96;
        this.velocities[i * 3] *= drag;
        this.velocities[i * 3 + 1] *= drag;
        this.velocities[i * 3 + 2] *= drag;

        pos[i * 3] += this.velocities[i * 3] * delta;
        pos[i * 3 + 1] += this.velocities[i * 3 + 1] * delta;
        pos[i * 3 + 2] += this.velocities[i * 3 + 2] * delta;
      }
      if (this.stateTime >= this.scatterDuration) {
        this.state = "hold";
        this.stateTime = 0;
      }
    } else if (this.state === "hold") {
      this.stateTime += delta;
      for (let i = 0; i < this.count; i++) {
        const t = this.time * 0.8 + this.phase[i];
        pos[i * 3] += Math.sin(t) * 0.003;
        pos[i * 3 + 1] += Math.cos(t * 1.1) * 0.003;
        pos[i * 3 + 2] += Math.sin(t * 0.7) * 0.003;
      }
      if (this.stateTime >= this.holdDuration) {
        this.state = "reassembling";
        this.stateTime = 0;
      }
    } else if (this.state === "reassembling") {
      this.stateTime += delta;
      const t = Math.min(this.stateTime / this.reassembleDuration, 1);
      const pull = 1 - Math.pow(1 - t, 3);

      for (let i = 0; i < this.count; i++) {
        pos[i * 3] += (this.original[i * 3] - pos[i * 3]) * pull * delta * 4;
        pos[i * 3 + 1] += (this.original[i * 3 + 1] - pos[i * 3 + 1]) * pull * delta * 4;
        pos[i * 3 + 2] += (this.original[i * 3 + 2] - pos[i * 3 + 2]) * pull * delta * 4;
      }

      if (t >= 1) {
        this.state = "idle";
        this.stateTime = 0;
        pos.set(this.original);
      }
    }

    this.points.geometry.attributes.position.needsUpdate = true;

    // Update glow trail every few frames based on group position
    this._trailTimer = (this._trailTimer || 0) + delta;
    if (this._trailTimer > 0.05) {
      this._trailTimer = 0;
      this._addTrailPoint(this.points.position);
    }
  }
}

/**
 * Ambient background particle field — gives the scene depth and a
 * "drifting through space" feeling. Cheap: simple upward drift + wrap.
 */
export class AmbientParticles {
  constructor(scene, count = 500) {
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
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);
  }

  update(delta) {
    const positions = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      positions[i * 3 + 1] += this.speeds[i] * delta;
      if (positions[i * 3 + 1] > 15) positions[i * 3 + 1] = -15;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}