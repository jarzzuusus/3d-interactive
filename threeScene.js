// ============================================================
// threeScene.js  (reworked for new particle system)
// Sets up Three.js scene, camera, renderer, lighting,
// post-processing (lighter bloom), and wires the new
// ParticleObject / AmbientParticles system.
// ============================================================

import * as THREE from "three";
import { EffectComposer }  from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass }      from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "three/addons/postprocessing/OutputPass.js";

import { ParticleObject, AmbientParticles } from "./particleSystem.js";
import { TextSystem }  from "./textSystem.js";
import { Effects }     from "./effects.js";

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.clock     = new THREE.Clock();

    // Current hand position in world space (set by main.js)
    this._handWorldPos = new THREE.Vector3(0, 0, 0);

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._initObjects();
    this._initPostProcessing();
    this._handleResize();

    window.addEventListener("resize", () => this._handleResize());
  }

  // ── Init ──────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();

    // Subtle gradient background
    const bgGeo = new THREE.SphereGeometry(50, 32, 32);
    const bgMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor:    { value: new THREE.Color(0x0a0e2a) },
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

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 8);
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(4, 6, 5);
    this.scene.add(dir);

    // Subtle coloured fills — kept dim so particles read as plain 3D
    const fill1 = new THREE.PointLight(0x8888ff, 0.6, 20);
    fill1.position.set(-4, 2, 4);
    this.scene.add(fill1);

    const fill2 = new THREE.PointLight(0xffaacc, 0.4, 20);
    fill2.position.set(4, -2, 4);
    this.scene.add(fill2);
  }

  _initObjects() {
    this.particleObject  = new ParticleObject(this.scene, 4000);
    this.ambientParticles = new AmbientParticles(this.scene, 300);
    this.textSystem      = new TextSystem(this.scene);
  }

  _initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Much lighter bloom — just a soft glow halo, not full neon
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.35,  // strength  ← was 1.25
      0.5,   // radius
      0.6    // threshold ← was 0.08 (higher = fewer things bloom)
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.effects = new Effects(this.camera, this.bloomPass, this.composer);
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

  // ── Hand tracking API ─────────────────────────────────────

  setHandTarget(position /*, rotation */) {
    this._handWorldPos.copy(position);
    this.particleObject.setHandTarget(position);
  }

  clearHandTarget() {
    this.particleObject.clearHand();
  }

  // ── Gesture actions ───────────────────────────────────────

  triggerDestruction() {
    this.particleObject.triggerDestruction();
    this.effects.triggerShake(0.3, 0.5);
    this.effects.triggerBloomBoost(0.6, 0.8);
  }

  spawnText()  { this.textSystem.spawn(); }
  removeText() { this.textSystem.remove(); }
  changeText() { this.textSystem.changeText(); }

  // ── Render loop ───────────────────────────────────────────

  update() {
    const delta = Math.min(this.clock.getDelta(), 0.05);

    this.particleObject.update(delta);
    this.ambientParticles.update(delta);
    this.textSystem.update(delta, this._handWorldPos);
    this.effects.update(delta);

    this.composer.render();
  }
}