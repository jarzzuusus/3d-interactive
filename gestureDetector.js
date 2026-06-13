// ============================================================
// gestureDetector.js  (v5 — improved fist, no removeText)
// ============================================================

export const GESTURES = {
  NONE:       "None",
  FIST:       "Fist ✊",
  OPEN_PALM:  "Open Palm ✋",
  PEACE:      "Peace ✌",
  PINCH:      "Pinch 🤏",
  POINT:      "Point ☝",
  CALL:       "Call 🤙",
  ROCK:       "Rock 🤘",
};

export const ACTIONS = {
  NONE:         "none",
  DESTRUCTION:  "destruction",
  SPAWN_TEXT:   "spawnText",
  CHANGE_TEXT:  "changeText",
  SHAPE_SATURN: "shape_saturn",
  SHAPE_LOVE:   "shape_love",
  SHAPE_DRAGON: "shape_dragon",
  SHAPE_SPHERE: "shape_sphere",
};

const DEFAULT_MAP = {
  [GESTURES.FIST]:      ACTIONS.DESTRUCTION,
  [GESTURES.OPEN_PALM]: ACTIONS.SHAPE_SPHERE,
  [GESTURES.PEACE]:     ACTIONS.SPAWN_TEXT,
  [GESTURES.PINCH]:     ACTIONS.CHANGE_TEXT,
  [GESTURES.POINT]:     ACTIONS.SHAPE_SATURN,
  [GESTURES.CALL]:      ACTIONS.SHAPE_LOVE,
  [GESTURES.ROCK]:      ACTIONS.SHAPE_DRAGON,
};

const ACTION_COOLDOWNS = {
  [ACTIONS.DESTRUCTION]:  2000,
  [ACTIONS.SPAWN_TEXT]:   600,
  [ACTIONS.CHANGE_TEXT]:  600,
  [ACTIONS.SHAPE_SATURN]: 1000,
  [ACTIONS.SHAPE_LOVE]:   1000,
  [ACTIONS.SHAPE_DRAGON]: 1000,
  [ACTIONS.SHAPE_SPHERE]: 1000,
};

export class GestureDetector {
  constructor() {
    this.hands = [this._makeHandState(), this._makeHandState()];
    // Longer hold = more deliberate, fewer false triggers
    this.requiredMs = 380;

    this.gestureMap = { ...DEFAULT_MAP };
    this.cooldowns  = {};
    Object.values(ACTIONS).forEach(a => this.cooldowns[a] = 0);

    this.editListenCallback = null;
  }

  setGestureMap(map)  { this.gestureMap = { ...map }; }
  getGestureMap()     { return { ...this.gestureMap }; }
  resetGestureMap()   { this.gestureMap = { ...DEFAULT_MAP }; }
  listenForGesture(cb){ this.editListenCallback = cb; }

  _makeHandState() {
    return {
      confirmed:      GESTURES.NONE,
      candidate:      GESTURES.NONE,
      candidateSince: 0,
      confidence:     0,
    };
  }

