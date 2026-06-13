// ============================================================
// particleSystem.js  (v3 — 3D Saturn ring, improved shapes)
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

function genSaturn(count) {
  const pts = [];
  const sphere = Math.floor(count * 0.55);
  const ring   = count - sphere;

  // Fibonacci sphere shell
  for (let i = 0; i < sphere; i++) {
    const idx = i + 0.5;
    const phi   = Math.acos(1 - 2 * idx / sphere);
    const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
    const r = 1.0 + (Math.random() - 0.5) * 0.22;
    pts.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    });
  }

  // 3D RING: multiple concentric bands with thickness & tilt
  const tiltX = 0.42; // ~24 degrees tilt
  const tiltZ = 0.12;
  for (let i = 0; i < ring; i++) {
    const a   = (i / ring) * Math.PI * 2;
    // Multiple bands: inner, middle, outer
    const bandRand = Math.random();
    let rr;
    if (bandRand < 0.2)       rr = 1.45 + Math.random() * 0.12; // inner (sparse)
    else if (bandRand < 0.7)  rr = 1.65 + Math.random() * 0.25; // main band
    else                       rr = 1.98 + Math.random() * 0.18; // outer halo

    // Ring has real 3D thickness (not just flat)
    const thick = (Math.random() - 0.5) * 0.22;
    const x0 = rr * Math.cos(a);
    const z0 = rr * Math.sin(a);
    const y0 = thick;

    // Apply tilt via rotation matrix (around X then Z)
    const cy = Math.cos(tiltX), sy = Math.sin(tiltX);
    const cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);

    // Rotate around X axis
    const x1 = x0;
    const y1 = y0 * cy - z0 * sy;
    const z1 = y0 * sy + z0 * cy;

    // Rotate around Z axis
    pts.push({
      x: x1 * cz - y1 * sz,
      y: x1 * sz + y1 * cz,
      z: z1,
    });
  }
  return pts;
}

function genHeart(count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
    const scale = 0.095;
    const nx = hx * scale + (Math.random() - 0.5) * 0.22;
    const ny = hy * scale + (Math.random() - 0.5) * 0.22;
    const nz = (Math.random() - 0.5) * 0.45;
    pts.push({ x: nx, y: ny - 0.2, z: nz });
  }
  return pts;
}

