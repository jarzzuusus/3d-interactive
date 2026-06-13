// ============================================================
// gestureDetector.js  (extended)
//
// Gestures:
//   NONE, FIST, OPEN_PALM, PEACE, THUMB_UP, PINCH,
//   POINT (only index extended),
//   CALL (thumb + pinky extended),
//   ROCK (index + pinky extended — "rock" sign)
//
// Events fired (single-shot, debounced):
//   destruction   — OPEN_PALM → FIST  (palm mengepal → smooth dissolve)
//   spawnText     — PEACE confirmed
//   removeText    — THUMB_UP confirmed
//   changeText    — PINCH confirmed
//   nextShape     — POINT confirmed        (cycle shapes: saturn→love→dragon→sphere)
//   prevShape     — CALL confirmed         (cycle shapes backwards)
//   twoHandEvent  — both hands detected simultaneously (reserved for 2-hand gestures)
//
// 2-hand support:
//   Both hands are classified; secondary hand gesture is returned in result.secondGesture.
//   A combined "two-hand destruction" fires when BOTH hands do FIST→PALM.
// ============================================================

export const GESTURES = {
  NONE:       "None",
  FIST:       "Fist",
  OPEN_PALM:  "Open Palm",
  PEACE:      "Peace ✌",
  THUMB_UP:   "Thumb Up 👍",
  PINCH:      "Pinch 🤏",
  POINT:      "Point ☝",
  CALL:       "Call 🤙",
  ROCK:       "Rock 🤘",
};

export class GestureDetector {
  constructor() {
    // Per-hand state (index 0 = primary, index 1 = secondary)
    this.hands = [this._makeHandState(), this._makeHandState()];
    this.requiredMs = 350;

    this.destructionCooldownMs = 0;
    this.shapeCooldownMs       = 0;
  }

  _makeHandState() {
    return {
      confirmed:      GESTURES.NONE,
      candidate:      GESTURES.NONE,
      candidateSince: 0,
      confidence:     0,
      fistConfirmedAt: 0,
      palmConfirmedAt: 0,
    };
  }

  _dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _fingerExtended(hand, tipIdx, mcpIdx, wristIdx) {
    const tipToWrist = this._dist(hand[tipIdx], hand[wristIdx]);
    const mcpToWrist = this._dist(hand[mcpIdx], hand[wristIdx]);
    const ratio = tipToWrist / (mcpToWrist || 0.0001);
    return { extended: ratio > 1.25, ratio };
  }

  _classify(hand) {
    const wrist = 0;
    const index  = this._fingerExtended(hand, 8,  5,  wrist);
    const middle = this._fingerExtended(hand, 12, 9,  wrist);
    const ring   = this._fingerExtended(hand, 16, 13, wrist);
    const pinky  = this._fingerExtended(hand, 20, 17, wrist);
    const fingers = [index, middle, ring, pinky];
    const extendedCount = fingers.filter(f => f.extended).length;
    const avgRatio = fingers.reduce((s, f) => s + f.ratio, 0) / fingers.length;

    // PINCH
    const pinchDist = this._dist(hand[4], hand[8]);
    if (pinchDist < 0.045) {
      return { gesture: GESTURES.PINCH, confidence: Math.min(1, (0.045 - pinchDist) / 0.045 + 0.35) };
    }

    // THUMB
    const thumbToWrist    = this._dist(hand[4], hand[wrist]);
    const thumbMcpToWrist = this._dist(hand[2], hand[wrist]);
    const thumbRatio      = thumbToWrist / (thumbMcpToWrist || 0.0001);
    const thumbExtended   = thumbRatio > 1.4;
    const thumbUp         = hand[4].y < hand[wrist].y - 0.05;

    // THUMB_UP
    if (thumbExtended && thumbUp && extendedCount <= 1) {
      return { gesture: GESTURES.THUMB_UP, confidence: Math.min(1, 0.4 + (thumbRatio - 1.4) / 0.6) };
    }

    // CALL: thumb + pinky extended, others curled
    const pinkyExtended = pinky.extended;
    if (thumbExtended && pinkyExtended && !index.extended && !middle.extended && !ring.extended) {
      return { gesture: GESTURES.CALL, confidence: 0.8 };
    }

    // FIST
    if (extendedCount === 0) {
      const curl = Math.max(0.3, 1 - avgRatio / 1.25);
      return { gesture: GESTURES.FIST, confidence: Math.min(1, curl) };
    }

    // PEACE: index + middle, others curled
    if (index.extended && middle.extended && !ring.extended && !pinky.extended) {
      return { gesture: GESTURES.PEACE, confidence: Math.min(1, (index.ratio + middle.ratio) / 2 / 1.6) };
    }

    // POINT: only index extended
    if (index.extended && !middle.extended && !ring.extended && !pinky.extended) {
      return { gesture: GESTURES.POINT, confidence: Math.min(1, index.ratio / 1.6) };
    }

    // ROCK: index + pinky, middle + ring curled
    if (index.extended && !middle.extended && !ring.extended && pinky.extended) {
      return { gesture: GESTURES.ROCK, confidence: 0.8 };
    }

    // OPEN PALM
    if (extendedCount >= 3) {
      return { gesture: GESTURES.OPEN_PALM, confidence: Math.min(1, avgRatio / 1.6) };
    }

    return { gesture: GESTURES.NONE, confidence: 0 };
  }