  _dist(a, b) {
    const dx = a.x-b.x, dy = a.y-b.y, dz = (a.z||0)-(b.z||0);
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  // Uses PIP joint (intermediate) vs MCP for more robust curl detection
  _fingerCurled(hand, tipIdx, pipIdx, mcpIdx) {
    // A finger is curled when its tip is closer to wrist than its pip
    const tipToMcp = this._dist(hand[tipIdx], hand[mcpIdx]);
    const pipToMcp = this._dist(hand[pipIdx], hand[mcpIdx]);
    return tipToMcp < pipToMcp * 1.1;
  }

  _fingerExtended(hand, tipIdx, mcpIdx, wristIdx) {
    const tipToWrist = this._dist(hand[tipIdx], hand[wristIdx]);
    const mcpToWrist = this._dist(hand[mcpIdx], hand[wristIdx]);
    const ratio = tipToWrist / (mcpToWrist || 0.0001);
    return { extended: ratio > 1.22, ratio };
  }

  _classify(hand) {
    const W = 0; // wrist index

    // Finger extended checks (tip vs MCP vs wrist)
    const index  = this._fingerExtended(hand, 8,  5,  W);
    const middle = this._fingerExtended(hand, 12, 9,  W);
    const ring   = this._fingerExtended(hand, 16, 13, W);
    const pinky  = this._fingerExtended(hand, 20, 17, W);

    // Curl checks using PIP joints (more reliable for fist)
    const indexCurled  = this._fingerCurled(hand, 8,  6,  5);
    const middleCurled = this._fingerCurled(hand, 12, 10, 9);
    const ringCurled   = this._fingerCurled(hand, 16, 14, 13);
    const pinkyCurled  = this._fingerCurled(hand, 20, 18, 17);

    const extendedCount = [index, middle, ring, pinky].filter(f => f.extended).length;
    const curledCount   = [indexCurled, middleCurled, ringCurled, pinkyCurled].filter(Boolean).length;
    const avgRatio = ([index, middle, ring, pinky].reduce((s,f) => s+f.ratio, 0)) / 4;

    // ── PINCH (thumb tip near index tip)
    const pinchDist = this._dist(hand[4], hand[8]);
    if (pinchDist < 0.050 && !middle.extended && !ring.extended) {
      return { gesture: GESTURES.PINCH, confidence: Math.min(1, (0.050 - pinchDist) / 0.050 + 0.4) };
    }

    // ── THUMB geometry
    const thumbToWrist    = this._dist(hand[4], hand[W]);
    const thumbMcpToWrist = this._dist(hand[2], hand[W]);
    const thumbRatio      = thumbToWrist / (thumbMcpToWrist || 0.0001);
    const thumbExtended   = thumbRatio > 1.35;

    // ── CALL: thumb + pinky, middle fingers curled
    if (thumbExtended && pinky.extended && indexCurled && middleCurled && ringCurled) {
      return { gesture: GESTURES.CALL, confidence: 0.85 };
    }

    // ── FIST: ALL 4 fingers curled (use curl metric, not just extended count)
    // Require curledCount >= 3 AND extendedCount === 0 for high accuracy
    if (curledCount >= 3 && extendedCount === 0) {
      // Extra check: avg tip-to-wrist ratio should be low
      const fistConf = Math.min(1, 0.5 + (curledCount / 4) * 0.5);
      return { gesture: GESTURES.FIST, confidence: fistConf };
    }
    // Fallback: very tight curl even if ratio method misses
    if (curledCount === 4 && avgRatio < 1.15) {
      return { gesture: GESTURES.FIST, confidence: 0.92 };
    }

    // ── PEACE: index + middle extended, ring + pinky curled
    if (index.extended && middle.extended && ringCurled && pinkyCurled) {
      const conf = Math.min(1, (index.ratio + middle.ratio) / 2 / 1.6);
      return { gesture: GESTURES.PEACE, confidence: conf };
    }

    // ── POINT: only index extended, rest curled
    if (index.extended && middleCurled && ringCurled && pinkyCurled) {
      return { gesture: GESTURES.POINT, confidence: Math.min(1, index.ratio / 1.6) };
    }

    // ── ROCK: index + pinky extended, middle + ring curled
    if (index.extended && !middle.extended && !ring.extended && pinky.extended) {
      return { gesture: GESTURES.ROCK, confidence: 0.85 };
    }

    // ── OPEN PALM: 4 fingers extended
    if (extendedCount >= 4) {
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
      const prev      = state.confirmed;
      state.confirmed = state.candidate;
      justConfirmed   = { prev, next: state.confirmed };
    }
    return justConfirmed;
  }

  detect(hands, now = performance.now(), deltaMs = 16) {
    const events = {
      destruction: false,
      spawnText:   false,
      changeText:  false,
      shape:       null,
    };

    Object.keys(this.cooldowns).forEach(a => {
      this.cooldowns[a] = Math.max(0, this.cooldowns[a] - deltaMs);
    });

    const rawGestures = [GESTURES.NONE, GESTURES.NONE];
    const rawConfs    = [0, 0];

    for (let i = 0; i < Math.min(2, hands.length); i++) {
      const r = this._classify(hands[i]);
      rawGestures[i] = r.gesture;
      rawConfs[i]    = r.confidence;
    }

    for (let i = hands.length; i < 2; i++) {
      this.hands[i] = this._makeHandState();
    }

    const confirmed0 = this._updateHandState(this.hands[0], rawGestures[0], rawConfs[0], now);
    const confirmed1 = this._updateHandState(this.hands[1], rawGestures[1], rawConfs[1], now);

    // Edit mode capture
    if (this.editListenCallback && confirmed0) {
      const g = confirmed0.next;
      if (g !== GESTURES.NONE) {
        this.editListenCallback(g);
        this.editListenCallback = null;
      }
    }

    if (confirmed0) {
      const gesture = confirmed0.next;
      const action  = this.gestureMap[gesture] || ACTIONS.NONE;
      if (action !== ACTIONS.NONE && this.cooldowns[action] <= 0) {
        this.cooldowns[action] = ACTION_COOLDOWNS[action] || 1000;
        switch (action) {
          case ACTIONS.DESTRUCTION:  events.destruction = true; break;
          case ACTIONS.SPAWN_TEXT:   events.spawnText   = true; break;
          case ACTIONS.CHANGE_TEXT:  events.changeText  = true; break;
          case ACTIONS.SHAPE_SATURN: events.shape = "saturn";   break;
          case ACTIONS.SHAPE_LOVE:   events.shape = "love";     break;
          case ACTIONS.SHAPE_DRAGON: events.shape = "dragon";   break;
          case ACTIONS.SHAPE_SPHERE: events.shape = "sphere";   break;
        }
      }
    }

    // Two-hand fist override
    if (
      this.hands[0].confirmed === GESTURES.FIST &&
      this.hands[1].confirmed === GESTURES.FIST &&
      hands.length >= 2 &&
      this.cooldowns[ACTIONS.DESTRUCTION] <= 0
    ) {
      events.destruction = true;
      this.cooldowns[ACTIONS.DESTRUCTION] = 2000;
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
