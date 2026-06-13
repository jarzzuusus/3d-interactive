// ============================================================
// main.js  (v3 — 2-hand support, shape switching, updated gestures)
// ============================================================

import * as THREE from "three";
import { SceneManager }             from "./threeScene.js";
import { HandTracker }              from "./handTracking.js";
import { GestureDetector, GESTURES } from "./gestureDetector.js";

// ── DOM ───────────────────────────────────────────────────────
const sceneContainer  = document.getElementById("scene-container");
const videoEl         = document.getElementById("webcam");
const debugCanvas     = document.getElementById("debug-canvas");
const debugCtx        = debugCanvas.getContext("2d");

const statusCamera    = document.getElementById("status-camera");
const statusHand      = document.getElementById("status-hand");
const gestureLabel    = document.getElementById("gesture-label");
const confidenceLabel = document.getElementById("confidence-label");
const confidenceBar   = document.getElementById("confidence-bar");
const fpsLabel        = document.getElementById("fps-label");

const loadingOverlay  = document.getElementById("loading-overlay");
const loadingText     = document.getElementById("loading-text");
const errorOverlay    = document.getElementById("error-overlay");
const errorMessage    = document.getElementById("error-message");
const retryBtn        = document.getElementById("retry-camera");
const startOverlay    = document.getElementById("start-overlay");
const startBtn        = document.getElementById("start-btn");
const toggleDebugBtn  = document.getElementById("toggle-debug");
const toggleSoundBtn  = document.getElementById("toggle-sound");

// ── State ─────────────────────────────────────────────────────
let debugMode    = false;
let soundEnabled = true;
let frameCount   = 0;
let fpsTimer     = performance.now();
let lastDetect   = performance.now();

// ── Audio ─────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq = 660, dur = 0.12, type = "sine") {
  if (!soundEnabled) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

function playDissolveSound() {
  // Soft whoosh — lower, gentle
  playTone(180, 0.5, "sine");
  setTimeout(() => playTone(120, 0.6, "sine"), 120);
}

// ── Scene + Gesture ───────────────────────────────────────────
const sceneManager   = new SceneManager(sceneContainer);
const gestureDetector = new GestureDetector();

// ── Landmark helpers ──────────────────────────────────────────
function landmarkToWorld(lm) {
  return new THREE.Vector3(
    (0.5 - lm.x) * 8,
    (0.5 - lm.y) * 6,
    -lm.z * 6
  );
}

function landmarkToRotation(hand) {
  const wrist    = hand[0];
  const middleMcp = hand[9];
  const indexMcp  = hand[5];
  const pinkyMcp  = hand[17];

  const dx   = middleMcp.x - wrist.x;
  const dy   = middleMcp.y - wrist.y;
  const roll = Math.atan2(dy, dx) + Math.PI / 2;

  const v1 = new THREE.Vector3(indexMcp.x - wrist.x, indexMcp.y - wrist.y, indexMcp.z - wrist.z);
  const v2 = new THREE.Vector3(pinkyMcp.x - wrist.x, pinkyMcp.y - wrist.y, pinkyMcp.z - wrist.z);
  const n  = new THREE.Vector3().crossVectors(v1, v2).normalize();

  return new THREE.Euler(
    Math.atan2(n.y, n.z) * 0.4,
    Math.atan2(n.x, n.z) * 0.4,
    -roll * 0.4
  );
}

// ── Hand tracking callback ────────────────────────────────────
const tracker = new HandTracker(videoEl, (results) => {
  const hands  = results.landmarks;
  const now    = performance.now();
  const delta  = now - lastDetect;
  lastDetect   = now;

  // Update status dot
  statusHand.classList.toggle("active", hands.length > 0);

  // Pass up to 2 hands to scene
  for (let i = 0; i < Math.min(2, hands.length); i++) {
    const pos = landmarkToWorld(hands[i][0]);
    const rot = landmarkToRotation(hands[i]);
    sceneManager.setHandTarget(pos, rot, i);
  }
  // Clear hands that disappeared
  for (let i = hands.length; i < 2; i++) {
    sceneManager.clearHandTarget(i);
  }

  // Gesture
  const result = gestureDetector.detect(hands, now, delta);
  updateGestureUI(result);

  const ev = result.events;

  if (ev.destruction) {
    sceneManager.triggerDestruction();
    playDissolveSound();
  }
  if (ev.spawnText) {
    sceneManager.spawnText();
    playTone(780, 0.15);
  }
  if (ev.removeText) {
    sceneManager.removeText();
    playTone(420, 0.12);
  }
  if (ev.changeText) {
    sceneManager.changeText();
    playTone(620, 0.1);
  }
  if (ev.nextShape) {
    const name = sceneManager.nextShape();
    playTone(660, 0.1);
    showShapeToast(name);
  }
  if (ev.prevShape) {
    const name = sceneManager.prevShape();
    playTone(520, 0.1);
    showShapeToast(name);
  }

  if (debugMode) drawDebugLandmarks(results.rawLandmarks);
});