function genDragon(count) {
  const pts = [];
  // Body
  const bodyCount = Math.floor(count * 0.7);
  for (let i = 0; i < bodyCount; i++) {
    const t = (i / bodyCount) * Math.PI * 7;
    const progress = i / bodyCount;
    const bodyRadius = 0.28 * (1 - progress * 0.65);
    const phi = Math.random() * Math.PI * 2;
    const spineX = Math.sin(t * 0.6) * (1.3 - progress * 0.4);
    const spineY = (progress - 0.5) * 3.8;
    const spineZ = Math.cos(t * 0.45) * 0.7;
    pts.push({
      x: spineX + Math.cos(phi) * bodyRadius,
      y: spineY + (Math.random() - 0.5) * 0.12,
      z: spineZ + Math.sin(phi) * bodyRadius,
    });
  }
  // Wings — fan out from upper body
  const wingCount = count - bodyCount;
  for (let i = 0; i < wingCount; i++) {
    const side = i < wingCount / 2 ? 1 : -1;
    const t = Math.random();
    const ww = 1.1 + t * 1.2;
    const wh = (Math.random() - 0.5) * 1.5;
    const wy = 0.4 + t * 0.8 + (Math.random() - 0.5) * 0.3;
    pts.push({
      x: side * ww,
      y: wy,
      z: wh * 0.4,
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

export const SHAPES = ["saturn", "love", "dragon", "sphere"];
export const SHAPE_NAMES_DISPLAY = {
  saturn: "Saturn 🪐",
  love:   "Love ❤️",
  dragon: "Dragon 🐉",
  sphere: "Sphere ⚪",
};

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

    this.shapeIdx  = 0;
    this.shapeName = SHAPES[0];

    this.interactionState = "scattered";
    this.handPos     = new THREE.Vector3();
    this.prevHandPos = new THREE.Vector3();
    this.handVelocity = new THREE.Vector3();
    this.handPresent = false;
    this.gatherTime  = 0;
    this.dissolveTime = 0;

    this.positions   = new Float32Array(count * 3);
    this.scattered   = new Float32Array(count * 3);
    this.shapeOff    = new Float32Array(count * 3);
    this.velocities  = new Float32Array(count * 3);
    this.phase       = new Float32Array(count);
    this.lag         = new Float32Array(count);

    const colors = new Float32Array(count * 3);

    // Shape-aware color palettes (updated on shape switch)
    this._colorPalette = this._getPalette(this.shapeName);
    this._colors = colors;

    for (let i = 0; i < count; i++) {
      this.scattered[i*3]   = (Math.random() - 0.5) * 22;
      this.scattered[i*3+1] = (Math.random() - 0.5) * 14;
      this.scattered[i*3+2] = (Math.random() - 0.5) * 10;
      this.positions[i*3]   = this.scattered[i*3];
      this.positions[i*3+1] = this.scattered[i*3+1];
      this.positions[i*3+2] = this.scattered[i*3+2];
      this.phase[i] = Math.random() * Math.PI * 2;
      this.lag[i]   = 0.1 + Math.random() * 0.9;
    }

    this._applyColors(this.shapeName);
    this._buildShapeOffsets(this.shapeName);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color",    new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size:         0.065,
      vertexColors: true,
      transparent:  true,
      opacity:      0.88,
      blending:     THREE.NormalBlending,
      depthWrite:   false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  _getPalette(name) {
    switch(name) {
      case "saturn": return [new THREE.Color(0xe8d5a0), new THREE.Color(0xc4a87a), new THREE.Color(0x9fc8e8)];
      case "love":   return [new THREE.Color(0xff6b8a), new THREE.Color(0xff3366), new THREE.Color(0xffaacc)];
      case "dragon": return [new THREE.Color(0xff6600), new THREE.Color(0xff2200), new THREE.Color(0xffaa00)];
      case "sphere": return [new THREE.Color(0x9fc8e8), new THREE.Color(0xc4aee0), new THREE.Color(0xe8c0d5)];
      default:       return [new THREE.Color(0x9fc8e8), new THREE.Color(0xc4aee0), new THREE.Color(0xe8c0d5)];
    }
  }

  _applyColors(name) {
    const [cA, cB, cC] = this._getPalette(name);
    const colors = this._colors;
    for (let i = 0; i < this.count; i++) {
      const mix = Math.random();
      const c = mix < 0.5
        ? cA.clone().lerp(cB, mix * 2)
        : cB.clone().lerp(cC, (mix - 0.5) * 2);
      colors[i*3]   = c.r;
      colors[i*3+1] = c.g;
      colors[i*3+2] = c.b;
    }
    if (this.points) this.points.geometry.attributes.color.needsUpdate = true;
  }

  _buildShapeOffsets(name) {
    const gen = SHAPE_GENERATORS[name] || genSphere;
    const pts = gen(this.count);
    for (let i = 0; i < this.count; i++) {
      this.shapeOff[i*3]   = pts[i].x;
      this.shapeOff[i*3+1] = pts[i].y;
      this.shapeOff[i*3+2] = pts[i].z;
    }
  }

  _switchShape(name) {
    this.shapeName = name;
    this._buildShapeOffsets(name);
    this._applyColors(name);
  }

  nextShape() {
    this.shapeIdx  = (this.shapeIdx + 1) % SHAPES.length;
    this._switchShape(SHAPES[this.shapeIdx]);
  }

  prevShape() {
    this.shapeIdx  = (this.shapeIdx - 1 + SHAPES.length) % SHAPES.length;
    this._switchShape(SHAPES[this.shapeIdx]);
  }

  setShape(name) {
    const idx = SHAPES.indexOf(name);
    if (idx === -1) return;
    this.shapeIdx = idx;
    this._switchShape(name);
  }

  getShapeName() { return SHAPE_NAMES_DISPLAY[this.shapeName] || this.shapeName; }
  getShapeKey()  { return this.shapeName; }

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

  triggerDestruction() {
    if (this.interactionState === "dissolving") return;
    this.interactionState = "dissolving";
    this.dissolveTime     = 0;

    for (let i = 0; i < this.count; i++) {
      // Burst outward from current position + some spiral
      const spd = 0.8 + Math.random() * 2.5;
      const angle = Math.random() * Math.PI * 2;
      const elev  = (Math.random() - 0.5) * Math.PI;
      this.velocities[i*3]   = Math.cos(elev) * Math.cos(angle) * spd;
      this.velocities[i*3+1] = Math.sin(elev) * spd;
      this.velocities[i*3+2] = Math.cos(elev) * Math.sin(angle) * spd;
    }
  }

  update(delta) {
    this.time += delta;
    this.handVelocity.multiplyScalar(0.85);
    const pos = this.positions;
    const t   = this.time;

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

        const amp = 0.1;
        const nx = noise3(ox, oy, oz, t*0.5+ph) * amp;
        const ny = noise3(oy, oz, ox, t*0.5+ph) * amp;
        const nz = noise3(oz, ox, oy, t*0.5+ph) * amp;

        const tail = speed * (1 - lag) * 2.5;
        const tx = this.handPos.x + ox + nx + tailDir.x * tail;
        const ty = this.handPos.y + oy + ny + tailDir.y * tail;
        const tz = this.handPos.z + oz + nz + tailDir.z * tail;

        const k = (0.8 + lag * 3.5) * gProg;
        pos[i*3]   += (tx - pos[i*3])   * Math.min(1, k * delta);
        pos[i*3+1] += (ty - pos[i*3+1]) * Math.min(1, k * delta);
        pos[i*3+2] += (tz - pos[i*3+2]) * Math.min(1, k * delta);
      }

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

      let settled = true;
      for (let j = 0; j < 30; j++) {
        const i = Math.floor(Math.random() * this.count);
        const dx = pos[i*3] - this.scattered[i*3];
        const dy = pos[i*3+1] - this.scattered[i*3+1];
        if (dx*dx + dy*dy > 0.5) { settled = false; break; }
      }
      if (settled) this.interactionState = "scattered";

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

    } else if (this.interactionState === "dissolving") {
      this.dissolveTime += delta;
      const dProg = Math.min(this.dissolveTime / 2.0, 1);

      for (let i = 0; i < this.count; i++) {
        const ph = this.phase[i];
        this.velocities[i*3]   *= 0.96;
        this.velocities[i*3+1] *= 0.96;
        this.velocities[i*3+2] *= 0.96;

        const turb = 0.2 * (1 - dProg);
        this.velocities[i*3]   += noise3(pos[i*3], pos[i*3+1], pos[i*3+2], t*1.2+ph) * turb * delta;
        this.velocities[i*3+1] += noise3(pos[i*3+1], pos[i*3+2], pos[i*3], t*1.1+ph) * turb * delta;
        this.velocities[i*3+2] += noise3(pos[i*3+2], pos[i*3], pos[i*3+1], t*0.9+ph) * turb * delta;

        pos[i*3]   += this.velocities[i*3]   * delta;
        pos[i*3+1] += this.velocities[i*3+1] * delta;
        pos[i*3+2] += this.velocities[i*3+2] * delta;
      }

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
