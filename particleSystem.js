// ============================================================
// particleSystem.js  (reworked)
//
// Behaviour:
//  - Default: particles scattered randomly across the scene,
//    drifting with slow wind-like turbulence.
//  - Hand detected: each particle is pulled toward a sphere
//    formation around the hand position with a wind/fluid delay —
//    particles on the "wake" side lag behind, creating an organic
//    comet/tail effect.
//  - Hand removed: particles drift back to scattered positions.
//  - Destruction gesture: explode outward, then scatter.
//
// Visual style: plain 3D points, no over-blooming.
// ============================================================

import * as THREE from "three";

// Simple deterministic pseudo-noise using trig.
function noise3(x, y, z, t) {
  return (
    Math.sin(x * 1.7 + t) * Math.cos(y * 1.3 - t * 0.7) +
    Math.sin(y * 2.1 - t * 0.5) * Math.cos(z * 1.9 + t * 0.6) +
    Math.sin(z * 1.5 + t * 0.8) * Math.cos(x * 2.3 - t * 0.4)
  ) / 3;
}

// Smooth easing
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class ParticleObject {
  /**
   * @param {THREE.Scene} scene
   * @param {number} count  Total particle count (recommend 3000–5000)
   */
  constructor(scene, count = 4000) {
    this.scene = scene;
    this.count = count;
    this.time = 0;

    // ── Interaction state ──────────────────────────────────────
    // "scattered"  : drifting randomly (no hand)
    // "gathering"  : hand detected, pulling toward sphere
    // "gathered"   : hand present, holding sphere formation
    // "releasing"  : hand lost, smoothly scattering back
    // "exploding"  : destruction gesture
    this.interactionState = "scattered";
    this.handPos = new THREE.Vector3(0, 0, 0);       // current hand world pos
    this.prevHandPos = new THREE.Vector3(0, 0, 0);   // previous frame hand pos
    this.handVelocity = new THREE.Vector3(0, 0, 0);  // smoothed hand motion
    this.handPresent = false;
    this.gatherTime = 0;

    // ── Per-particle data ──────────────────────────────────────
    const positions   = new Float32Array(count * 3);  // current world positions
    const scattered   = new Float32Array(count * 3);  // home scatter positions
    const sphereOff   = new Float32Array(count * 3);  // offset inside the sphere
    const velocities  = new Float32Array(count * 3);  // physics velocity
    const phase       = new Float32Array(count);      // random phase per particle
    const lag         = new Float32Array(count);      // 0–1: how "fast" it follows (tail effect)
    const colors      = new Float32Array(count * 3);

    // Colour palette — subtle, not neon
    const colA = new THREE.Color(0x94c8e8); // soft sky blue
    const colB = new THREE.Color(0xb8a4e0); // muted lavender
    const colC = new THREE.Color(0xe8c4d8); // light rose

    for (let i = 0; i < count; i++) {
      // Random scatter position over a large volume
      const sx = (Math.random() - 0.5) * 20;
      const sy = (Math.random() - 0.5) * 14;
      const sz = (Math.random() - 0.5) * 10;
      scattered[i * 3]     = sx;
      scattered[i * 3 + 1] = sy;
      scattered[i * 3 + 2] = sz;

      positions[i * 3]     = sx;
      positions[i * 3 + 1] = sy;
      positions[i * 3 + 2] = sz;

      // Target offset inside the sphere (Fibonacci distribution)
      const idx = i + 0.5;
      const phi   = Math.acos(1 - 2 * idx / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
      const r = 1.2 + (Math.random() - 0.5) * 0.35;
      sphereOff[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      sphereOff[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      sphereOff[i * 3 + 2] = r * Math.cos(phi);

      phase[i] = Math.random() * Math.PI * 2;

      // Lag: 0.0 = slowest (tail) … 1.0 = fastest (lead)
      // Gives different particles different inertia → organic tail
      lag[i] = 0.15 + Math.random() * 0.85;

      const mix = Math.random();
      const c = mix < 0.5
        ? colA.clone().lerp(colB, mix * 2)
        : colB.clone().lerp(colC, (mix - 0.5) * 2);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    this.positions  = positions;
    this.scattered  = scattered;
    this.sphereOff  = sphereOff;
    this.velocities = velocities;
    this.phase      = phase;
    this.lag        = lag;

    // ── Three.js geometry & material ──────────────────────────
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color",    new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      // Normal blending — no over-glow
      blending: THREE.NormalBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  // ── Public API ──────────────────────────────────────────────

  /** Called by SceneManager when hand tracking gives a new position */
  setHandTarget(position) {
    this.prevHandPos.copy(this.handPos);
    this.handPos.copy(position);

    // Smooth hand velocity estimate (used to offset sphere → tail effect)
    const rawVel = new THREE.Vector3().subVectors(position, this.prevHandPos);
    this.handVelocity.lerp(rawVel, 0.18); // low-pass filter

    if (!this.handPresent) {
      this.handPresent = true;
      this.gatherTime = 0;
      this.interactionState = "gathering";
    }
  }

  /** Called when hand is lost */
  clearHand() {
    if (this.handPresent) {
      this.handPresent = false;
      this.interactionState = "releasing";
    }
  }

  /** Destruction gesture */
  triggerDestruction() {
    if (this.interactionState === "exploding") return;
    this.interactionState = "exploding";
    this._explode();
  }

  // ── Internal ────────────────────────────────────────────────

  _explode() {
    const pos = this.positions;
    for (let i = 0; i < this.count; i++) {
      // Explode away from current position
      const vx = (Math.random() - 0.5);
      const vy = (Math.random() - 0.5);
      const vz = (Math.random() - 0.5);
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      const spd = 4 + Math.random() * 6;
      this.velocities[i * 3]     = (vx / len) * spd;
      this.velocities[i * 3 + 1] = (vy / len) * spd;
      this.velocities[i * 3 + 2] = (vz / len) * spd;
    }
  }

  update(delta) {
    this.time += delta;
    const pos = this.positions;
    const t   = this.time;

    // Decay hand velocity each frame
    this.handVelocity.multiplyScalar(0.88);

    if (this.interactionState === "gathering" || this.interactionState === "gathered") {
      this.gatherTime += delta;
      if (this.gatherTime > 0.6) this.interactionState = "gathered";

      // Global gather progress 0→1 (first 0.6s ramps up)
      const gatherProg = Math.min(this.gatherTime / 0.6, 1.0);

      // How far the hand moved this frame → used to stretch the tail
      const speed = this.handVelocity.length();
      // Tail direction: opposite of hand velocity
      const tailDir = this.handVelocity.clone().normalize().negate();

      for (let i = 0; i < this.count; i++) {
        const ph = this.phase[i];
        const lagFactor = this.lag[i]; // fast particles: lag≈1, slow/tail: lag≈0

        // Target = hand position + sphere offset + wind noise displacement
        const ox = this.sphereOff[i * 3];
        const oy = this.sphereOff[i * 3 + 1];
        const oz = this.sphereOff[i * 3 + 2];

        // Small breathing noise so sphere isn't perfectly static
        const breathe = 0.12;
        const nx = noise3(ox, oy, oz, t * 0.5 + ph) * breathe;
        const ny = noise3(oy, oz, ox, t * 0.5 + ph) * breathe;
        const nz = noise3(oz, ox, oy, t * 0.5 + ph) * breathe;

        // Tail stretch: slow particles are pushed further "behind" the motion
        const tailStretch = speed * (1.0 - lagFactor) * 2.8;
        const tx = this.handPos.x + ox + nx + tailDir.x * tailStretch;
        const ty = this.handPos.y + oy + ny + tailDir.y * tailStretch;
        const tz = this.handPos.z + oz + nz + tailDir.z * tailStretch;

        // Per-particle follow speed: fast ones catch up quickly,
        // slow ones (tail) drift lazily — feels like wind
        const followK = (0.8 + lagFactor * 3.5) * gatherProg;

        pos[i * 3]     += (tx - pos[i * 3])     * Math.min(1, followK * delta);
        pos[i * 3 + 1] += (ty - pos[i * 3 + 1]) * Math.min(1, followK * delta);
        pos[i * 3 + 2] += (tz - pos[i * 3 + 2]) * Math.min(1, followK * delta);
      }

    } else if (this.interactionState === "releasing") {
      // Drift back toward scatter positions with wind turbulence
      for (let i = 0; i < this.count; i++) {
        const ph  = this.phase[i];
        const lag = this.lag[i];

        const sx = this.scattered[i * 3];
        const sy = this.scattered[i * 3 + 1];
        const sz = this.scattered[i * 3 + 2];

        // Noise offset on the home position for organic drift
        const wobble = 0.5;
        const wx = noise3(sx, sy, sz, t * 0.4 + ph) * wobble;
        const wy = noise3(sy, sz, sx, t * 0.4 + ph) * wobble;
        const wz = noise3(sz, sx, sy, t * 0.4 + ph) * wobble;

        const tx = sx + wx;
        const ty = sy + wy;
        const tz = sz + wz;

        // Slow, wind-like release — lag controls how long each particle
        // takes to fully scatter again
        const releaseK = (0.3 + lag * 1.0) * 0.8;

        pos[i * 3]     += (tx - pos[i * 3])     * Math.min(1, releaseK * delta);
        pos[i * 3 + 1] += (ty - pos[i * 3 + 1]) * Math.min(1, releaseK * delta);
        pos[i * 3 + 2] += (tz - pos[i * 3 + 2]) * Math.min(1, releaseK * delta);
      }

      // Once close enough to scatter pos, switch to idle scattered state
      let settled = true;
      for (let i = 0; i < 20; i++) {
        const idx = Math.floor(Math.random() * this.count);
        const dx = pos[idx * 3] - this.scattered[idx * 3];
        const dy = pos[idx * 3 + 1] - this.scattered[idx * 3 + 1];
        if (dx * dx + dy * dy > 0.25) { settled = false; break; }
      }
      if (settled) this.interactionState = "scattered";

    } else if (this.interactionState === "scattered") {
      // Slow wind-like drift around home scatter positions
      for (let i = 0; i < this.count; i++) {
        const ph = this.phase[i];
        const sx = this.scattered[i * 3];
        const sy = this.scattered[i * 3 + 1];
        const sz = this.scattered[i * 3 + 2];

        const amp = 0.3;
        const spd = 0.25;
        const nx = noise3(sx, sy, sz, t * spd + ph) * amp;
        const ny = noise3(sy, sz, sx, t * spd + ph) * amp;
        const nz = noise3(sz, sx, sy, t * spd + ph) * amp;

        // Soft lerp so motion is smooth, not teleporting
        pos[i * 3]     += (sx + nx - pos[i * 3])     * Math.min(1, 1.5 * delta);
        pos[i * 3 + 1] += (sy + ny - pos[i * 3 + 1]) * Math.min(1, 1.5 * delta);
        pos[i * 3 + 2] += (sz + nz - pos[i * 3 + 2]) * Math.min(1, 1.5 * delta);
      }

    } else if (this.interactionState === "exploding") {
      let allFar = true;
      for (let i = 0; i < this.count; i++) {
        const drag = 0.94;
        this.velocities[i * 3]     *= drag;
        this.velocities[i * 3 + 1] *= drag;
        this.velocities[i * 3 + 2] *= drag;

        pos[i * 3]     += this.velocities[i * 3]     * delta;
        pos[i * 3 + 1] += this.velocities[i * 3 + 1] * delta;
        pos[i * 3 + 2] += this.velocities[i * 3 + 2] * delta;

        const vLen = Math.abs(this.velocities[i * 3]) + Math.abs(this.velocities[i * 3 + 1]);
        if (vLen > 0.05) allFar = false;
      }
      // After explosion settles, release back to scatter
      if (allFar) {
        this.interactionState = "releasing";
        this.handPresent = false;
      }
    }

    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ── Ambient background particles ───────────────────────────────
export class AmbientParticles {
  constructor(scene, count = 300) {
    this.scene = scene;
    this.count = count;

    const geometry  = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const speeds    = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 15;
      speeds[i] = 0.04 + Math.random() * 0.1;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.speeds = speeds;

    const material = new THREE.PointsMaterial({
      color: 0x8899bb,
      size: 0.04,
      transparent: true,
      opacity: 0.3,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    scene.add(this.points);
  }

  update(delta) {
    const positions = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      positions[i * 3 + 1] += this.speeds[i] * delta;
      if (positions[i * 3 + 1] > 10) positions[i * 3 + 1] = -10;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}