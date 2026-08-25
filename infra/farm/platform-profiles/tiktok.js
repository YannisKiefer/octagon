/**
 * 🎵 OCTAGON — TikTok Platform Profile
 * 
 * Engagement logic tailored for TikTok FYP warmup sessions.
 * Implements: double-back re-watching, interest-based durations,
 * non-linear micro-gestures, and session-aware cadence decay.
 */

'use strict';

// ─── Action Definitions ────────────────────────────────────────────────────────

const TIKTOK_ACTIONS = {
  swipeNext:     { voice: 'Swipe Next',      emoji: '👇', baseDuration: 3500 },
  likePost:      { voice: 'Like Post',       emoji: '❤️', baseDuration: 1500 },
  savePost:      { voice: 'Save Post',       emoji: '💾', baseDuration: 2000 },
  openComments:  { voice: 'Open Comments',   emoji: '💬', baseDuration: 6000 },
  closeComments: { voice: 'Close Comments',  emoji: '✖️', baseDuration: 1500 },
  openProfile:   { voice: 'Open Profile',    emoji: '👤', baseDuration: 8000 },
  goBack:        { voice: 'Go Back',         emoji: '🔙', baseDuration: 2000 },
  doubleBack:    { voice: 'Double Back',     emoji: '🔄', baseDuration: 4000 },
  pauseMidSwipe: { voice: 'Pause Mid Swipe', emoji: '⏸️', baseDuration: 2000 },
  scrollThrough: { voice: 'Scroll Through',  emoji: '⚡', baseDuration: 2500 },
  sharePost:     { voice: 'Share Post',      emoji: '📤', baseDuration: 3000 },
};

// ─── Timing Constants ──────────────────────────────────────────────────────────

const VIEWING_DURATIONS = {
  skip:         { min: 800,   max: 2000  },  // Immediately uninteresting
  short:        { min: 3000,  max: 6000  },  // Glanced, moved on
  medium:       { min: 8000,  max: 15000 },  // Watched most of it
  highInterest: { min: 15000, max: 35000 },  // Watched full + re-read caption
  rewatch:      { min: 5000,  max: 12000 },  // Double-back re-engagement
};

// Probability weights for viewing duration (simulates attention distribution)
// Note: these shift as session progresses (fatigue model)
const BASE_DURATION_WEIGHTS = {
  skip:         0.15,
  short:        0.40,
  medium:       0.30,
  highInterest: 0.12,
  rewatch:      0.03,   // separate — triggered by doubleBack
};

// ─── Interaction Thresholds ────────────────────────────────────────────────────
// Each action has a probability-per-swipe and min/max interval gates

