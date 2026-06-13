// ============================================================
// gestureDetector.js  (v4 — shape-specific gestures + edit mode)
//
// DEFAULT GESTURE MAP:
//   FIST          → destruction (anytime)
//   PEACE         → spawnText
//   THUMB_UP      → removeText
//   PINCH         → changeText
//   POINT         → shape: saturn
//   CALL          → shape: love
//   ROCK          → shape: dragon
//   OPEN_PALM     → shape: sphere
//
// Edit mode: user can remap gesture → action via UI
// ============================================================

export const GESTURES = {
  NONE:       "None",
  FIST:       "Fist ✊",
  OPEN_PALM:  "Open Palm ✋",
  PEACE:      "Peace ✌",
  THUMB_UP:   "Thumb Up 👍",
  PINCH:      "Pinch 🤏",
  POINT:      "Point ☝",
  CALL:       "Call 🤙",
  ROCK:       "Rock 🤘",
};

export const ACTIONS = {
  NONE:        "none",
  DESTRUCTION: "destruction",
  SPAWN_TEXT:  "spawnText",
  REMOVE_TEXT: "removeText",
  CHANGE_TEXT: "changeText",
  SHAPE_SATURN: "shape_saturn",
  SHAPE_LOVE:   "shape_love",
  SHAPE_DRAGON: "shape_dragon",
  SHAPE_SPHERE: "shape_sphere",
};

// Default gesture → action mapping
const DEFAULT_MAP = {
  [GESTURES.FIST]:      ACTIONS.DESTRUCTION,
  [GESTURES.OPEN_PALM]: ACTIONS.SHAPE_SPHERE,
  [GESTURES.PEACE]:     ACTIONS.SPAWN_TEXT,
  [GESTURES.THUMB_UP]:  ACTIONS.REMOVE_TEXT,
  [GESTURES.PINCH]:     ACTIONS.CHANGE_TEXT,
  [GESTURES.POINT]:     ACTIONS.SHAPE_SATURN,
  [GESTURES.CALL]:      ACTIONS.SHAPE_LOVE,
  [GESTURES.ROCK]:      ACTIONS.SHAPE_DRAGON,
};

// Action cooldowns in ms
const ACTION_COOLDOWNS = {
  [ACTIONS.DESTRUCTION]: 2000,
  [ACTIONS.SPAWN_TEXT]:  600,
  [ACTIONS.REMOVE_TEXT]: 600,
  [ACTIONS.CHANGE_TEXT]: 600,
  [ACTIONS.SHAPE_SATURN]: 1000,
  [ACTIONS.SHAPE_LOVE]:   1000,
  [ACTIONS.SHAPE_DRAGON]: 1000,
  [ACTIONS.SHAPE_SPHERE]: 1000,
};

export class GestureDetector {
  constructor() {
    this.hands = [this._makeHandState(), this._makeHandState()];
    this.requiredMs = 320;

    // Gesture → Action map (mutable for edit mode)
    this.gestureMap = { ...DEFAULT_MAP };

    // Per-action cooldown timers
    this.cooldowns = {};
    Object.values(ACTIONS).forEach(a => this.cooldowns[a] = 0);

    // Edit mode
    this.editMode = false;
    this.editListenCallback = null; // called with gesture name when gesture confirmed in edit mode
  }

  setGestureMap(map) {
    this.gestureMap = { ...map };
  }

  getGestureMap() {
    return { ...this.gestureMap };
  }

  resetGestureMap() {
    this.gestureMap = { ...DEFAULT_MAP };
  }

  // Enter edit mode: next confirmed gesture will be passed to callback
  listenForGesture(callback) {
    this.editListenCallback = callback;
  }

  _makeHandState() {
    return {
      confirmed:      GESTURES.NONE,
      candidate:      GESTURES.NONE,
      candidateSince: 0,
      confidence:     0,
    };
  }

  _dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z||0)-(b.z||0);
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
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

    // PINCH — check first (high priority)
    const pinchDist = this._dist(hand[4], hand[8]);
    if (pinchDist < 0.048) {
      return { gesture: GESTURES.PINCH, confidence: Math.min(1, (0.048 - pinchDist) / 0.048 + 0.35) };
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
    if (thumbExtended && pinky.extended && !index.extended && !middle.extended && !ring.extended) {
      return { gesture: GESTURES.CALL, confidence: 0.82 };
    }

    // FIST — must come before OPEN_PALM
    if (extendedCount === 0) {
      const curl = Math.max(0.3, 1 - avgRatio / 1.25);
      return { gesture: GESTURES.FIST, confidence: Math.min(1, curl) };
    }

    // PEACE: index + middle only
    if (index.extended && middle.extended && !ring.extended && !pinky.extended) {
      return { gesture: GESTURES.PEACE, confidence: Math.min(1, (index.ratio + middle.ratio) / 2 / 1.6) };
    }

    // POINT: only index
    if (index.extended && !middle.extended && !ring.extended && !pinky.extended) {
      return { gesture: GESTURES.POINT, confidence: Math.min(1, index.ratio / 1.6) };
    }

    // ROCK: index + pinky
    if (index.extended && !middle.extended && !ring.extended && pinky.extended) {
      return { gesture: GESTURES.ROCK, confidence: 0.82 };
    }

    // OPEN PALM (3+ fingers)
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
    }
    return justConfirmed;
  }

  detect(hands, now = performance.now(), deltaMs = 16) {
    const events = {
      destruction:   false,
      spawnText:     false,
      removeText:    false,
      changeText:    false,
      shape:         null,   // string: "saturn" | "love" | "dragon" | "sphere" | null
    };

    // Tick down cooldowns
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

    // Edit mode: capture next confirmed gesture
    if (this.editListenCallback && confirmed0) {
      const g = confirmed0.next;
      if (g !== GESTURES.NONE) {
        this.editListenCallback(g);
        this.editListenCallback = null;
      }
    }

    // Fire events from primary hand
    if (confirmed0) {
      const gesture = confirmed0.next;
      const action  = this.gestureMap[gesture] || ACTIONS.NONE;

      if (action !== ACTIONS.NONE && this.cooldowns[action] <= 0) {
        this.cooldowns[action] = ACTION_COOLDOWNS[action] || 1000;

        switch (action) {
          case ACTIONS.DESTRUCTION:  events.destruction = true; break;
          case ACTIONS.SPAWN_TEXT:   events.spawnText   = true; break;
          case ACTIONS.REMOVE_TEXT:  events.removeText  = true; break;
          case ACTIONS.CHANGE_TEXT:  events.changeText  = true; break;
          case ACTIONS.SHAPE_SATURN: events.shape = "saturn";   break;
          case ACTIONS.SHAPE_LOVE:   events.shape = "love";     break;
          case ACTIONS.SHAPE_DRAGON: events.shape = "dragon";   break;
          case ACTIONS.SHAPE_SPHERE: events.shape = "sphere";   break;
        }
      }
    }

    // Two-hand fist = destruction regardless of map
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
