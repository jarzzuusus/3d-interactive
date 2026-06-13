// ============================================================
// threeScene.js  (v3 — shape switching, 2-hand, subtle bloom)
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
    this.container   = container;
    this.clock       = new THREE.Clock();
    this._handPos    = [new THREE.Vector3(), new THREE.Vector3()];

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._initObjects();
    this._initPostProcessing();
    this._handleResize();

    window.addEventListener("resize", () => this._handleResize());
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();

    // Dark gradient bg
    const bgGeo = new THREE.SphereGeometry(50, 32, 32);
    const bgMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor:    { value: new THREE.Color(0x080c1e) },
        bottomColor: { value: new THREE.Color(0x000003) },
      },
      vertexShader: `
        varying vec3 vWP;
        void main() {
          vWP = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor, bottomColor;
        varying vec3 vWP;
        void main() {
          float h = normalize(vWP).y * 0.5 + 0.5;
          gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(bgGeo, bgMat));

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 8);
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(4, 6, 5);
    this.scene.add(dir);
    const fill1 = new THREE.PointLight(0x8899ff, 0.5, 22);
    fill1.position.set(-4, 2, 4);
    this.scene.add(fill1);
    const fill2 = new THREE.PointLight(0xffaacc, 0.35, 22);
    fill2.position.set(4, -2, 4);
    this.scene.add(fill2);
  }

  _initObjects() {
    this.particleObject   = new ParticleObject(this.scene, 4000);
    this.ambientParticles = new AmbientParticles(this.scene, 300);
    this.textSystem       = new TextSystem(this.scene);
  }

  _initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Subtle bloom: only very bright spots glow, not everything
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.28,   // strength
      0.45,   // radius
      0.72    // threshold (high = very selective)
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.effects = new Effects(this.camera, this.bloomPass, this.composer);
  }

  _handleResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  // ── Hand tracking API ─────────────────────────────────────
  // handIdx: 0 = primary, 1 = secondary
  setHandTarget(position, rotation, handIdx = 0) {
    this._handPos[handIdx].copy(position);
    // Primary hand drives the particle object
    if (handIdx === 0) {
      this.particleObject.setHandTarget(position);
    }
    // Secondary hand could drive a second object in future
  }

  clearHandTarget(handIdx = 0) {
    if (handIdx === 0) this.particleObject.clearHand();
  }

  // ── Gesture-driven actions ────────────────────────────────
  triggerDestruction() {
    this.particleObject.triggerDestruction();
    this.effects.triggerShake(0.18, 0.4);         // subtle shake
    this.effects.triggerBloomBoost(0.5, 0.7);     // brief gentle bloom
  }

  spawnText()   { this.textSystem.spawn(); }
  removeText()  { this.textSystem.remove(); }
  changeText()  { this.textSystem.changeText(); }

  nextShape() {
    this.particleObject.nextShape();
    return this.particleObject.getShapeName();
  }
  prevShape() {
    this.particleObject.prevShape();
    return this.particleObject.getShapeName();
  }
  getShapeName() { return this.particleObject.getShapeName(); }

  // ── Render ────────────────────────────────────────────────
  update() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const anchor = this._handPos[0];

    this.particleObject.update(delta);
    this.ambientParticles.update(delta);
    this.textSystem.update(delta, anchor);
    this.effects.update(delta);

    this.composer.render();
  }
}