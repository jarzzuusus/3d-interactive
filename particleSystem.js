// ============================================================
// particleSystem.js  (full rework v2)
//
// SHAPES  (cycle with POINT / CALL gesture):
//   0 — Saturn   : sphere + flat ring
//   1 — Love     : heart / love shape
//   2 — Dragon   : coiling helix / serpentine form
//   3 — Sphere   : plain sphere fallback
//
// STATES:
//   scattered   — particles drifting randomly (no hand)
//   gathering   — hand detected, pulling toward current shape
//   gathered    — hand present, holding formation
//   releasing   — hand lost, drift back
//   dissolving  — PALM→FIST smooth dissolve
//   reforming   — after dissolve, pieces drift and re-gather
//
// WIND / TAIL:
//   Each particle has a `lag` value (0–1). Slow-lag particles
//   trail behind the hand motion → organic comet tail.
// ============================================================

import * as THREE from "three";

function noise3(x, y, z, t) {
  return (
    Math.sin(x * 1.7 + t) * Math.cos(y * 1.3 - t * 0.7) +
    Math.sin(y * 2.1 - t * 0.5) * Math.cos(z * 1.9 + t * 0.6) +
    Math.sin(z * 1.5 + t * 0.8) * Math.cos(x * 2.3 - t * 0.4)
  ) / 3;
}

// ── Shape generators ──────────────────────────────────────────
// Each returns an array of {x,y,z} offsets forming the shape.

function genSaturn(count) {
  const pts = [];
  const sphere = Math.floor(count * 0.65);
  const ring   = count - sphere;

  // Sphere shell (Fibonacci)
  for (let i = 0; i < sphere; i++) {
    const idx = i + 0.5;
    const phi   = Math.acos(1 - 2 * idx / sphere);
    const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
    const r = 1.1 + (Math.random() - 0.5) * 0.25;
    pts.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    });
  }

  // Flat ring around equator (tilted ~20 deg)
  const tilt = 0.34; // radians
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    const rr = 1.8 + (Math.random() - 0.5) * 0.5;
    const x0 = rr * Math.cos(a);
    const z0 = rr * Math.sin(a) * 0.18; // flat
    const y0 = (Math.random() - 0.5) * 0.12;
    // Tilt ring around X axis
    pts.push({
      x: x0,
      y: y0 * Math.cos(tilt) - z0 * Math.sin(tilt),
      z: y0 * Math.sin(tilt) + z0 * Math.cos(tilt),
    });
  }
  return pts;
}

function genHeart(count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    // Parametric heart on XY plane, with depth
    const t = (i / count) * Math.PI * 2;
    // Heart curve
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
    // Scale down to fit ~1.5 units
    const scale = 0.095;
    // Fill volume: scatter around surface
    const nx = hx * scale + (Math.random() - 0.5) * 0.18;
    const ny = hy * scale + (Math.random() - 0.5) * 0.18;
    const nz = (Math.random() - 0.5) * 0.35;
    pts.push({ x: nx, y: ny - 0.2, z: nz });
  }
  return pts;
}

function genDragon(count) {
  const pts = [];
  // Coiled helix / serpent body
  const segments = count;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 6; // 3 full coils
    const progress = i / segments;

    // Body: tapers thinner toward the tail
    const bodyRadius = 0.25 * (1 - progress * 0.7);
    const phi = Math.random() * Math.PI * 2;

    // Main spine curve
    const spineX = Math.sin(t * 0.7) * (1.2 - progress * 0.3);
    const spineY = (progress - 0.5) * 3.5;  // vertical elongation
    const spineZ = Math.cos(t * 0.5) * 0.6;

    pts.push({
      x: spineX + Math.cos(phi) * bodyRadius,
      y: spineY + (Math.random() - 0.5) * 0.1,
      z: spineZ + Math.sin(phi) * bodyRadius,
    });
  }
  return pts;
}

