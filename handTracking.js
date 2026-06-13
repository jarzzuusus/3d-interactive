// ============================================================
// handTracking.js
// Wraps MediaPipe Hand Landmarker (Tasks Vision) for real-time
// webcam hand tracking with exponential-moving-average smoothing
// to keep particle/object motion jitter-free.
// ============================================================

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

export class HandTracker {
  /**
   * @param {HTMLVideoElement} videoElement
   * @param {Function} onResults - callback(results, timestamp)
   */
  constructor(videoElement, onResults) {
    this.video = videoElement;
    this.onResults = onResults;
    this.landmarker = null;
    this.running = false;
    this.lastVideoTime = -1;

    // Smoothing buffers: keep previous landmark sets per hand index
    this.smoothedLandmarks = [null, null];
    this.smoothingFactor = 0.35; // lower = smoother but more lag
  }

  /**
   * Initialize the MediaPipe HandLandmarker with GPU acceleration.
   */
  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
  }

  /**
   * Start the webcam stream.
   * Throws an error if camera permission is denied or unavailable.
   */
  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia is not supported in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false,
    });

    this.video.srcObject = stream;

    return new Promise((resolve, reject) => {
      this.video.onloadedmetadata = () => {
        this.video.play().then(resolve).catch(reject);
      };
      this.video.onerror = () => reject(new Error("Failed to load video stream."));
    });
  }

  /**
   * Begin the detection loop. Should be called inside a
   * requestAnimationFrame loop via `detectFrame()`.
   */
  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  /**
   * Run detection on the current video frame.
   * Call this once per animation frame.
   */
  detectFrame(timestampMs) {
    if (!this.running || !this.landmarker) return;
    if (this.video.readyState < 2) return; // not enough data yet

    // Avoid re-processing the same frame
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const results = this.landmarker.detectForVideo(this.video, timestampMs);

    // Apply temporal smoothing (exponential moving average) per hand
    const smoothedHands = [];
    if (results.landmarks) {
      for (let i = 0; i < results.landmarks.length; i++) {
        const raw = results.landmarks[i];
        const prev = this.smoothedLandmarks[i];

        let smoothed;
        if (!prev || prev.length !== raw.length) {
          smoothed = raw.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        } else {
          smoothed = raw.map((p, idx) => ({
            x: this._lerp(prev[idx].x, p.x, this.smoothingFactor),
            y: this._lerp(prev[idx].y, p.y, this.smoothingFactor),
            z: this._lerp(prev[idx].z, p.z, this.smoothingFactor),
          }));
        }
        this.smoothedLandmarks[i] = smoothed;
        smoothedHands.push(smoothed);
      }
      // Clear stale data for hands no longer detected
      for (let i = results.landmarks.length; i < 2; i++) {
        this.smoothedLandmarks[i] = null;
      }
    } else {
      this.smoothedLandmarks = [null, null];
    }

    this.onResults({
      landmarks: smoothedHands,
      rawLandmarks: results.landmarks || [],
      handedness: results.handedness || [],
    });
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }
}