// ============================================================
// effects.js
// Cinematic effect helpers triggered by gestures:
//  - Camera shake (decaying random offset)
//  - Bloom boost (temporary strength spike, eases back down)
//  - Motion blur (AfterimagePass damp pulse)
// ============================================================

import * as THREE from "three";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";

export class Effects {
  /**
   * @param {THREE.Camera} camera
   * @param {UnrealBloomPass} bloomPass
   * @param {EffectComposer} composer
   */
  constructor(camera, bloomPass, composer) {
    this.camera = camera;
    this.bloomPass = bloomPass;
    this.baseBloom = bloomPass.strength;

    this.camBasePos = camera.position.clone();

    this.shakeIntensity = 0;
    this.shakeTime = 0;
    this.shakeDuration = 0;

    this.bloomBoost = 0;
    this.bloomTime = 0;
    this.bloomDuration = 0;

    this.afterimagePass = new AfterimagePass(0);
    composer.addPass(this.afterimagePass);
    this.blurDuration = 0;
    this.blurTime = 0;
  }

  triggerShake(intensity = 0.4, duration = 0.6) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTime = 0;
  }

  triggerBloomBoost(amount = 1.5, duration = 1.0) {
    this.bloomBoost = amount;
    this.bloomDuration = duration;
    this.bloomTime = 0;
  }

  triggerMotionBlur(duration = 1.0) {
    this.blurDuration = duration;
    this.blurTime = 0;
  }

  update(delta) {
    // --- Camera shake ---
    if (this.shakeIntensity > 0) {
      this.shakeTime += delta;
      const t = this.shakeTime / this.shakeDuration;
      if (t >= 1) {
        this.shakeIntensity = 0;
        this.camera.position.copy(this.camBasePos);
      } else {
        const amp = this.shakeIntensity * (1 - t);
        this.camera.position.set(
          this.camBasePos.x + (Math.random() - 0.5) * amp,
          this.camBasePos.y + (Math.random() - 0.5) * amp,
          this.camBasePos.z + (Math.random() - 0.5) * amp * 0.5
        );
      }
    }

    // --- Bloom boost (eases back to base strength) ---
    if (this.bloomBoost > 0) {
      this.bloomTime += delta;
      const t = Math.min(this.bloomTime / this.bloomDuration, 1);
      const extra = this.bloomBoost * (1 - t);
      this.bloomPass.strength = this.baseBloom + extra;
      if (t >= 1) this.bloomBoost = 0;
    } else {
      this.bloomPass.strength = this.baseBloom;
    }

    // --- Motion blur (afterimage damp pulse) ---
    if (this.blurDuration > 0) {
      this.blurTime += delta;
      const t = Math.min(this.blurTime / this.blurDuration, 1);
      this.afterimagePass.uniforms["damp"].value = 0.85 * (1 - t);
      if (t >= 1) {
        this.blurDuration = 0;
        this.afterimagePass.uniforms["damp"].value = 0;
      }
    } else {
      this.afterimagePass.uniforms["damp"].value = 0;
    }
  }
}
