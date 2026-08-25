/**
 * 🎬 OCTAGON — YouTube Shorts Platform Profile
 *
 * Engagement logic tailored for YouTube Shorts warmup.
 * Implements: Shorts vertical scroll loops, subscribe events,
 * comment browsing, full-video pivots, and channel page visits.
 *
 * YouTube Shorts has unique behavioral signatures vs TikTok/IG:
 *   - Slower swipe cadence (~1.5x TikTok)
 *   - Higher subscribe-to-view ratio than other platforms
 *   - "Pivot to full video" behavior (Shorts → long-form)
 *   - Like/dislike binary (dislike exists on YT)
 *   - Less save behavior, more share behavior
 */

'use strict';

// ─── Action Definitions ────────────────────────────────────────────────────────

const YT_ACTIONS = {
  // Shorts navigation
  swipeNext:       { voice: 'Swipe Next',         emoji: '👇', baseDuration: 5000 },
  likePost:        { voice: 'Like Post',          emoji: '👍', baseDuration: 1500 },
  dislikePost:     { voice: 'Dislike Post',       emoji: '👎', baseDuration: 1500 },
  openComments:    { voice: 'Open Comments',      emoji: '💬', baseDuration: 6000 },
  closeComments:   { voice: 'Close Comments',     emoji: '✖️', baseDuration: 1500 },
  sharePost:       { voice: 'Share Post',         emoji: '📤', baseDuration: 3000 },
  subscribeButton: { voice: 'Subscribe Button',   emoji: '🔔', baseDuration: 2000 },
  openChannel:     { voice: 'Open Channel',       emoji: '📺', baseDuration: 8000 },
  goBack:          { voice: 'Go Back',            emoji: '🔙', baseDuration: 2000 },

  // Full video pivot
  openFullVideo:   { voice: 'Open Full Video',    emoji: '🎥', baseDuration: 15000 },
  pauseVideo:      { voice: 'Pause Video',        emoji: '⏸️', baseDuration: 2000 },
  resumeVideo:     { voice: 'Resume Video',       emoji: '▶️', baseDuration: 2000 },

  // General
  pauseMidSwipe:   { voice: 'Pause Mid Swipe',    emoji: '⏸️', baseDuration: 2500 },
  scrollThrough:   { voice: 'Scroll Through',     emoji: '⚡', baseDuration: 3000 },
};

// ─── Timing Constants ──────────────────────────────────────────────────────────

const SHORTS_VIEWING_DURATIONS = {
  skip:         { min: 1500,  max: 3000  },
  short:        { min: 5000,  max: 9000  },   // YT Shorts feel slower
  medium:       { min: 12000, max: 22000 },
  highInterest: { min: 22000, max: 50000 },
};

const FULL_VIDEO_DURATIONS = {
  peek:     { min: 10000, max: 25000 },    // Quick look at full video
  watch:    { min: 25000, max: 60000 },    // Actually watching part of it
};

// ─── Interaction Rules ─────────────────────────────────────────────────────────