  _updateHandState(state, rawGesture, rawConf, now) {
    if (rawGesture !== state.candidate) {
      state.candidate      = rawGesture;
      state.candidateSince = now;
    }
    state.confidence = rawConf;

    let justConfirmed = null;
    if (now - state.candidateSince >= this.requiredMs && state.confirmed !== state.candidate) {
      const prev       = state.confirmed;
      state.confirmed  = state.candidate;
      justConfirmed    = { prev, next: state.confirmed };

      if (state.confirmed === GESTURES.FIST) {
        state.fistConfirmedAt = now;
      }
      if (state.confirmed === GESTURES.OPEN_PALM) {
        state.palmConfirmedAt = now;
      }
    }
    return justConfirmed;
  }

  /**
   * @param {Array}  hands   - 0, 1, or 2 smoothed landmark arrays
   * @param {number} now     - performance.now()
   * @param {number} deltaMs
   */
  detect(hands, now = performance.now(), deltaMs = 16) {
    const events = {
      destruction:   false,
      spawnText:     false,
      removeText:    false,
      changeText:    false,
      nextShape:     false,
      prevShape:     false,
    };

    this.destructionCooldownMs = Math.max(0, this.destructionCooldownMs - deltaMs);
    this.shapeCooldownMs       = Math.max(0, this.shapeCooldownMs - deltaMs);

    // Classify up to 2 hands
    const rawGestures = [GESTURES.NONE, GESTURES.NONE];
    const rawConfs    = [0, 0];

    for (let i = 0; i < Math.min(2, hands.length); i++) {
      const r         = this._classify(hands[i]);
      rawGestures[i]  = r.gesture;
      rawConfs[i]     = r.confidence;
    }

    // If fewer than 2 hands, reset missing hand state
    for (let i = hands.length; i < 2; i++) {
      this.hands[i] = this._makeHandState();
    }

    const confirmed0 = this._updateHandState(this.hands[0], rawGestures[0], rawConfs[0], now);
    const confirmed1 = this._updateHandState(this.hands[1], rawGestures[1], rawConfs[1], now);

    // ── Event firing (primary hand) ────────────────────────
    if (confirmed0) {
      const { prev, next } = confirmed0;

      // OPEN_PALM → FIST  = smooth dissolve destruction
      if (
        prev === GESTURES.OPEN_PALM &&
        next === GESTURES.FIST &&
        this.destructionCooldownMs <= 0
      ) {
        events.destruction = true;
        this.destructionCooldownMs = 2000;
      }

      if (next === GESTURES.PEACE)     events.spawnText  = true;
      if (next === GESTURES.THUMB_UP)  events.removeText = true;
      if (next === GESTURES.PINCH)     events.changeText = true;

      if (next === GESTURES.POINT && this.shapeCooldownMs <= 0) {
        events.nextShape = true;
        this.shapeCooldownMs = 1200;
      }
      if (next === GESTURES.CALL && this.shapeCooldownMs <= 0) {
        events.prevShape = true;
        this.shapeCooldownMs = 1200;
      }
    }

    // ── Two-hand destruction: both hands FIST simultaneously ──
    if (
      this.hands[0].confirmed === GESTURES.FIST &&
      this.hands[1].confirmed === GESTURES.FIST &&
      hands.length >= 2 &&
      this.destructionCooldownMs <= 0
    ) {
      events.destruction = true;
      this.destructionCooldownMs = 2000;
    }

    return {
      gesture:       this.hands[0].confirmed,
      secondGesture: this.hands[1].confirmed,
      candidate:     this.hands[0].candidate,
      confidence:    this.hands[0].confidence,
      handCount:     hands.length,
      events,
    };
  }
}