// ============================================================
// main.js
// Application entry point. Wires together:
// - SceneManager (Three.js scene, object, particles, post-fx)
// - HandTracker (MediaPipe hand landmarks)
// - GestureDetector (gesture classification + stabilization)
// UI updates (status indicators, FPS, hologram text, debug view)
// ============================================================

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
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
const fpsLabel = document.getElementById("fps-label");
const hologramText = document.getElementById("hologram-text");

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const errorOverlay = document.getElementById("error-overlay");
const errorMessage = document.getElementById("error-message");
const retryBtn = document.getElementById("retry-camera");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");

const toggleDebugBtn = document.getElementById("toggle-debug");
const modelSelect = document.getElementById("model-select");
const toggleSoundBtn = document.getElementById("toggle-sound");

// ----------------------------------------------------------
// State
// ----------------------------------------------------------
let debugMode = false;
let soundEnabled = true;
let lastGesture = GESTURES.NONE;
let helloTimeout = null;

// FPS tracking
let frameCount = 0;
let fpsTimer = performance.now();

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

function playGestureSound(gesture) {
  switch (gesture) {
    case GESTURES.OPEN_PALM:
      playTone(880, 0.15);
      break;
    case GESTURES.HEART:
      playTone(660, 0.1);
      setTimeout(() => playTone(990, 0.15), 90);
      break;
    case GESTURES.WAVE:
      playTone(523, 0.12);
      break;
    case GESTURES.FIST:
      playTone(330, 0.1);
      break;
    case GESTURES.PINCH:
      playTone(220, 0.2);
      break;
  }
}

// ----------------------------------------------------------
// Initialize Three.js scene
// ----------------------------------------------------------
const sceneManager = new SceneManager(sceneContainer);

// ----------------------------------------------------------
// Initialize gesture detector
// ----------------------------------------------------------
const gestureDetector = new GestureDetector();

// ----------------------------------------------------------
// Hand landmark -> 3D world mapping helpers
// ----------------------------------------------------------

/**
 * Converts a normalized hand landmark (x,y in [0,1], z roughly in [-1,1])
 * into a world-space position for the 3D object.
 * The video is mirrored, so we flip X to feel natural (move hand right
 * -> object moves right from the user's perspective).
 */
function landmarkToWorldPosition(landmark) {
  const x = (0.5 - landmark.x) * 8; // mirrored, scaled to scene width
  const y = (0.5 - landmark.y) * 6; // inverted Y (image space -> world up)
  const z = -landmark.z * 10; // depth
  return new THREE.Vector3(x, y, z);
}

/**
 * Estimates hand rotation (Euler) from landmark geometry:
 * - Roll: angle between wrist and middle finger MCP in screen plane
 * - Yaw/Pitch: derived from the palm normal approximated via
 *   the vectors wrist->index_mcp and wrist->pinky_mcp.
 */
function landmarkToRotation(hand) {
  const wrist = hand[0];
  const indexMcp = hand[5];
  const pinkyMcp = hand[17];
  const middleMcp = hand[9];

  // Roll: angle of the hand in the image plane
  const dx = middleMcp.x - wrist.x;
  const dy = middleMcp.y - wrist.y;
  const roll = Math.atan2(dy, dx) + Math.PI / 2;

  // Approximate palm normal via cross product of two in-plane vectors
  const v1 = new THREE.Vector3(indexMcp.x - wrist.x, indexMcp.y - wrist.y, indexMcp.z - wrist.z);
  const v2 = new THREE.Vector3(pinkyMcp.x - wrist.x, pinkyMcp.y - wrist.y, pinkyMcp.z - wrist.z);
  const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

  const yaw = Math.atan2(normal.x, normal.z);
  const pitch = Math.atan2(normal.y, normal.z);

  return new THREE.Euler(pitch, yaw, -roll);
}

// ----------------------------------------------------------
// Hand tracking callback
// ----------------------------------------------------------
const tracker = new HandTracker(videoEl, (results) => {
  const hands = results.landmarks;

  if (hands.length > 0) {
    statusHand.classList.add("active");

    // Use the first detected hand to drive the object
    const primary = hands[0];
    const wrist = primary[0];

    const targetPos = landmarkToWorldPosition(wrist);
    const targetRot = landmarkToRotation(primary);
    sceneManager.setHandTarget(targetPos, targetRot);

    // Gesture detection
    const gesture = gestureDetector.detect(hands);
    updateGestureUI(gesture);
    applyGestureToScene(gesture);
  } else {
    statusHand.classList.remove("active");
    sceneManager.clearHandTarget();

    const gesture = gestureDetector.detect([]);
    updateGestureUI(gesture);
    applyGestureToScene(gesture);
  }

  // Debug overlay drawing
  if (debugMode) {
    drawDebugLandmarks(results.rawLandmarks);
  }
});

// ----------------------------------------------------------
// Apply gesture results to the scene + UI + sound
// ----------------------------------------------------------
function applyGestureToScene(gesture) {
  if (gesture !== lastGesture) {
    playGestureSound(gesture);

    switch (gesture) {
      case GESTURES.OPEN_PALM:
        sceneManager.setMode("love");
        break;
      case GESTURES.HEART:
        sceneManager.setMode("heart");
        break;
      case GESTURES.FIST:
        sceneManager.setMode("default");
        break;
      case GESTURES.PINCH:
        sceneManager.setMode("destruction");
        break;
      case GESTURES.WAVE:
        showHologram();
        sceneManager.triggerHelloEffect();
        break;
      default:
        // NONE -> keep current mode unless it was love (revert gently)
        if (lastGesture === GESTURES.OPEN_PALM || lastGesture === GESTURES.HEART) {
          sceneManager.setMode("default");
        }
        break;
    }

    lastGesture = gesture;
  }
}

function updateGestureUI(gesture) {
  gestureLabel.textContent = gesture;
}

function showHologram() {
  hologramText.classList.add("show");
  clearTimeout(helloTimeout);
  helloTimeout = setTimeout(() => {
    hologramText.classList.remove("show");
  }, 2200);
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
    // Draw connections
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
    // Draw points
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

modelSelect.addEventListener("change", (e) => {
  sceneManager.setModel(e.target.value);
});

toggleSoundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  toggleSoundBtn.textContent = `Sound: ${soundEnabled ? "ON" : "OFF"}`;
});

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

    let msg = "Tidak dapat mengakses kamera. ";
    if (err.name === "NotAllowedError") {
      msg += "Izin kamera ditolak. Mohon izinkan akses kamera pada browser.";
    } else if (err.name === "NotFoundError") {
      msg += "Tidak ada perangkat kamera yang ditemukan.";
    } else {
      msg += err.message || "Terjadi kesalahan tidak diketahui.";
    }
    errorMessage.textContent = msg;

    // Even without camera, keep rendering the 3D scene so the page
    // isn't completely blank.
    renderLoop();
  }
}

// Render the 3D scene immediately so the background looks alive
// even before the user taps "Mulai".
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
