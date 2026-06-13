// ============================================================
// gestureDetector.js
// Analyzes hand landmarks to classify gestures:
// - Open Palm
// - Fist
// - Heart (two hands forming heart shape)
// - Wave (open palm moving side to side)
// - Pinch (special "destruction" gesture)
//
// Includes a simple temporal stability filter (AI-like smoothing)
// so transitions between gestures don't flicker rapidly.
// ============================================================

// MediaPipe hand landmark indices reference:
// 0: wrist
// 4: thumb tip, 8: index tip, 12: middle tip, 16: ring tip, 20: pinky tip
// 5,9,13,17: respective finger MCP (base) joints

const GESTURES = {
  NONE: "None",
  OPEN_PALM: "Open Palm",
  FIST: "Fist",
  HEART: "Heart",
  WAVE: "Wave",
  PINCH: "Pinch",
};

export class GestureDetector {
  constructor() {
    this.currentGesture = GESTURES.NONE;
    this.candidateGesture = GESTURES.NONE;
    this.candidateFrames = 0;
    this.requiredFrames = 5; // frames a gesture must persist to be confirmed

    // Wave detection state: track wrist X position history
    this.wristXHistory = [];
    this.waveWindow = 20; // number of frames to analyze for wave
    this.lastWaveTime = 0;
  }

  /**
   * Main entry point. Takes the smoothed landmark sets for up to two hands.
   * @param {Array} hands - array of landmark arrays (each 21 points)
   * @returns {string} gesture name
   */
  detect(hands) {
    let raw = GESTURES.NONE;

    if (!hands || hands.length === 0) {
      this.wristXHistory = [];
      return this._stabilize(GESTURES.NONE);
    }

    // --- Two-hand HEART gesture check first (highest priority) ---
    if (hands.length === 2 && this._isHeartShape(hands[0], hands[1])) {
      raw = GESTURES.HEART;
    } else {
      // Evaluate primary hand (first detected)
      const hand = hands[0];

      if (this._isPinch(hand)) {
        raw = GESTURES.PINCH;
      } else if (this._isFist(hand)) {
        raw = GESTURES.FIST;
      } else if (this._isOpenPalm(hand)) {
        // Check if it's waving
        if (this._isWaving(hand)) {
          raw = GESTURES.WAVE;
        } else {
          raw = GESTURES.OPEN_PALM;
        }
      }
    }

    return this._stabilize(raw);
  }

  /**
   * Stability filter: a new gesture must persist for `requiredFrames`
   * consecutive detections before it becomes the active gesture.
   * This prevents flickering between gestures.
   */
  _stabilize(raw) {
    if (raw === this.candidateGesture) {
      this.candidateFrames++;
    } else {
      this.candidateGesture = raw;
      this.candidateFrames = 1;
    }

    if (this.candidateFrames >= this.requiredFrames) {
      this.currentGesture = this.candidateGesture;
    }

    return this.currentGesture;
  }

  // ----------------------------------------------------------
  // Distance helper
  // ----------------------------------------------------------
  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ----------------------------------------------------------
  // FIST: all fingertips close to the palm (wrist)
  // ----------------------------------------------------------
  _isFist(hand) {
    const wrist = hand[0];
    const tips = [8, 12, 16, 20].map((i) => hand[i]);
    const mcp = [5, 9, 13, 17].map((i) => hand[i]);

    let curledCount = 0;
    for (let i = 0; i < tips.length; i++) {
      // If tip is closer to wrist than the MCP joint is, finger is curled
      const tipToWrist = this._dist(tips[i], wrist);
      const mcpToWrist = this._dist(mcp[i], wrist);
      if (tipToWrist < mcpToWrist * 1.1) curledCount++;
    }
    return curledCount >= 3;
  }

  // ----------------------------------------------------------
  // OPEN PALM: all fingers extended (tips far from palm/MCP)
  // ----------------------------------------------------------
  _isOpenPalm(hand) {
    const wrist = hand[0];
    const tips = [8, 12, 16, 20].map((i) => hand[i]);
    const mcp = [5, 9, 13, 17].map((i) => hand[i]);

    let extendedCount = 0;
    for (let i = 0; i < tips.length; i++) {
      const tipToWrist = this._dist(tips[i], wrist);
      const mcpToWrist = this._dist(mcp[i], wrist);
      if (tipToWrist > mcpToWrist * 1.3) extendedCount++;
    }
    return extendedCount >= 3;
  }

  // ----------------------------------------------------------
  // PINCH: thumb tip close to index tip (used for "destruction" mode)
  // ----------------------------------------------------------
  _isPinch(hand) {
    const thumbTip = hand[4];
    const indexTip = hand[8];
    const d = this._dist(thumbTip, indexTip);
    return d < 0.045; // normalized coordinate threshold
  }

  // ----------------------------------------------------------
  // HEART: two open hands with index fingers + thumbs touching,
  // forming a heart shape (approximate check)
  // ----------------------------------------------------------
  _isHeartShape(handA, handB) {
    const aThumb = handA[4];
    const aIndex = handA[8];
    const bThumb = handB[4];
    const bIndex = handB[8];

    // Thumbs should be close together, index tips should be close together
    const thumbsClose = this._dist(aThumb, bThumb) < 0.08;
    const indexClose = this._dist(aIndex, bIndex) < 0.12;

    // Both hands should be roughly open
    const aOpen = this._isOpenPalm(handA);
    const bOpen = this._isOpenPalm(handB);

    return thumbsClose && indexClose && aOpen && bOpen;
  }

  // ----------------------------------------------------------
  // WAVE: open palm with wrist oscillating horizontally
  // ----------------------------------------------------------
  _isWaving(hand) {
    const wristX = hand[0].x;
    this.wristXHistory.push(wristX);
    if (this.wristXHistory.length > this.waveWindow) {
      this.wristXHistory.shift();
    }
    if (this.wristXHistory.length < this.waveWindow) return false;

    // Count direction changes (oscillations)
    let directionChanges = 0;
    let lastDir = 0;
    for (let i = 1; i < this.wristXHistory.length; i++) {
      const diff = this.wristXHistory[i] - this.wristXHistory[i - 1];
      const dir = diff > 0.002 ? 1 : diff < -0.002 ? -1 : 0;
      if (dir !== 0 && dir !== lastDir && lastDir !== 0) {
        directionChanges++;
      }
      if (dir !== 0) lastDir = dir;
    }

    return directionChanges >= 2;
  }
}

export { GESTURES };
