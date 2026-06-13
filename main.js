// ============================================================
// main.js
// Application entry point. Wires together:
// - SceneManager (Three.js particle scene, post-fx, text, effects)
// - HandTracker (MediaPipe hand landmarks)
// - GestureDetector (stable gesture classification + confidence)
// UI updates (status indicators, FPS, gesture/confidence, debug view)
// ============================================================

import * as THREE from "three";
import { SceneManager } from "./threeScene.js";
import { HandTracker } from "./handTracking.js";
import { GestureDetector, GESTURES } from "./gestureDetector.js";

// ----------------------------------------------------------
// DOM references
// ----------------------------------------------------------
const sceneContainer = document.getElementById("scene-container");
const videoEl = document.getElementById("webcam");
const debugCanvas = document.getElementById("debug-canvas");
const debugCtx = debugCanvas.getContext("2d");

const statusCamera = document.getElementById("status-camera");
const statusHand = document.getElementById("status-hand");
const gestureLabel = document.getElementById("gesture-label");
const confidenceLabel = document.getElementById("confidence-label");
const confidenceBar = document.getElementById("confidence-bar");
const fpsLabel = document.getElementById("fps-label");

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const errorOverlay = document.getElementById("error-overlay");
const errorMessage = document.getElementById("error-message");
const retryBtn = document.getElementById("retry-camera");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");

const toggleDebugBtn = document.getElementById("toggle-debug");
const toggleSoundBtn = document.getElementById("toggle-sound");

// ----------------------------------------------------------
// State
// ----------------------------------------------------------
let debugMode = false;
let soundEnabled = true;

// FPS tracking
let frameCount = 0;
let fpsTimer = performance.now();
let lastDetectTime = performance.now();

// ----------------------------------------------------------
// Audio feedback (generated tones via WebAudio — no external files)
// ----------------------------------------------------------
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq = 660, duration = 0.12) {
  if (!soundEnabled) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playDestructionSound() {
  playTone(220, 0.3);
  setTimeout(() => playTone(110, 0.4), 80);
}

// ----------------------------------------------------------
// Initialize Three.js scene + gesture detector
// ----------------------------------------------------------
const sceneManager = new SceneManager(sceneContainer);
const gestureDetector = new GestureDetector();

// ----------------------------------------------------------
// Hand landmark -> 3D world mapping helpers
// ----------------------------------------------------------

/**
 * Converts a normalized hand landmark (x,y in [0,1], z roughly in [-1,1])
 * into a world-space position for the particle object.
 * The video is mirrored, so we flip X to feel natural (move hand right
 * -> object moves right from the user's perspective).
 */
function landmarkToWorldPosition(landmark) {
  const x = (0.5 - landmark.x) * 8; // mirrored, scaled to scene width
  const y = (0.5 - landmark.y) * 6; // inverted Y (image space -> world up)
  const z = -landmark.z * 6; // slight depth movement
  return new THREE.Vector3(x, y, z);
}

/**
 * Estimates hand rotation (Euler) from landmark geometry.
 */
function landmarkToRotation(hand) {
  const wrist = hand[0];
  const indexMcp = hand[5];
  const pinkyMcp = hand[17];
  const middleMcp = hand[9];

  const dx = middleMcp.x - wrist.x;
  const dy = middleMcp.y - wrist.y;
  const roll = Math.atan2(dy, dx) + Math.PI / 2;

  const v1 = new THREE.Vector3(indexMcp.x - wrist.x, indexMcp.y - wrist.y, indexMcp.z - wrist.z);
  const v2 = new THREE.Vector3(pinkyMcp.x - wrist.x, pinkyMcp.y - wrist.y, pinkyMcp.z - wrist.z);
  const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

  const yaw = Math.atan2(normal.x, normal.z);
  const pitch = Math.atan2(normal.y, normal.z);

  return new THREE.Euler(pitch * 0.4, yaw * 0.4, -roll * 0.4);
}

// ----------------------------------------------------------
// Hand tracking callback
// ----------------------------------------------------------
const tracker = new HandTracker(videoEl, (results) => {
  const hands = results.landmarks;
  const now = performance.now();
  const deltaMs = now - lastDetectTime;
  lastDetectTime = now;

  if (hands.length > 0) {
    statusHand.classList.add("active");

    const primary = hands[0];
    const targetPos = landmarkToWorldPosition(primary[0]);
    const targetRot = landmarkToRotation(primary);
    sceneManager.setHandTarget(targetPos, targetRot);
  } else {
    statusHand.classList.remove("active");
    sceneManager.clearHandTarget();
  }

  // Gesture detection (stability + confidence + events)
  const result = gestureDetector.detect(hands, now, deltaMs);
  updateGestureUI(result);

  if (result.events.destruction) {
    sceneManager.triggerDestruction();
    playDestructionSound();
  }
  if (result.events.spawnText) {
    sceneManager.spawnText();
    playTone(880, 0.12);
  }
  if (result.events.removeText) {
    sceneManager.removeText();
    playTone(440, 0.12);
  }
  if (result.events.changeText) {
    sceneManager.changeText();
    playTone(660, 0.1);
  }

  // Debug overlay drawing
  if (debugMode) {
    drawDebugLandmarks(results.rawLandmarks);
  }
});

// ----------------------------------------------------------
// UI updates
// ----------------------------------------------------------
function updateGestureUI(result) {
  gestureLabel.textContent = result.gesture;
  const pct = Math.round(result.confidence * 100);
  confidenceLabel.textContent = `${pct}%`;
  confidenceBar.style.width = `${pct}%`;
}

// ----------------------------------------------------------
// Debug landmark drawing on overlay canvas
// ----------------------------------------------------------
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

function drawDebugLandmarks(handsRaw) {
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  if (!handsRaw || handsRaw.length === 0) return;

  const w = debugCanvas.width;
  const h = debugCanvas.height;

  for (const hand of handsRaw) {
    debugCtx.strokeStyle = "#00f0ff";
    debugCtx.lineWidth = 2;
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand[a];
      const pb = hand[b];
      debugCtx.beginPath();
      debugCtx.moveTo(pa.x * w, pa.y * h);
      debugCtx.lineTo(pb.x * w, pb.y * h);
      debugCtx.stroke();
    }
    debugCtx.fillStyle = "#ff2bd6";
    for (const p of hand) {
      debugCtx.beginPath();
      debugCtx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      debugCtx.fill();
    }
  }
}

