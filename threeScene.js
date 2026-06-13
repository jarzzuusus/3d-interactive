// ============================================================
// threeScene.js
// Sets up the Three.js scene, camera, renderer, lighting,
// background, post-processing (bloom + afterimage), the
// particle-based object, ambient particles, holographic text,
// and cinematic effects. Exposes setHandTarget for smooth,
// inertia-based hand-follow.
// ============================================================

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { ParticleObject, AmbientParticles } from "./particleSystem.js";
import { TextSystem } from "./textSystem.js";
import { Effects } from "./effects.js";

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();

    // Hand-follow target + spring state
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.targetRotation = new THREE.Euler(0, 0, 0);

    this._initRenderer();
    this._initScene();
    this._initLights();
    this._initObjects();
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();

    // Dark futuristic gradient background sphere
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

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 6);
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0x88aaff, 0.5));

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(4, 6, 5);
    this.scene.add(dirLight);

    this.pinkLight = new THREE.PointLight(0xff2bd6, 2, 12);
    this.pinkLight.position.set(-3, 1, 3);
    this.scene.add(this.pinkLight);

    const cyanLight = new THREE.PointLight(0x00f0ff, 1.5, 12);
    cyanLight.position.set(3, -1, 3);
    this.scene.add(cyanLight);
  }

  _initObjects() {
    this.particleObject = new ParticleObject(this.scene, 7000);
    this.ambientParticles = new AmbientParticles(this.scene, 500);
    this.textSystem = new TextSystem(this.scene);
  }

  _initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.25, // strength — strong bloom for the glowing particles
      0.7,  // radius
      0.08  // threshold
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

  // ----------------------------------------------------------
  // Hand-follow target. Actual motion is spring-damped in update()
  // so movement feels natural with inertia and no jitter.
  // ----------------------------------------------------------
  setHandTarget(position, rotation) {
    this.targetPosition.copy(position);
    this.targetRotation.copy(rotation);
  }

  clearHandTarget() {
    // Drift gently back toward center when no hand is detected
    this.targetPosition.lerp(new THREE.Vector3(0, 0, 0), 0.01);
  }

  // ----------------------------------------------------------
  // Gesture-driven actions
  // ----------------------------------------------------------
  triggerDestruction() {
    this.particleObject.triggerDestruction();
    this.effects.triggerShake(0.45, 0.7);
    this.effects.triggerBloomBoost(2.0, 1.2);
    this.effects.triggerMotionBlur(1.0);
  }

  spawnText() {
    this.textSystem.spawn();
  }
  removeText() {
    this.textSystem.remove();
  }
  changeText() {
    this.textSystem.changeText();
  }

  // ----------------------------------------------------------
  update() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const group = this.particleObject.points;

    // --- Spring-damped follow (critically-damped-ish spring) ---
    const springK = 18; // stiffness
    const damping = 8; // damping

    const accel = new THREE.Vector3()
      .subVectors(this.targetPosition, group.position)
      .multiplyScalar(springK);
    accel.addScaledVector(this.velocity, -damping);

    this.velocity.addScaledVector(accel, delta);
    group.position.addScaledVector(this.velocity, delta);

    // Mirror the group's transform onto the trail/ring helpers via
    // particleObject.update -> trail; text system follows group position.

    // --- Smooth rotation follow ---
    const targetQuat = new THREE.Quaternion().setFromEuler(this.targetRotation);
    group.quaternion.slerp(targetQuat, 1 - Math.pow(0.0001, delta));

    // --- Updates ---
    this.particleObject.update(delta);
    this.ambientParticles.update(delta);
    this.textSystem.update(delta, group.position);
    this.effects.update(delta);

    // --- Render ---
    this.composer.render();
  }
}