// ── Shape toast notification ──────────────────────────────────
let _toastTimeout = null;
function showShapeToast(name) {
  let toast = document.getElementById("shape-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "shape-toast";
    Object.assign(toast.style, {
      position: "fixed", top: "50%", left: "50%",
      transform: "translate(-50%,-50%)",
      background: "rgba(15,20,40,0.75)",
      border: "1px solid rgba(150,180,255,0.3)",
      borderRadius: "12px", padding: "10px 28px",
      color: "#cce4ff", fontSize: "1rem", letterSpacing: "3px",
      pointerEvents: "none", zIndex: "50",
      transition: "opacity 0.3s",
    });
    document.body.appendChild(toast);
  }
  toast.textContent = name.toUpperCase();
  toast.style.opacity = "1";
  if (_toastTimeout) clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => { toast.style.opacity = "0"; }, 1400);
}

// ── UI update ─────────────────────────────────────────────────
function updateGestureUI(result) {
  const g2 = result.secondGesture && result.secondGesture !== "None"
    ? ` / ${result.secondGesture}` : "";
  gestureLabel.textContent = result.gesture + g2;
  const pct = Math.round(result.confidence * 100);
  confidenceLabel.textContent = `${pct}%`;
  confidenceBar.style.width   = `${pct}%`;
}

// ── Debug overlay ─────────────────────────────────────────────
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

function drawDebugLandmarks(raw) {
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  if (!raw || !raw.length) return;
  const w = debugCanvas.width, h = debugCanvas.height;
  const handColors = ["#00f0ff", "#ffaa00"];
  raw.forEach((hand, hi) => {
    debugCtx.strokeStyle = handColors[hi] || "#fff";
    debugCtx.lineWidth = 2;
    CONNECTIONS.forEach(([a,b]) => {
      debugCtx.beginPath();
      debugCtx.moveTo(hand[a].x*w, hand[a].y*h);
      debugCtx.lineTo(hand[b].x*w, hand[b].y*h);
      debugCtx.stroke();
    });
    debugCtx.fillStyle = hi === 0 ? "#ff2bd6" : "#ffcc00";
    hand.forEach(p => {
      debugCtx.beginPath();
      debugCtx.arc(p.x*w, p.y*h, 3, 0, Math.PI*2);
      debugCtx.fill();
    });
  });
}

function resizeDebugCanvas() {
  debugCanvas.width  = videoEl.clientWidth;
  debugCanvas.height = videoEl.clientHeight;
}

// ── Controls ──────────────────────────────────────────────────
toggleDebugBtn.addEventListener("click", () => {
  debugMode = !debugMode;
  toggleDebugBtn.textContent = `Debug: ${debugMode ? "ON" : "OFF"}`;
  if (!debugMode) debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
});

toggleSoundBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  toggleSoundBtn.textContent = `Sound: ${soundEnabled ? "ON" : "OFF"}`;
});

// ── Render loop ───────────────────────────────────────────────
function renderLoop() {
  requestAnimationFrame(renderLoop);
  const now = performance.now();
  tracker.detectFrame(now);
  sceneManager.update();
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
    if (audioCtx.state === "suspended") await audioCtx.resume();

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
    console.error(err);
    statusCamera.classList.remove("active");
    loadingOverlay.classList.add("hidden");
    errorOverlay.classList.remove("hidden");
    let msg = "Could not access the camera. ";
    if (err.name === "NotAllowedError") msg += "Camera permission denied.";
    else if (err.name === "NotFoundError") msg += "No camera found.";
    else msg += err.message || "Unknown error.";
    errorMessage.textContent = msg;
    renderLoop();
  }
}

let appStarted = false;
function idleRender() {
  if (appStarted) return;
  sceneManager.update();
  requestAnimationFrame(idleRender);
}
idleRender();

startBtn.addEventListener("click", () => { appStarted = true; startApp(); });
retryBtn.addEventListener("click", () => { errorOverlay.classList.add("hidden"); startApp(); });