function resizeDebugCanvas() {
  debugCanvas.width = videoEl.clientWidth;
  debugCanvas.height = videoEl.clientHeight;
}

// ----------------------------------------------------------
// UI control bindings
// ----------------------------------------------------------
toggleDebugBtn.addEventListener("click", () => {
  debugMode = !debugMode;
  toggleDebugBtn.textContent = `Debug: ${debugMode ? "ON" : "OFF"}`;
  if (!debugMode) {
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  }
});

toggleSoundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  toggleSoundBtn.textContent = `Sound: ${soundEnabled ? "ON" : "OFF"}`;
});

// ----------------------------------------------------------
// Main render loop
// ----------------------------------------------------------
function renderLoop() {
  requestAnimationFrame(renderLoop);

  const now = performance.now();

  // Run hand tracking detection
  tracker.detectFrame(now);

  // Update and render 3D scene
  sceneManager.update();

  // FPS counter
  frameCount++;
  if (now - fpsTimer >= 1000) {
    fpsLabel.textContent = frameCount;
    frameCount = 0;
    fpsTimer = now;
  }
}

async function startApp() {
  try {
    startOverlay.classList.add("hidden");
    loadingOverlay.classList.remove("hidden");

    // iOS requires AudioContext to be resumed after a user gesture
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    loadingText.textContent = "Loading AI hand tracking model...";
    await tracker.init();

    loadingText.textContent = "Requesting camera access...";
    await tracker.startCamera();

    statusCamera.classList.add("active");
    resizeDebugCanvas();
    window.addEventListener("resize", resizeDebugCanvas);

    tracker.start();

    loadingOverlay.classList.add("hidden");
    renderLoop();
  } catch (err) {
    console.error("Initialization error:", err);
    statusCamera.classList.remove("active");
    loadingOverlay.classList.add("hidden");
    errorOverlay.classList.remove("hidden");

    let msg = "Could not access the camera. ";
    if (err.name === "NotAllowedError") {
      msg += "Camera permission was denied. Please allow camera access in your browser.";
    } else if (err.name === "NotFoundError") {
      msg += "No camera device was found.";
    } else {
      msg += err.message || "An unknown error occurred.";
    }
    errorMessage.textContent = msg;

    // Even without camera, keep rendering the 3D scene so the page
    // isn't completely blank.
    renderLoop();
  }
}

// Render the 3D scene immediately so the background looks alive
// even before the user taps "Start".
let appStarted = false;
function idleRender() {
  if (appStarted) return; // renderLoop takes over once started
  sceneManager.update();
  requestAnimationFrame(idleRender);
}
idleRender();

startBtn.addEventListener("click", () => {
  appStarted = true;
  startApp();
});

retryBtn.addEventListener("click", () => {
  errorOverlay.classList.add("hidden");
  startApp();
});