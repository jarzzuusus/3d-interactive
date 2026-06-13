// ============================================================
// threeScene.js
// Sets up the Three.js scene, camera, renderer, lighting,
// post-processing (bloom), the interactive 3D object, its
// gesture-based morph animations, and the "destruction" effect.
// ============================================================

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/OutputPass.js";

import { AmbientParticles, BurstParticles, HandTrail } from "./particleSystem.js";

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();

    // Target transform (driven by hand position) and current transform
    // (smoothed toward target each frame for natural floating motion)
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.targetRotation = new THREE.Euler(0, 0, 0);
    this.currentVelocity = new THREE.Vector3(0, 0, 0);

    this.floatTime = 0;

    // Gesture state machine
    this.currentMode = "default"; // default | love | heart | destruction
    this.morphProgress = 0; // 0..1 for love morph
    this.heartPulse = 0;

    // Destruction state
    this.destructionActive = false;
    this.destructionTime = 0;
    this.destructionDuration = 3.5; // total seconds for scatter+reassemble
    this.fragments = [];
    this.fragmentGroup = null;

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._initObjects();
    this._initParticles();
    this._initPostProcessing();
    this._handleResize();

    window.addEventListener("resize", () => this._handleResize());
  }

  // ----------------------------------------------------------
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();

    // Futuristic dark gradient background using a large sphere with
    // a vertex-colored gradient material (cheaper than a texture).
    const bgGeo = new THREE.SphereGeometry(50, 32, 32);
    const bgMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x0a0e2a) },
        bottomColor: { value: new THREE.Color(0x000005) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y * 0.5 + 0.5;
          gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(bgGeo, bgMat));

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 6);
  }

  _initLights() {
    const ambient = new THREE.AmbientLight(0x88aaff, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(4, 6, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(dirLight);

    // Colored rim lights for futuristic feel
    const pinkLight = new THREE.PointLight(0xff2bd6, 2, 12);
    pinkLight.position.set(-3, 1, 3);
    this.scene.add(pinkLight);
    this.pinkLight = pinkLight;

    const cyanLight = new THREE.PointLight(0x00f0ff, 1.5, 12);
    cyanLight.position.set(3, -1, 3);
    this.scene.add(cyanLight);

    // Ground plane for shadow/reflection feel
    const groundGeo = new THREE.PlaneGeometry(40, 40);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x05060f,
      metalness: 0.8,
      roughness: 0.25,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.5;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // ----------------------------------------------------------
  // Main object setup: builds geometries for each selectable
  // model and the "love" / "heart" target shapes used for morphing.
  // ----------------------------------------------------------
  _initObjects() {
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x66ccff,
      metalness: 0.4,
      roughness: 0.15,
      transmission: 0.35,
      thickness: 1.2,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      emissive: 0x113355,
      emissiveIntensity: 0.4,
    });

    // Base geometries (each must have the SAME vertex count as the
    // heart geometry for morph targets to work — we generate them
    // with matching detail levels).
    this.geometries = {
      sphere: new THREE.IcosahedronGeometry(1.1, 4),
      crystal: new THREE.OctahedronGeometry(1.3, 2),
      heart: this._createHeartGeometry(1.0),
      torusKnot: new THREE.TorusKnotGeometry(0.8, 0.28, 128, 16),
    };

    // For morphing we need the love-shape (small heart) and the
    // big heart-logo shape as morph targets on the active geometry.
    // We attach a "love" morph target derived from a heart shape
    // resampled to match each base geometry's vertex count.
    Object.keys(this.geometries).forEach((key) => {
      const geo = this.geometries[key];
      const heartTarget = this._matchHeartMorphTarget(geo);
      geo.morphAttributes.position = [heartTarget];
    });

    this.currentModelKey = "crystal";
    this.mesh = new THREE.Mesh(this.geometries[this.currentModelKey], this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.morphTargetInfluences = [0];
    this.scene.add(this.mesh);

    // Group for destruction fragments (created on demand)
    this.fragmentGroup = new THREE.Group();
    this.scene.add(this.fragmentGroup);
  }

  /**
   * Generates a heart-shaped geometry using a parametric 2D heart
   * curve extruded/lathed into a 3D-ish heart silhouette.
   */
  _createHeartGeometry(scale = 1) {
    const shape = new THREE.Shape();
    const x = 0, y = 0;
    shape.moveTo(x, y + 0.5 * scale);
    shape.bezierCurveTo(x, y + 0.5 * scale, x - 0.5 * scale, y, x - 0.9 * scale, y);
    shape.bezierCurveTo(x - 1.5 * scale, y, x - 1.5 * scale, y + 0.75 * scale, x - 1.5 * scale, y + 0.75 * scale);
    shape.bezierCurveTo(x - 1.5 * scale, y + 1.15 * scale, x - 1.1 * scale, y + 1.6 * scale, x, y + 2.1 * scale);
    shape.bezierCurveTo(x + 1.1 * scale, y + 1.6 * scale, x + 1.5 * scale, y + 1.15 * scale, x + 1.5 * scale, y + 0.75 * scale);
    shape.bezierCurveTo(x + 1.5 * scale, y + 0.75 * scale, x + 1.5 * scale, y, x + 0.9 * scale, y);
    shape.bezierCurveTo(x + 0.5 * scale, y, x, y + 0.5 * scale, x, y + 0.5 * scale);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.6 * scale,
      bevelEnabled: true,
      bevelThickness: 0.15 * scale,
      bevelSize: 0.1 * scale,
      bevelSegments: 4,
      curveSegments: 24,
    });
    geo.center();
    geo.rotateX(Math.PI); // orient heart point downward correctly
    geo.scale(0.9, 0.9, 0.9);
    return geo;
  }

  /**
   * Resamples the heart geometry's vertex positions to match the
   * vertex count of `targetGeo` so it can be used as a morph target.
   * Uses nearest-vertex mapping from a precomputed heart point cloud.
   */
  _matchHeartMorphTarget(targetGeo) {
    if (!this._heartPositionsCache) {
      const heartGeo = this._createHeartGeometry(1.0);
      this._heartPositionsCache = heartGeo.attributes.position.array;
      this._heartCount = this._heartPositionsCache.length / 3;
    }

    const targetCount = targetGeo.attributes.position.count;
    const out = new Float32Array(targetCount * 3);
    const heartPos = this._heartPositionsCache;

    for (let i = 0; i < targetCount; i++) {
      // Map each target vertex to a heart vertex via modulo sampling
      const srcIdx = (i % this._heartCount) * 3;
      out[i * 3] = heartPos[srcIdx];
      out[i * 3 + 1] = heartPos[srcIdx + 1];
      out[i * 3 + 2] = heartPos[srcIdx + 2];
    }

    return new THREE.BufferAttribute(out, 3);
  }

  _initParticles() {
    this.ambientParticles = new AmbientParticles(this.scene, 500);
    this.loveBurst = new BurstParticles(this.scene, 0xff4fd8, 220);
    this.helloBurst = new BurstParticles(this.scene, 0x00f0ff, 180);
    this.handTrail = new HandTrail(this.scene, 0x00f0ff, 40);
  }

  _initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.9, // strength
      0.6, // radius
      0.15 // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.composer.addPass(new OutputPass());
  }

  _handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  // ----------------------------------------------------------
  // Public API: switch the active base model
  // ----------------------------------------------------------
  setModel(key) {
    if (!this.geometries[key] || key === this.currentModelKey) return;
    this.currentModelKey = key;
    this.mesh.geometry = this.geometries[key];
    this.mesh.morphTargetInfluences = [this.mesh.morphTargetInfluences?.[0] || 0];
  }

  // ----------------------------------------------------------
  // Public API: update target position/rotation from hand data.
  // Called every frame with normalized hand landmark info.
  // ----------------------------------------------------------
  setHandTarget(position, rotation) {
    this.targetPosition.copy(position);
    this.targetRotation.copy(rotation);
  }

  clearHandTarget() {
    // When no hand is detected, let the object drift back to center
    this.targetPosition.lerp(new THREE.Vector3(0, 0, 0), 0.02);
  }

  // ----------------------------------------------------------
  // Gesture-driven mode switching
  // ----------------------------------------------------------
  setMode(mode) {
    if (mode === this.currentMode) return;

    const prevMode = this.currentMode;
    this.currentMode = mode;

    if (mode === "love" && prevMode !== "love") {
      this.loveBurst.trigger(this.mesh.position);
    }
    if (mode === "destruction" && !this.destructionActive) {
      this._startDestruction();
    }
    if (mode === "default" && this.destructionActive) {
      // allow current destruction animation to finish naturally
    }
  }

  triggerHelloEffect() {
    this.helloBurst.trigger(
      new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + 1.2, this.mesh.position.z)
    );
  }

  // ----------------------------------------------------------
  // Destruction effect: splits the main mesh into small fragment
  // cubes that scatter outward then reassemble.
  // ----------------------------------------------------------
  _startDestruction() {
    this.destructionActive = true;
    this.destructionTime = 0;

    // Clear old fragments
    this.fragmentGroup.clear();
    this.fragments = [];

    const fragCount = 60;
    const origin = this.mesh.position.clone();

    for (let i = 0; i < fragCount; i++) {
      const size = 0.08 + Math.random() * 0.12;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = this.material.clone();
      mat.emissive = new THREE.Color(0x3399ff);
      mat.emissiveIntensity = 0.6;

      const frag = new THREE.Mesh(geo, mat);
      frag.position.copy(origin);
      frag.castShadow = true;

      // Random scatter direction & target rotation
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();

      this.fragments.push({
        mesh: frag,
        origin: origin.clone(),
        scatterTarget: origin.clone().add(dir.multiplyScalar(1.5 + Math.random() * 1.5)),
        rotSpeed: new THREE.Vector3(
          Math.random() * 4 - 2,
          Math.random() * 4 - 2,
          Math.random() * 4 - 2
        ),
      });
      this.fragmentGroup.add(frag);
    }

    this.mesh.visible = false;
  }

  _updateDestruction(delta) {
    if (!this.destructionActive) return;

    this.destructionTime += delta;
    const t = this.destructionTime / this.destructionDuration;

    // Phase 1 (0 - 0.4): scatter outward
    // Phase 2 (0.4 - 0.6): hold
    // Phase 3 (0.6 - 1.0): reassemble
    let progress;
    if (t < 0.4) {
      progress = this._easeOutCubic(t / 0.4); // 0 -> 1 scatter
    } else if (t < 0.6) {
      progress = 1; // hold scattered
    } else if (t < 1.0) {
      progress = 1 - this._easeInOutCubic((t - 0.6) / 0.4); // 1 -> 0 reassemble
    } else {
      progress = 0;
    }

    for (const f of this.fragments) {
      f.mesh.position.lerpVectors(f.origin, f.scatterTarget, progress);
      f.mesh.rotation.x += f.rotSpeed.x * delta * progress;
      f.mesh.rotation.y += f.rotSpeed.y * delta * progress;
      f.mesh.rotation.z += f.rotSpeed.z * delta * progress;
    }

    if (t >= 1.0) {
      this.destructionActive = false;
      this.fragmentGroup.clear();
      this.mesh.visible = true;
      if (this.currentMode === "destruction") {
        this.currentMode = "default";
      }
    }
  }

  _easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  _easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ----------------------------------------------------------
  // Per-frame update — called from main.js render loop
  // ----------------------------------------------------------
  update() {
    const delta = this.clock.getDelta();
    this.floatTime += delta;

    // --- Smooth follow with inertia (critically-damped lerp) ---
    const posLerpFactor = 1 - Math.pow(0.0001, delta); // frame-rate independent smoothing
    this.mesh.position.lerp(this.targetPosition, posLerpFactor * 0.6);

    // Floating bob effect (sine wave offset on top of hand position)
    const floatOffset = Math.sin(this.floatTime * 1.5) * 0.08;
    this.mesh.position.y += floatOffset * delta * 2;

    // --- Smooth rotation via quaternion slerp ---
    const targetQuat = new THREE.Quaternion().setFromEuler(this.targetRotation);
    this.mesh.quaternion.slerp(targetQuat, posLerpFactor * 0.5);

    // --- Morph target influence (Open Palm -> Love shape) ---
    let morphTarget = this.currentMode === "love" ? 1 : 0;
    this.morphProgress = THREE.MathUtils.lerp(this.morphProgress, morphTarget, 0.08);
    if (this.mesh.morphTargetInfluences) {
      this.mesh.morphTargetInfluences[0] = this.morphProgress;
    }

    // --- Heart pulse animation ---
    if (this.currentMode === "heart") {
      this.heartPulse += delta * 4;
      const scale = 1.4 + Math.sin(this.heartPulse) * 0.15;
      this.mesh.scale.setScalar(scale);
      this.morphProgress = THREE.MathUtils.lerp(this.morphProgress, 1, 0.1);
      if (this.mesh.morphTargetInfluences) {
        this.mesh.morphTargetInfluences[0] = this.morphProgress;
      }
    } else {
      this.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.08);
    }

    // --- Pink glow when in love/heart mode ---
    const targetIntensity = (this.currentMode === "love" || this.currentMode === "heart") ? 4 : 2;
    this.pinkLight.intensity = THREE.MathUtils.lerp(this.pinkLight.intensity, targetIntensity, 0.05);

    // --- Hand trail ---
    this.handTrail.addPoint(this.mesh.position);

    // --- Particles ---
    this.ambientParticles.update(delta);
    this.loveBurst.update(delta);
    this.helloBurst.update(delta);

    // --- Destruction ---
    this._updateDestruction(delta);

    // --- Render ---
    this.composer.render();
  }
}
