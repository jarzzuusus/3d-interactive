// ============================================================
// gestureDetector.js
// Classifies hand landmarks into gestures with:
//  - Per-frame confidence scores
//  - Temporal stability (300-500ms hold before a gesture "confirms")
//  - Event flags for higher-level actions:
//      - FIST -> OPEN_PALM (fast)  => destruction
//      - PEACE                     => spawn text
//      - THUMB_UP                  => remove text
//      - PINCH                     => change text
//  - Cooldown to avoid repeated/accidental triggers
// ============================================================

export const GESTURES = {
  NONE: "None",
  FIST: "Fist",
  OPEN_PALM: "Open Palm",
  PEACE: "Peace",
  THUMB_UP: "Thumb Up",
  PINCH: "Pinch",
};

export class GestureDetector {
  constructor() {
    this.confirmed = GESTURES.NONE;
    this.candidate = GESTURES.NONE;
    this.candidateSince = 0;
    this.requiredMs = 400; // stability window (300-500ms)

    this.confidence = 0;

    this.destructionCooldownMs = 0;
    // Track when FIST was last confirmed, to detect a fast FIST->OPEN_PALM
    this.fistConfirmedAt = 0;
    this.fastTransitionWindowMs = 700;
  }

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _fingerExtended(hand, tipIdx, mcpIdx, wristIdx) {
    const tipToWrist = this._dist(hand[tipIdx], hand[wristIdx]);
    const mcpToWrist = this._dist(hand[mcpIdx], hand[wristIdx]);
    const ratio = tipToWrist / (mcpToWrist || 0.0001);
    return { extended: ratio > 1.25, ratio };
  }

  /**
   * Classify a single hand's landmarks into a gesture + confidence (0-1).
   */
  _classify(hand) {
    const wrist = 0;

    const index = this._fingerExtended(hand, 8, 5, wrist);
    const middle = this._fingerExtended(hand, 12, 9, wrist);
    const ring = this._fingerExtended(hand, 16, 13, wrist);
    const pinky = this._fingerExtended(hand, 20, 17, wrist);
    const fingers = [index, middle, ring, pinky];
    const extendedCount = fingers.filter((f) => f.extended).length;
    const avgRatio = fingers.reduce((s, f) => s + f.ratio, 0) / fingers.length;

    // PINCH: thumb tip close to index tip
    const pinchDist = this._dist(hand[4], hand[8]);
    if (pinchDist < 0.045) {
      const confidence = Math.min(1, (0.045 - pinchDist) / 0.045 + 0.35);
      return { gesture: GESTURES.PINCH, confidence };
    }

    // THUMB UP: thumb extended, pointing up, other fingers curled
    const thumbToWrist = this._dist(hand[4], hand[wrist]);
    const thumbMcpToWrist = this._dist(hand[2], hand[wrist]);
    const thumbRatio = thumbToWrist / (thumbMcpToWrist || 0.0001);
    const thumbExtended = thumbRatio > 1.4;
    const thumbPointingUp = hand[4].y < hand[wrist].y - 0.05;

    if (thumbExtended && thumbPointingUp && extendedCount <= 1) {
      const confidence = Math.min(1, 0.4 + (thumbRatio - 1.4) / 0.6);
      return { gesture: GESTURES.THUMB_UP, confidence };
    }

    // FIST: nothing extended
    if (extendedCount === 0) {
      const curl = Math.max(0.3, 1 - avgRatio / 1.25);
      return { gesture: GESTURES.FIST, confidence: Math.min(1, curl) };
    }

    // PEACE: index + middle extended, ring + pinky curled
    if (index.extended && middle.extended && !ring.extended && !pinky.extended) {
      const confidence = Math.min(1, (index.ratio + middle.ratio) / 2 / 1.6);
      return { gesture: GESTURES.PEACE, confidence };
    }

    // OPEN PALM: most fingers extended
    if (extendedCount >= 3) {
      const confidence = Math.min(1, avgRatio / 1.6);
      return { gesture: GESTURES.OPEN_PALM, confidence };
    }

    return { gesture: GESTURES.NONE, confidence: 0 };
  }

  /**
   * @param {Array} hands - smoothed landmark arrays (0-2 hands)
   * @param {number} now - performance.now() timestamp
   * @param {number} deltaMs - ms since previous detect() call
   * @returns {{gesture, candidate, confidence, events}}
   */
  detect(hands, now = performance.now(), deltaMs = 16) {
    const events = { destruction: false, spawnText: false, removeText: false, changeText: false };

    this.destructionCooldownMs = Math.max(0, this.destructionCooldownMs - deltaMs);

    let raw = GESTURES.NONE;
    let conf = 0;

    if (hands && hands.length > 0) {
      const r = this._classify(hands[0]);
      raw = r.gesture;
      conf = r.confidence;
    }

    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = now;
    }
    this.confidence = conf;

    // Confirm the candidate once it's been stable long enough
    if (now - this.candidateSince >= this.requiredMs && this.confirmed !== this.candidate) {
      const prev = this.confirmed;
      this.confirmed = this.candidate;

      if (this.confirmed === GESTURES.FIST) {
        this.fistConfirmedAt = now;
      }

      // Fast FIST -> OPEN_PALM transition triggers destruction
      if (
        prev === GESTURES.FIST &&
        this.confirmed === GESTURES.OPEN_PALM &&
        now - this.fistConfirmedAt <= this.fastTransitionWindowMs &&
        this.destructionCooldownMs <= 0
      ) {
        events.destruction = true;
        this.destructionCooldownMs = 1500;
      }

      if (this.confirmed === GESTURES.PEACE) events.spawnText = true;
      if (this.confirmed === GESTURES.THUMB_UP) events.removeText = true;
      if (this.confirmed === GESTURES.PINCH) events.changeText = true;
    }

    return {
      gesture: this.confirmed,
      candidate: this.candidate,
      confidence: this.confidence,
      events,
    };
  }
}