function genSphere(count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const idx = i + 0.5;
    const phi   = Math.acos(1 - 2 * idx / count);
    const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
    const r = 1.3 + (Math.random() - 0.5) * 0.3;
    pts.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    });
  }
  return pts;
}

const SHAPES = ["saturn", "love", "dragon", "sphere"];
const SHAPE_GENERATORS = {
  saturn: genSaturn,
  love:   genHeart,
  dragon: genDragon,
  sphere: genSphere,
};

// ── Main particle class ──────────────────────────────────────
export class ParticleObject {
  constructor(scene, count = 4000) {
    this.scene    = scene;
    this.count    = count;
    this.time     = 0;

    // Current shape index
    this.shapeIdx  = 0;
    this.shapeName = SHAPES[0];

    // Interaction state
    this.interactionState = "scattered";
    this.handPos     = new THREE.Vector3();
    this.prevHandPos = new THREE.Vector3();
    this.handVelocity = new THREE.Vector3();
    this.handPresent = false;
    this.gatherTime  = 0;
    this.dissolveTime = 0;

    // Per-particle data
    this.positions   = new Float32Array(count * 3);
    this.scattered   = new Float32Array(count * 3);  // random home pos
    this.shapeOff    = new Float32Array(count * 3);  // target offsets for current shape
    this.velocities  = new Float32Array(count * 3);
    this.phase       = new Float32Array(count);
    this.lag         = new Float32Array(count);

    const colors = new Float32Array(count * 3);

    // Colour palette: soft neutrals, NOT neon
    const colA = new THREE.Color(0x9fc8e8); // sky blue
    const colB = new THREE.Color(0xc4aee0); // soft lavender
    const colC = new THREE.Color(0xe8c0d5); // pale rose

    for (let i = 0; i < count; i++) {
      // Random scatter home
      this.scattered[i*3]   = (Math.random() - 0.5) * 22;
      this.scattered[i*3+1] = (Math.random() - 0.5) * 14;
      this.scattered[i*3+2] = (Math.random() - 0.5) * 10;

      // Start at scatter positions
      this.positions[i*3]   = this.scattered[i*3];
      this.positions[i*3+1] = this.scattered[i*3+1];
      this.positions[i*3+2] = this.scattered[i*3+2];

      this.phase[i] = Math.random() * Math.PI * 2;
      this.lag[i]   = 0.1 + Math.random() * 0.9; // 0=slowest tail, 1=fastest lead

      const mix = Math.random();
      const c = mix < 0.5
        ? colA.clone().lerp(colB, mix * 2)
        : colB.clone().lerp(colC, (mix - 0.5) * 2);
      colors[i*3]   = c.r;
      colors[i*3+1] = c.g;
      colors[i*3+2] = c.b;
    }

    // Build initial shape offsets
    this._buildShapeOffsets(this.shapeName);

    // Three.js objects
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size:         0.06,
      vertexColors: true,
      transparent:  true,
      opacity:      0.85,
      blending:     THREE.NormalBlending,
      depthWrite:   false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  // ── Shape management ─────────────────────────────────────

  _buildShapeOffsets(name) {
    const gen = SHAPE_GENERATORS[name] || genSphere;
    const pts = gen(this.count);
    for (let i = 0; i < this.count; i++) {
      this.shapeOff[i*3]   = pts[i].x;
      this.shapeOff[i*3+1] = pts[i].y;
      this.shapeOff[i*3+2] = pts[i].z;
    }
  }

  nextShape() {
    this.shapeIdx  = (this.shapeIdx + 1) % SHAPES.length;
    this.shapeName = SHAPES[this.shapeIdx];
    this._buildShapeOffsets(this.shapeName);
  }

  prevShape() {
    this.shapeIdx  = (this.shapeIdx - 1 + SHAPES.length) % SHAPES.length;
    this.shapeName = SHAPES[this.shapeIdx];
    this._buildShapeOffsets(this.shapeName);
  }

  getShapeName() { return this.shapeName; }

  // ── Hand API ──────────────────────────────────────────────

  setHandTarget(position) {
    this.prevHandPos.copy(this.handPos);
    this.handPos.copy(position);
    const rawVel = new THREE.Vector3().subVectors(position, this.prevHandPos);
    this.handVelocity.lerp(rawVel, 0.2);

    if (!this.handPresent) {
      this.handPresent = true;
      this.gatherTime  = 0;
      if (this.interactionState !== "dissolving") {
        this.interactionState = "gathering";
      }
    }
  }

  clearHand() {
    if (this.handPresent) {
      this.handPresent = false;
      if (this.interactionState !== "dissolving") {
        this.interactionState = "releasing";
      }
    }
  }

  // ── Destruction: smooth dissolve ─────────────────────────
  // Palm → Fist: particles gently drift apart (not explode)
  triggerDestruction() {
    if (this.interactionState === "dissolving") return;
    this.interactionState = "dissolving";
    this.dissolveTime     = 0;

    // Give each particle a soft random drift velocity
    for (let i = 0; i < this.count; i++) {
      const spd = 0.4 + Math.random() * 1.2;  // much gentler than before
      const vx  = (Math.random() - 0.5);
      const vy  = (Math.random() - 0.5);
      const vz  = (Math.random() - 0.5);
      const len = Math.sqrt(vx*vx + vy*vy + vz*vz) || 1;
      this.velocities[i*3]   = (vx/len) * spd;
      this.velocities[i*3+1] = (vy/len) * spd;
      this.velocities[i*3+2] = (vz/len) * spd;
    }
  }

  // ── Main update ───────────────────────────────────────────

  update(delta) {
    this.time += delta;
    this.handVelocity.multiplyScalar(0.85);
    const pos = this.positions;
    const t   = this.time;

    // ── Gathering / Gathered ──────────────────────────────
    if (this.interactionState === "gathering" || this.interactionState === "gathered") {
      this.gatherTime += delta;
      if (this.gatherTime > 0.5) this.interactionState = "gathered";

      const gProg = Math.min(this.gatherTime / 0.5, 1.0);
      const speed = this.handVelocity.length();
      const tailDir = this.handVelocity.clone().normalize().negate();

      for (let i = 0; i < this.count; i++) {
        const ph  = this.phase[i];
        const lag = this.lag[i];
        const ox = this.shapeOff[i*3], oy = this.shapeOff[i*3+1], oz = this.shapeOff[i*3+2];

        // Gentle breathing noise
        const amp = 0.1;
        const nx = noise3(ox, oy, oz, t*0.5+ph) * amp;
        const ny = noise3(oy, oz, ox, t*0.5+ph) * amp;
        const nz = noise3(oz, ox, oy, t*0.5+ph) * amp;

        // Tail: slow particles pushed back opposite to hand movement
        const tail = speed * (1 - lag) * 2.5;
        const tx = this.handPos.x + ox + nx + tailDir.x * tail;
        const ty = this.handPos.y + oy + ny + tailDir.y * tail;
        const tz = this.handPos.z + oz + nz + tailDir.z * tail;

        const k = (0.8 + lag * 3.5) * gProg;
        pos[i*3]   += (tx - pos[i*3])   * Math.min(1, k * delta);
        pos[i*3+1] += (ty - pos[i*3+1]) * Math.min(1, k * delta);
        pos[i*3+2] += (tz - pos[i*3+2]) * Math.min(1, k * delta);
      }

    // ── Releasing ─────────────────────────────────────────
    } else if (this.interactionState === "releasing") {
      for (let i = 0; i < this.count; i++) {
        const ph  = this.phase[i];
        const lag = this.lag[i];
        const sx = this.scattered[i*3], sy = this.scattered[i*3+1], sz = this.scattered[i*3+2];
        const w  = 0.4;
        const wx = noise3(sx, sy, sz, t*0.35+ph) * w;
        const wy = noise3(sy, sz, sx, t*0.35+ph) * w;
        const wz = noise3(sz, sx, sy, t*0.35+ph) * w;
        const k  = (0.25 + lag * 0.9) * 0.8;
        pos[i*3]   += (sx+wx - pos[i*3])   * Math.min(1, k * delta);
        pos[i*3+1] += (sy+wy - pos[i*3+1]) * Math.min(1, k * delta);
        pos[i*3+2] += (sz+wz - pos[i*3+2]) * Math.min(1, k * delta);
      }

      // Check if settled (sample 30 particles)
      let settled = true;
      for (let j = 0; j < 30; j++) {
        const i = Math.floor(Math.random() * this.count);
        const dx = pos[i*3] - this.scattered[i*3];
        const dy = pos[i*3+1] - this.scattered[i*3+1];
        if (dx*dx + dy*dy > 0.5) { settled = false; break; }
      }
      if (settled) this.interactionState = "scattered";

    // ── Scattered (idle, no hand) ─────────────────────────
    } else if (this.interactionState === "scattered") {
      for (let i = 0; i < this.count; i++) {
        const ph = this.phase[i];
        const sx = this.scattered[i*3], sy = this.scattered[i*3+1], sz = this.scattered[i*3+2];
        const amp = 0.28, spd = 0.22;
        const nx = noise3(sx, sy, sz, t*spd+ph) * amp;
        const ny = noise3(sy, sz, sx, t*spd+ph) * amp;
        const nz = noise3(sz, sx, sy, t*spd+ph) * amp;
        pos[i*3]   += (sx+nx - pos[i*3])   * Math.min(1, 1.4 * delta);
        pos[i*3+1] += (sy+ny - pos[i*3+1]) * Math.min(1, 1.4 * delta);
        pos[i*3+2] += (sz+nz - pos[i*3+2]) * Math.min(1, 1.4 * delta);
      }

    // ── Dissolving (smooth drift-apart) ──────────────────
    } else if (this.interactionState === "dissolving") {
      this.dissolveTime += delta;
      const dProg = Math.min(this.dissolveTime / 2.2, 1); // 2.2s total dissolve

      for (let i = 0; i < this.count; i++) {
        const ph = this.phase[i];
        // Slow drag on velocity
        this.velocities[i*3]   *= 0.97;
        this.velocities[i*3+1] *= 0.97;
        this.velocities[i*3+2] *= 0.97;

        // Add gentle swirling turbulence so it looks like smoke
        const turb = 0.15 * (1 - dProg);
        this.velocities[i*3]   += noise3(pos[i*3], pos[i*3+1], pos[i*3+2], t*1.2+ph) * turb * delta;
        this.velocities[i*3+1] += noise3(pos[i*3+1], pos[i*3+2], pos[i*3], t*1.1+ph) * turb * delta;
        this.velocities[i*3+2] += noise3(pos[i*3+2], pos[i*3], pos[i*3+1], t*0.9+ph) * turb * delta;

        pos[i*3]   += this.velocities[i*3]   * delta;
        pos[i*3+1] += this.velocities[i*3+1] * delta;
        pos[i*3+2] += this.velocities[i*3+2] * delta;
      }

      // After dissolve finishes, scatter back
      if (dProg >= 1) {
        this.interactionState = "releasing";
        this.handPresent = false;
      }
    }

    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ── Ambient background particles ────────────────────────────
export class AmbientParticles {
  constructor(scene, count = 300) {
    this.count = count;
    const geo  = new THREE.BufferGeometry();
    const pos  = new Float32Array(count * 3);
    const spds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 30;
      pos[i*3+1] = (Math.random() - 0.5) * 20;
      pos[i*3+2] = (Math.random() - 0.5) * 15;
      spds[i]    = 0.03 + Math.random() * 0.09;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.speeds = spds;

    const mat = new THREE.PointsMaterial({
      color: 0x7788aa,
      size: 0.04,
      transparent: true,
      opacity: 0.28,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    scene.add(this.points);
  }

  update(delta) {
    const p = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      p[i*3+1] += this.speeds[i] * delta;
      if (p[i*3+1] > 10) p[i*3+1] = -10;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}