const INTERACTION_RULES = {
  likePost: {
    baseProb: 0.14,        // ~1 in 7 videos
    minInterval: 4,
    maxInterval: 12,
    fatigueDecay: 0.002,   // probability decreases per minute of session
  },
  savePost: {
    baseProb: 0.04,        // ~1 in 25 videos
    minInterval: 12,
    maxInterval: 30,
    fatigueDecay: 0.001,
  },
  openComments: {
    baseProb: 0.10,        // ~1 in 10 videos
    minInterval: 6,
    maxInterval: 18,
    fatigueDecay: 0.0015,
  },
  openProfile: {
    baseProb: 0.05,        // ~1 in 20 videos
    minInterval: 15,
    maxInterval: 35,
    fatigueDecay: 0.001,
  },
  doubleBack: {
    baseProb: 0.10,        // 8-12% of videos get re-watched
    minInterval: 8,
    maxInterval: 20,
    fatigueDecay: 0.001,
  },
  pauseMidSwipe: {
    baseProb: 0.08,        // Finger hesitation
    minInterval: 8,
    maxInterval: 25,
    fatigueDecay: 0.0005,
  },
  sharePost: {
    baseProb: 0.015,       // Very rare
    minInterval: 40,
    maxInterval: 80,
    fatigueDecay: 0.0003,
  },
  scrollThrough: {
    baseProb: 0.03,        // Fast-forward burst
    minInterval: 25,
    maxInterval: 60,
    fatigueDecay: 0.0005,
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max) => Math.random() * (max - min) + min;

/**
 * Weighted random selection from a distribution map.
 * @param {Object} weights - { key: probability }
 * @returns {string} selected key
 */
function weightedSelect(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/**
 * Apply fatigue-adjusted probability.
 * As session progresses, interaction rates naturally decay.
 */
function fatigueAdjustedProb(baseProb, decayRate, sessionMinutes) {
  return Math.max(0.005, baseProb - (decayRate * sessionMinutes));
}

// ─── Session State ─────────────────────────────────────────────────────────────

/**
 * Create a fresh session state object.
 * Tracks interaction history for intelligent behavior.
 */
function createSessionState() {
  return {
    swipeCount: 0,
    lastActions: {},         // { actionKey: lastSwipeCount }
    consecutiveLikes: 0,     // Reset engagement depth tracking
    consecutiveSkips: 0,     // Track boredom streaks
    sessionStartTime: Date.now(),
    interestScores: [],      // Rolling window of "interest" for content
    lastDoubleBackAt: 0,
    totalLikes: 0,
    totalSaves: 0,
    totalComments: 0,
    totalProfileVisits: 0,
  };
}

// ─── Core Decision Engine ──────────────────────────────────────────────────────

/**
 * Get the next action sequence for the current swipe.
 * Returns an array of actions to execute in order.
 * 
 * @param {Object} state - Session state from createSessionState()
 * @returns {{ actions: Array<{key: string, action: Object, waitMs: number}>, state: Object }}
 */
function getNextActions(state) {
  state.swipeCount++;
  const sessionMinutes = (Date.now() - state.sessionStartTime) / 60000;
  const actions = [];

  // Step 1: Determine viewing duration (how long to "watch" this video)
  const interestLevel = selectInterestLevel(state, sessionMinutes);
  const viewDuration = random(
    VIEWING_DURATIONS[interestLevel].min,
    VIEWING_DURATIONS[interestLevel].max
  );

  // Track interest for pattern analysis
  state.interestScores.push(interestLevel);
  if (state.interestScores.length > 50) state.interestScores.shift();

  // Track skip streaks
  if (interestLevel === 'skip') {
    state.consecutiveSkips++;
  } else {
    state.consecutiveSkips = 0;
  }

  // Step 2: Primary action — always swipe to next video
  actions.push({
    key: 'swipeNext',
    action: TIKTOK_ACTIONS.swipeNext,
    waitMs: viewDuration,
  });

  // Step 3: Determine secondary actions based on interest level + probability
  const triggeredActions = evaluateInteractions(state, sessionMinutes, interestLevel);

  for (const triggered of triggeredActions) {
    const actionDef = TIKTOK_ACTIONS[triggered];
    const jitter = random(
      Math.floor(actionDef.baseDuration * 0.3),
      Math.floor(actionDef.baseDuration * 1.2)
    );
    actions.push({
      key: triggered,
      action: actionDef,
      waitMs: actionDef.baseDuration + jitter,
    });

    // Update state tracking
    state.lastActions[triggered] = state.swipeCount;
    if (triggered === 'likePost') { state.totalLikes++; state.consecutiveLikes++; }
    if (triggered === 'savePost') state.totalSaves++;
    if (triggered === 'openComments') state.totalComments++;
    if (triggered === 'openProfile') state.totalProfileVisits++;
    if (triggered === 'doubleBack') state.lastDoubleBackAt = state.swipeCount;
  }

  // Reset consecutive likes if we didn't like this one
  if (!triggeredActions.includes('likePost')) {
    state.consecutiveLikes = 0;
  }

  // Step 4: Anti-pattern break — if we're in a boring streak, inject a micro-gesture
  if (state.consecutiveSkips >= 4 && Math.random() < 0.3) {
    actions.push({
      key: 'pauseMidSwipe',
      action: TIKTOK_ACTIONS.pauseMidSwipe,
      waitMs: random(1500, 4000),
    });
    state.consecutiveSkips = 0;
  }

  return { actions, state };
}

/**
 * Select interest level for current video using weighted distribution.
 * Adjusts weights based on session fatigue and recent patterns.
 */
function selectInterestLevel(state, sessionMinutes) {
  const weights = { ...BASE_DURATION_WEIGHTS };

  // Fatigue model: more skips as session ages
  const fatigueFactor = Math.min(1, sessionMinutes / 45); // normalize to 45min
  weights.skip += fatigueFactor * 0.15;
  weights.short += fatigueFactor * 0.05;
  weights.highInterest -= fatigueFactor * 0.08;
  weights.medium -= fatigueFactor * 0.05;

  // If we just double-backed, next video gets less attention (natural behavior)
  if (state.swipeCount - state.lastDoubleBackAt <= 2 && state.lastDoubleBackAt > 0) {
    weights.skip += 0.15;
    weights.short += 0.10;
    weights.highInterest -= 0.05;
  }

  // Boredom streak correction: after 3+ skips, slightly increase medium chance
  // (user finds something interesting eventually)
  if (state.consecutiveSkips >= 3) {
    weights.medium += 0.10;
    weights.highInterest += 0.05;
  }

  return weightedSelect(weights);
}

/**
 * Evaluate which secondary interactions should trigger on this swipe.
 * Uses probability gates and interval enforcement.
 */
function evaluateInteractions(state, sessionMinutes, interestLevel) {
  const triggered = [];

  // Only allow engagement actions on medium+ interest videos
  if (interestLevel === 'skip') return triggered;

  for (const [actionKey, rule] of Object.entries(INTERACTION_RULES)) {
    const lastAt = state.lastActions[actionKey] || 0;
    const gap = state.swipeCount - lastAt;

    // Enforce minimum interval
    if (gap < rule.minInterval) continue;

    // Calculate fatigue-adjusted probability
    let prob = fatigueAdjustedProb(rule.baseProb, rule.fatigueDecay, sessionMinutes);

    // Boost probability for high-interest content
    if (interestLevel === 'highInterest') {
      prob *= 2.0;  // Doubles chance of engagement on interesting content
    } else if (interestLevel === 'short') {
      prob *= 0.3;  // Much less likely to engage on short-viewed content
    }

    // Anti-consecutive-like guard: don't like 3+ in a row
    if (actionKey === 'likePost' && state.consecutiveLikes >= 2) {
      prob *= 0.1;
    }

    // Double-back: only triggers if previous video was high-interest
    if (actionKey === 'doubleBack') {
      const prevInterest = state.interestScores[state.interestScores.length - 2];
      if (prevInterest !== 'highInterest' && prevInterest !== 'medium') {
        continue;
      }
    }

    // Gate exceeded max interval → force trigger
    if (gap >= rule.maxInterval) {
      triggered.push(actionKey);
      continue;
    }

    // Roll probability
    if (Math.random() < prob) {
      triggered.push(actionKey);
    }
  }

  // If openComments triggered, always follow with closeComments after delay
  if (triggered.includes('openComments')) {
    triggered.push('closeComments');
  }

  // If openProfile triggered, always follow with goBack
  if (triggered.includes('openProfile')) {
    triggered.push('goBack');
  }

  return triggered;
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  PLATFORM_ID: 'tiktok',
  ACTIONS: TIKTOK_ACTIONS,
  VIEWING_DURATIONS,
  INTERACTION_RULES,
  createSessionState,
  getNextActions,
};
