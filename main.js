// ============================================================
// main.js  (v5 — no removeText, bg particles, improved fist)
// ============================================================

import * as THREE from "three";
import { SceneManager }                        from "./threeScene.js";
import { HandTracker }                         from "./handTracking.js";
import { GestureDetector, GESTURES, ACTIONS }  from "./gestureDetector.js";
import { SHAPES, SHAPE_NAMES_DISPLAY }         from "./particleSystem.js";
import { BgParticles }                         from "./bgParticles.js";

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
const editModeBtn     = document.getElementById("toggle-edit-mode");

// ── State ─────────────────────────────────────────────────────
let debugMode    = false;
let soundEnabled = true;
let frameCount   = 0;
let fpsTimer     = performance.now();
let lastDetect   = performance.now();
let lastBgTime   = performance.now();

// ── Background particles ──────────────────────────────────────
const bgParticles = new BgParticles();

// ── Audio ─────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq = 660, dur = 0.12, type = "sine") {
  if (!soundEnabled) return;
  const osc  = audioCtx.createOscillator();
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
  playTone(280, 0.3, "sine");
  setTimeout(() => playTone(180, 0.5, "sine"), 80);
  setTimeout(() => playTone(110, 0.65, "sine"), 210);
}

// ── Scene + Gesture ───────────────────────────────────────────
const sceneManager    = new SceneManager(sceneContainer);
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
  const v1 = new THREE.Vector3(indexMcp.x-wrist.x, indexMcp.y-wrist.y, indexMcp.z-wrist.z);
  const v2 = new THREE.Vector3(pinkyMcp.x-wrist.x, pinkyMcp.y-wrist.y, pinkyMcp.z-wrist.z);
  const n  = new THREE.Vector3().crossVectors(v1, v2).normalize();
  return new THREE.Euler(
    Math.atan2(n.y, n.z) * 0.4,
    Math.atan2(n.x, n.z) * 0.4,
    -roll * 0.4
  );
}

// ── Hand tracking callback ────────────────────────────────────
const tracker = new HandTracker(videoEl, (results) => {
  const hands = results.landmarks;
  const now   = performance.now();
  const delta = now - lastDetect;
  lastDetect  = now;

  statusHand.classList.toggle("active", hands.length > 0);

  for (let i = 0; i < Math.min(2, hands.length); i++) {
    sceneManager.setHandTarget(landmarkToWorld(hands[i][0]), landmarkToRotation(hands[i]), i);
  }
  for (let i = hands.length; i < 2; i++) sceneManager.clearHandTarget(i);

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
  if (ev.changeText) {
    sceneManager.changeText();
    playTone(620, 0.1);
  }
  if (ev.shape) {
    const name = sceneManager.setShape(ev.shape);
    const shapeFreqs = { saturn: 660, love: 820, dragon: 440, sphere: 550 };
    playTone(shapeFreqs[ev.shape] || 660, 0.15);
    showShapeToast(name);
  }

  if (debugMode) drawDebugLandmarks(results.rawLandmarks);
});