const SHORTS_INTERACTION_RULES = {
  likePost: {
    baseProb: 0.12,
    minInterval: 5,
    maxInterval: 15,
    fatigueDecay: 0.002,
  },
  dislikePost: {
    baseProb: 0.008,        // Very rare but exists on YT
    minInterval: 40,
    maxInterval: 100,
    fatigueDecay: 0.0001,
  },
  openComments: {
    baseProb: 0.09,
    minInterval: 8,
    maxInterval: 22,
    fatigueDecay: 0.0015,
  },
  sharePost: {
    baseProb: 0.025,        // Higher share rate on YT than TT
    minInterval: 20,
    maxInterval: 50,
    fatigueDecay: 0.0004,
  },
  subscribeButton: {
    baseProb: 0.025,        // ~1 in 40 shorts
    minInterval: 25,
    maxInterval: 60,
    fatigueDecay: 0.0005,
  },
  openChannel: {
    baseProb: 0.04,
    minInterval: 15,
    maxInterval: 35,
    fatigueDecay: 0.0008,
  },
  openFullVideo: {
    baseProb: 0.03,         // Pivot to full-form content
    minInterval: 20,
    maxInterval: 50,
    fatigueDecay: 0.0005,
  },
  pauseMidSwipe: {
    baseProb: 0.06,
    minInterval: 12,
    maxInterval: 30,
    fatigueDecay: 0.0005,
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

function fatigueAdjustedProb(baseProb, decayRate, sessionMinutes) {
  return Math.max(0.005, baseProb - (decayRate * sessionMinutes));
}

// ─── Session State ─────────────────────────────────────────────────────────────

function createSessionState() {
  return {
    swipeCount: 0,
    lastActions: {},
    consecutiveLikes: 0,
    consecutiveSkips: 0,
    sessionStartTime: Date.now(),
    totalLikes: 0,
    totalDislikes: 0,
    totalComments: 0,
    totalSubscribes: 0,
    totalChannelVisits: 0,
    totalFullVideoPivots: 0,
    inFullVideoMode: false,       // Currently watching a full-length video
    fullVideoTimeRemaining: 0,
  };
}

// ─── Core Decision Engine ──────────────────────────────────────────────────────

/**
 * Get the next action sequence for the current interaction.
 * Handles both Shorts scrolling and full-video pivot sessions.
 */
function getNextActions(state) {
  state.swipeCount++;
  const sessionMinutes = (Date.now() - state.sessionStartTime) / 60000;

  // If we pivoted to a full video, handle that flow
  if (state.inFullVideoMode) {
    return getFullVideoActions(state, sessionMinutes);
  }

  return getShortsActions(state, sessionMinutes);
}

/**
 * YouTube Shorts vertical scroll engagement.
 */
function getShortsActions(state, sessionMinutes) {
  const actions = [];

  // Determine interest level
  const interestWeights = {
    skip: 0.10 + (sessionMinutes / 60) * 0.08,
    short: 0.35,
    medium: 0.35,
    highInterest: 0.18 - (sessionMinutes / 60) * 0.06,
  };
  const interest = weightedSelect(interestWeights);
  const viewDuration = random(
    SHORTS_VIEWING_DURATIONS[interest].min,
    SHORTS_VIEWING_DURATIONS[interest].max
  );

  // Track skip streaks
  if (interest === 'skip') {
    state.consecutiveSkips++;
  } else {
    state.consecutiveSkips = 0;
  }

  // Primary action: watch + swipe
  actions.push({
    key: 'swipeNext',
    action: YT_ACTIONS.swipeNext,
    waitMs: viewDuration,
  });

  // No engagement on skipped content
  if (interest === 'skip') {
    return { actions, state };
  }

  // Evaluate secondary interactions
  for (const [actionKey, rule] of Object.entries(SHORTS_INTERACTION_RULES)) {
    const lastAt = state.lastActions[actionKey] || 0;
    const gap = state.swipeCount - lastAt;
    if (gap < rule.minInterval) continue;

    let prob = fatigueAdjustedProb(rule.baseProb, rule.fatigueDecay, sessionMinutes);
    if (interest === 'highInterest') prob *= 2.0;
    if (interest === 'short') prob *= 0.25;

    // Anti-consecutive-like guard
    if (actionKey === 'likePost' && state.consecutiveLikes >= 2) prob *= 0.1;

    // Subscribe only after high-interest content
    if (actionKey === 'subscribeButton' && interest !== 'highInterest') continue;

    // Full video pivot only on medium+ interest
    if (actionKey === 'openFullVideo' && interest === 'short') continue;

    if (gap >= rule.maxInterval || Math.random() < prob) {
      const actionDef = YT_ACTIONS[actionKey];
      const jitter = random(300, Math.floor(actionDef.baseDuration * 0.6));

      actions.push({
        key: actionKey,
        action: actionDef,
        waitMs: actionDef.baseDuration + jitter,
      });

      state.lastActions[actionKey] = state.swipeCount;

      // Update stats
      if (actionKey === 'likePost') { state.totalLikes++; state.consecutiveLikes++; }
      if (actionKey === 'dislikePost') state.totalDislikes++;
      if (actionKey === 'openComments') state.totalComments++;
      if (actionKey === 'subscribeButton') state.totalSubscribes++;
      if (actionKey === 'openChannel') state.totalChannelVisits++;
      if (actionKey === 'openFullVideo') {
        state.totalFullVideoPivots++;
        state.inFullVideoMode = true;
        const watchType = weightedSelect({ peek: 0.6, watch: 0.4 });
        state.fullVideoTimeRemaining = random(
          FULL_VIDEO_DURATIONS[watchType].min,
          FULL_VIDEO_DURATIONS[watchType].max
        );
      }
    }
  }

  // Auto-close modals
  if (actions.some(a => a.key === 'openComments')) {
    actions.push({ key: 'closeComments', action: YT_ACTIONS.closeComments, waitMs: random(1000, 2500) });
  }
  if (actions.some(a => a.key === 'openChannel')) {
    actions.push({ key: 'goBack', action: YT_ACTIONS.goBack, waitMs: random(1500, 4000) });
  }

  if (!actions.some(a => a.key === 'likePost')) state.consecutiveLikes = 0;

  // Anti-boredom: inject micro-gesture after skip streaks
  if (state.consecutiveSkips >= 5 && Math.random() < 0.25) {
    actions.push({
      key: 'pauseMidSwipe',
      action: YT_ACTIONS.pauseMidSwipe,
      waitMs: random(1500, 4000),
    });
    state.consecutiveSkips = 0;
  }

  return { actions, state };
}

/**
 * Full-video pivot: watch a long-form video for a short period, then return to Shorts.
 */
function getFullVideoActions(state, sessionMinutes) {
  const actions = [];

  // Maybe pause/resume the video (10% chance)
  if (Math.random() < 0.10) {
    actions.push({
      key: 'pauseVideo',
      action: YT_ACTIONS.pauseVideo,
      waitMs: random(2000, 5000),  // Pause for a moment
    });
    actions.push({
      key: 'resumeVideo',
      action: YT_ACTIONS.resumeVideo,
      waitMs: random(1000, 2000),
    });
  }

  // Watch for the remaining time
  const watchChunk = Math.min(state.fullVideoTimeRemaining, random(8000, 15000));
  state.fullVideoTimeRemaining -= watchChunk;

  actions.push({
    key: 'swipeNext',   // Re-using swipeNext as "wait/watch" action
    action: { ...YT_ACTIONS.swipeNext, voice: 'Wait', emoji: '⏳' },
    waitMs: watchChunk,
  });

  // Exit full video mode when time is up
  if (state.fullVideoTimeRemaining <= 0) {
    state.inFullVideoMode = false;
    actions.push({
      key: 'goBack',
      action: YT_ACTIONS.goBack,
      waitMs: random(1000, 2000),
    });
  }

  return { actions, state };
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  PLATFORM_ID: 'youtube',
  ACTIONS: YT_ACTIONS,
  SHORTS_VIEWING_DURATIONS,
  SHORTS_INTERACTION_RULES,
  createSessionState,
  getNextActions,
};