// ── Shape toast ───────────────────────────────────────────────
let _toastTimeout = null;
function showShapeToast(name) {
  let toast = document.getElementById("shape-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "shape-toast";
    Object.assign(toast.style, {
      position: "fixed", top: "50%", left: "50%",
      transform: "translate(-50%,-50%)",
      background: "rgba(10,15,35,0.80)",
      border: "1px solid rgba(150,180,255,0.28)",
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

// ── Gesture UI ────────────────────────────────────────────────
function updateGestureUI(result) {
  const g2 = result.secondGesture && result.secondGesture !== "None"
    ? ` / ${result.secondGesture}` : "";
  gestureLabel.textContent = result.gesture + g2;
  const pct = Math.round(result.confidence * 100);
  confidenceLabel.textContent = `${pct}%`;
  confidenceBar.style.width   = `${pct}%`;
}

// ── Debug ─────────────────────────────────────────────────────
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17],
];

function drawDebugLandmarks(raw) {
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  if (!raw || !raw.length) return;
  const w = debugCanvas.width, h = debugCanvas.height;
  raw.forEach((hand, hi) => {
    debugCtx.strokeStyle = hi === 0 ? "#00f0ff" : "#ffaa00";
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

// ── Gesture Edit Mode ─────────────────────────────────────────
const GESTURE_EDIT_ACTIONS = [
  { key: ACTIONS.DESTRUCTION,  label: "💥 Dissolve" },
  { key: ACTIONS.SPAWN_TEXT,   label: "✏️ Spawn Text" },
  { key: ACTIONS.CHANGE_TEXT,  label: "🔄 Restart Text" },
  { key: ACTIONS.SHAPE_SATURN, label: "🪐 Shape: Saturn" },
  { key: ACTIONS.SHAPE_LOVE,   label: "❤️ Shape: Love" },
  { key: ACTIONS.SHAPE_DRAGON, label: "🐉 Shape: Dragon" },
  { key: ACTIONS.SHAPE_SPHERE, label: "⚪ Shape: Sphere" },
];

let editPanelEl   = null;
let editModeActive = false;
let pendingActionKey = null;

function buildEditPanel() {
  if (editPanelEl) { editPanelEl.remove(); editPanelEl = null; }

  const panel = document.createElement("div");
  panel.id = "gesture-edit-panel";
  Object.assign(panel.style, {
    position: "fixed", top: "50%", left: "50%",
    transform: "translate(-50%, -50%)",
    background: "rgba(5,8,22,0.93)",
    border: "1px solid rgba(0,240,255,0.28)",
    borderRadius: "16px", padding: "22px 26px",
    zIndex: "200", minWidth: "340px",
    color: "#e6f7ff",
    fontFamily: "'Segoe UI', Arial, sans-serif",
    fontSize: "0.83rem",
    boxShadow: "0 0 40px rgba(0,240,255,0.14)",
    backdropFilter: "blur(14px)",
    pointerEvents: "all",
  });

  const currentMap = gestureDetector.getGestureMap();
  const actionToGesture = {};
  Object.entries(currentMap).forEach(([g, a]) => { actionToGesture[a] = g; });

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="font-size:0.95rem;font-weight:700;letter-spacing:2px;color:#00f0ff;">✏️ EDIT GESTURES</span>
      <button id="edit-close-btn" style="background:none;border:1px solid rgba(255,80,80,0.5);color:#ff5050;
        padding:3px 11px;border-radius:6px;cursor:pointer;font-size:0.78rem;">Close</button>
    </div>
    <div style="font-size:0.7rem;opacity:0.55;margin-bottom:12px;">
      Klik Assign → tunjukkan gesture ke kamera → ter-assign otomatis.
    </div>
    <table id="gesture-map-table" style="width:100%;border-collapse:collapse;"></table>
    <div style="display:flex;gap:10px;margin-top:14px;">
      <button id="edit-reset-btn" style="flex:1;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.38);
        color:#ff8888;padding:7px;border-radius:7px;cursor:pointer;font-size:0.78rem;">Reset Default</button>
    </div>
    <div id="edit-listen-status" style="margin-top:10px;text-align:center;font-size:0.78rem;min-height:18px;color:#ffcc00;"></div>
  `;

  document.body.appendChild(panel);
  editPanelEl = panel;

  renderEditTable(actionToGesture);

  panel.querySelector("#edit-close-btn").addEventListener("click", () => {
    panel.remove(); editPanelEl = null;
    editModeActive = false; pendingActionKey = null;
    editModeBtn.textContent = "✏️ Edit Gestures";
    gestureDetector.editListenCallback = null;
  });

  panel.querySelector("#edit-reset-btn").addEventListener("click", () => {
    gestureDetector.resetGestureMap();
    const newInvert = {};
    Object.entries(gestureDetector.getGestureMap()).forEach(([g,a]) => { newInvert[a] = g; });
    renderEditTable(newInvert);
    showListenStatus("✅ Reset ke default");
  });
}

function renderEditTable(actionToGesture) {
  const table = document.getElementById("gesture-map-table");
  if (!table) return;
  table.innerHTML = "";
  GESTURE_EDIT_ACTIONS.forEach(({ key, label }) => {
    const assigned = actionToGesture[key] || "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:6px 4px;opacity:0.88;">${label}</td>
      <td style="padding:6px 4px;color:#00f0ff;font-weight:600;text-align:center;font-size:0.78rem;"
        id="cell-${key}">${assigned}</td>
      <td style="padding:6px 4px;text-align:right;">
        <button data-action="${key}" class="assign-btn"
          style="background:rgba(0,240,255,0.09);border:1px solid rgba(0,240,255,0.32);
          color:#00f0ff;padding:3px 11px;border-radius:6px;cursor:pointer;font-size:0.73rem;">
          Assign
        </button>
      </td>`;
    table.appendChild(tr);
  });

  table.querySelectorAll(".assign-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      pendingActionKey = btn.dataset.action;
      showListenStatus("🎯 Tunjukkan gesture sekarang...");
      gestureDetector.listenForGesture((g) => {
        if (!pendingActionKey) return;
        const map = { ...gestureDetector.getGestureMap() };
        Object.keys(map).forEach(k => { if (map[k] === pendingActionKey) delete map[k]; });
        map[g] = pendingActionKey;
        gestureDetector.setGestureMap(map);
        const cell = document.getElementById(`cell-${pendingActionKey}`);
        if (cell) cell.textContent = g;
        showListenStatus(`✅ ${g} → ${GESTURE_EDIT_ACTIONS.find(a=>a.key===pendingActionKey)?.label}`);
        pendingActionKey = null;
      });
    });
  });
}

function showListenStatus(msg) {
  const el = document.getElementById("edit-listen-status");
  if (el) { el.textContent = msg; setTimeout(() => { if(el) el.textContent=""; }, 3000); }
}

editModeBtn.addEventListener("click", () => {
  editModeActive = !editModeActive;
  if (editModeActive) {
    editModeBtn.textContent = "✕ Tutup Edit";
    buildEditPanel();
  } else {
    editModeBtn.textContent = "✏️ Edit Gestures";
    if (editPanelEl) { editPanelEl.remove(); editPanelEl = null; }
    pendingActionKey = null;
    gestureDetector.editListenCallback = null;
  }
});

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
  const dt  = (now - lastBgTime) / 1000;
  lastBgTime = now;

  bgParticles.update(dt);
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
  const now = performance.now();
  const dt  = (now - lastBgTime) / 1000;
  lastBgTime = now;
  bgParticles.update(dt);
  sceneManager.update();
  requestAnimationFrame(idleRender);
}
idleRender();

startBtn.addEventListener("click", () => { appStarted = true; startApp(); });
retryBtn.addEventListener("click", () => { errorOverlay.classList.add("hidden"); startApp(); });
