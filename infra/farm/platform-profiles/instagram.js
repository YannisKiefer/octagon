/**
 * 📷 OCTAGON — Instagram Platform Profile
 *
 * Engagement logic tailored for Instagram warmup sessions.
 * Implements: Reels-specific cadence, Story-viewing pauses,
 * Explore-page deep dives, DM-check simulation, and feed scrolling.
 *
 * Instagram has 4 distinct interaction surfaces — this profile
 * models realistic session flow between them:
 *   1. Reels (primary — vertical scroll, TikTok-like)
 *   2. Stories (top bar — horizontal tap-through)
 *   3. Explore (grid → post → comments → back)
 *   4. Feed (home feed scroll)
 */

'use strict';

// ─── Action Definitions ────────────────────────────────────────────────────────

const IG_ACTIONS = {
  // Reels
  swipeNext:      { voice: 'Swipe Next',        emoji: '👇', baseDuration: 4000 },
  likePost:       { voice: 'Like Post',         emoji: '❤️', baseDuration: 1500 },
  savePost:       { voice: 'Save Post',         emoji: '💾', baseDuration: 2000 },
  openComments:   { voice: 'Open Comments',     emoji: '💬', baseDuration: 5000 },
  closeComments:  { voice: 'Close Comments',    emoji: '✖️', baseDuration: 1500 },
  sharePost:      { voice: 'Share Post',        emoji: '📤', baseDuration: 2500 },
  openProfile:    { voice: 'Open Profile',      emoji: '👤', baseDuration: 8000 },
  goBack:         { voice: 'Go Back',           emoji: '🔙', baseDuration: 2000 },

  // Stories
  tapNextStory:   { voice: 'Tap Next Story',    emoji: '➡️', baseDuration: 2000 },
  holdStory:      { voice: 'Hold Story',        emoji: '⏸️', baseDuration: 4000 },
  tapPrevStory:   { voice: 'Tap Prev Story',    emoji: '⬅️', baseDuration: 1500 },
  replyStory:     { voice: 'Reply Story',       emoji: '💌', baseDuration: 3000 },

  // Explore
  openExplore:    { voice: 'Open Explore',      emoji: '🔍', baseDuration: 3000 },
  tapGridItem:    { voice: 'Tap Grid Item',     emoji: '🖼️', baseDuration: 2000 },
  scrollExplore:  { voice: 'Scroll Explore',    emoji: '📜', baseDuration: 3500 },

  // Navigation
  openHome:       { voice: 'Open Home',         emoji: '🏠', baseDuration: 2000 },
  openReels:      { voice: 'Open Reels',        emoji: '🎬', baseDuration: 2000 },
  checkDMs:       { voice: 'Check Messages',    emoji: '✉️', baseDuration: 5000 },
  pauseMidSwipe:  { voice: 'Pause Mid Swipe',   emoji: '⏸️', baseDuration: 2500 },
};

// ─── Timing Constants ──────────────────────────────────────────────────────────

const REEL_VIEWING_DURATIONS = {
  skip:         { min: 1200,  max: 2500  },
  short:        { min: 3500,  max: 7000  },   // IG Reels are ~1.5x slower cadence than TT
  medium:       { min: 9000,  max: 18000 },
  highInterest: { min: 18000, max: 40000 },
};

const STORY_VIEWING_DURATIONS = {
  skip:    { min: 600,  max: 1500 },   // Tap-through fast
  watch:   { min: 2000, max: 5000 },   // Watch full story panel
  hold:    { min: 4000, max: 8000 },   // Hold to pause and read
};

const EXPLORE_VIEWING_DURATIONS = {
  browse:  { min: 3000,  max: 8000  },  // Browse the grid
  deepDive:{ min: 10000, max: 25000 },  // Open post + scroll comments
};

// ─── Session Surfaces ──────────────────────────────────────────────────────────

const SURFACE_WEIGHTS = {
  reels:   0.55,    // Primary surface — most time spent here
  stories: 0.15,    // Quick story browse sessions
  explore: 0.15,    // Explore page deep dives
  feed:    0.10,    // Home feed scrolling
  dm:      0.05,    // Quick DM check
};

// How long to spend on each surface before switching
const SURFACE_DURATION = {
  reels:   { minSwipes: 8,  maxSwipes: 25 },
  stories: { minStories: 3, maxStories: 12 },
  explore: { minItems: 2,   maxItems: 6 },
  feed:    { minScrolls: 3, maxScrolls: 8 },
  dm:      { fixed: 1 },
};

// ─── Interaction Rules ─────────────────────────────────────────────────────────

const REEL_INTERACTION_RULES = {
  likePost: {
    baseProb: 0.16,         // IG users like slightly more than TT
    minInterval: 3,
    maxInterval: 10,
    fatigueDecay: 0.002,
  },
  savePost: {
    baseProb: 0.06,         // Higher save rate on IG than TT
    minInterval: 8,
    maxInterval: 25,
    fatigueDecay: 0.001,
  },
  openComments: {
    baseProb: 0.08,
    minInterval: 7,
    maxInterval: 20,
    fatigueDecay: 0.0015,
  },
  openProfile: {
    baseProb: 0.06,
    minInterval: 12,
    maxInterval: 30,
    fatigueDecay: 0.001,
  },
  sharePost: {
    baseProb: 0.02,
    minInterval: 30,
    maxInterval: 60,
    fatigueDecay: 0.0003,
  },
  pauseMidSwipe: {
    baseProb: 0.07,
    minInterval: 10,
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
    currentSurface: 'reels',       // Which IG surface we're on
    surfaceSwipesRemaining: 0,     // Swipes left before surface switch
    lastActions: {},
    consecutiveLikes: 0,
    consecutiveSkips: 0,
    sessionStartTime: Date.now(),
    surfaceHistory: [],            // Track which surfaces we've visited
    totalLikes: 0,
    totalSaves: 0,
    totalComments: 0,
    totalProfileVisits: 0,
    storyCount: 0,
    exploreCount: 0,
    dmChecks: 0,
  };
}

// ─── Core Decision Engine ──────────────────────────────────────────────────────

/**
 * Get the next action sequence for the current interaction.
 * Manages surface switching between Reels, Stories, Explore, Feed, and DMs.
 */
function getNextActions(state) {
  state.swipeCount++;
  const sessionMinutes = (Date.now() - state.sessionStartTime) / 60000;

  // Check if we need to switch surfaces
  if (state.surfaceSwipesRemaining <= 0) {
    return switchSurface(state, sessionMinutes);
  }

  state.surfaceSwipesRemaining--;

  // Dispatch to surface-specific handler
  switch (state.currentSurface) {
    case 'reels': return getReelsActions(state, sessionMinutes);
    case 'stories': return getStoryActions(state, sessionMinutes);
    case 'explore': return getExploreActions(state, sessionMinutes);
    case 'feed': return getFeedActions(state, sessionMinutes);
    case 'dm': return getDMActions(state, sessionMinutes);
    default: return getReelsActions(state, sessionMinutes);
  }
}

/**
 * Switch to a new IG surface (Reels → Stories → Explore, etc.)
 */
function switchSurface(state, sessionMinutes) {
  const actions = [];
  const prevSurface = state.currentSurface;

  // Select next surface weighted by preference
  // Avoid picking the same surface twice in a row
  const adjustedWeights = { ...SURFACE_WEIGHTS };
  adjustedWeights[prevSurface] *= 0.2; // Heavily penalize repeating

  // DM only once or twice per session
  if (state.dmChecks >= 2) adjustedWeights.dm = 0;

  const nextSurface = weightedSelect(adjustedWeights);
  state.currentSurface = nextSurface;
  state.surfaceHistory.push(nextSurface);

  // Set duration for next surface
  const duration = SURFACE_DURATION[nextSurface];
  if (duration.fixed) {
    state.surfaceSwipesRemaining = duration.fixed;
  } else {
    const key = Object.keys(duration)[0];
    const minKey = `min${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const maxKey = `max${key.charAt(0).toUpperCase() + key.slice(1)}`;
    state.surfaceSwipesRemaining = random(
      duration[Object.keys(duration)[0]],
      duration[Object.keys(duration)[1]]
    );
  }

  // Navigate to the surface
  const navAction = {
    reels: 'openReels',
    stories: 'openHome',      // Stories are on home screen
    explore: 'openExplore',
    feed: 'openHome',
    dm: 'checkDMs',
  }[nextSurface];

  actions.push({
    key: navAction,
    action: IG_ACTIONS[navAction],
    waitMs: IG_ACTIONS[navAction].baseDuration + random(500, 2000),
  });

  return { actions, state };
}

/**
 * Reels-specific engagement (similar to TikTok but ~1.5x slower cadence).
 */
function getReelsActions(state, sessionMinutes) {
  const actions = [];

  // Determine interest level
  const interestWeights = {
    skip: 0.12 + (sessionMinutes / 60) * 0.1,
    short: 0.38,
    medium: 0.32,
    highInterest: 0.15 - (sessionMinutes / 60) * 0.06,
  };
  const interest = weightedSelect(interestWeights);
  const viewDuration = random(
    REEL_VIEWING_DURATIONS[interest].min,
    REEL_VIEWING_DURATIONS[interest].max
  );

  // Primary swipe
  actions.push({
    key: 'swipeNext',
    action: IG_ACTIONS.swipeNext,
    waitMs: viewDuration,
  });

  if (interest === 'skip') {
    state.consecutiveSkips++;
    return { actions, state };
  }
  state.consecutiveSkips = 0;

  // Secondary interactions
  for (const [actionKey, rule] of Object.entries(REEL_INTERACTION_RULES)) {
    const lastAt = state.lastActions[actionKey] || 0;
    const gap = state.swipeCount - lastAt;
    if (gap < rule.minInterval) continue;

    let prob = fatigueAdjustedProb(rule.baseProb, rule.fatigueDecay, sessionMinutes);
    if (interest === 'highInterest') prob *= 2.0;
    if (interest === 'short') prob *= 0.3;
    if (actionKey === 'likePost' && state.consecutiveLikes >= 2) prob *= 0.1;

    if (gap >= rule.maxInterval || Math.random() < prob) {
      const actionDef = IG_ACTIONS[actionKey];
      actions.push({
        key: actionKey,
        action: actionDef,
        waitMs: actionDef.baseDuration + random(300, actionDef.baseDuration * 0.8),
      });
      state.lastActions[actionKey] = state.swipeCount;
      if (actionKey === 'likePost') { state.totalLikes++; state.consecutiveLikes++; }
      if (actionKey === 'savePost') state.totalSaves++;
      if (actionKey === 'openComments') state.totalComments++;
      if (actionKey === 'openProfile') state.totalProfileVisits++;
    }
  }

  // Auto-close modals
  if (actions.some(a => a.key === 'openComments')) {
    actions.push({ key: 'closeComments', action: IG_ACTIONS.closeComments, waitMs: random(1000, 2500) });
  }
  if (actions.some(a => a.key === 'openProfile')) {
    actions.push({ key: 'goBack', action: IG_ACTIONS.goBack, waitMs: random(1500, 3000) });
  }

  if (!actions.some(a => a.key === 'likePost')) state.consecutiveLikes = 0;

  return { actions, state };
}

/**
 * Story-viewing simulation with natural pauses and occasional skip-backs.
 */
function getStoryActions(state, sessionMinutes) {
  const actions = [];
  state.storyCount++;

  // Determine story engagement
  const storyType = weightedSelect({ skip: 0.30, watch: 0.50, hold: 0.20 });
  const dur = STORY_VIEWING_DURATIONS[storyType];

  if (storyType === 'hold') {
    actions.push({
      key: 'holdStory',
      action: IG_ACTIONS.holdStory,
      waitMs: random(dur.min, dur.max),
    });
  }

  // Wait (watching)
  actions.push({
    key: 'tapNextStory',
    action: IG_ACTIONS.tapNextStory,
    waitMs: random(dur.min, dur.max),
  });

  // Rare: tap back to re-watch previous story (5% chance)
  if (Math.random() < 0.05 && state.storyCount > 1) {
    actions.push({
      key: 'tapPrevStory',
      action: IG_ACTIONS.tapPrevStory,
      waitMs: random(2000, 4000),
    });
  }

  return { actions, state };
}

/**
 * Explore page deep-dive: browse grid → open post → browse → back.
 */
function getExploreActions(state, sessionMinutes) {
  const actions = [];
  state.exploreCount++;

  // Scroll the explore grid
  actions.push({
    key: 'scrollExplore',
    action: IG_ACTIONS.scrollExplore,
    waitMs: random(EXPLORE_VIEWING_DURATIONS.browse.min, EXPLORE_VIEWING_DURATIONS.browse.max),
  });

  // Open a grid item (60% chance per scroll)
  if (Math.random() < 0.60) {
    actions.push({
      key: 'tapGridItem',
      action: IG_ACTIONS.tapGridItem,
      waitMs: random(EXPLORE_VIEWING_DURATIONS.deepDive.min, EXPLORE_VIEWING_DURATIONS.deepDive.max),
    });

    // Possibly like the explore post
    if (Math.random() < 0.20) {
      actions.push({
        key: 'likePost',
        action: IG_ACTIONS.likePost,
        waitMs: random(1000, 2000),
      });
      state.totalLikes++;
    }

    // Go back to explore grid
    actions.push({
      key: 'goBack',
      action: IG_ACTIONS.goBack,
      waitMs: random(1000, 2000),
    });
  }

  return { actions, state };
}

/**
 * Feed scrolling with occasional engagement.
 */
function getFeedActions(state, sessionMinutes) {
  const actions = [];

  // Scroll feed
  actions.push({
    key: 'swipeNext',
    action: IG_ACTIONS.swipeNext,
    waitMs: random(4000, 12000),  // Feed scroll is slower, more reading
  });

  // Like feed post (15% chance)
  if (Math.random() < 0.15) {
    actions.push({
      key: 'likePost',
      action: IG_ACTIONS.likePost,
      waitMs: random(800, 1500),
    });
    state.totalLikes++;
  }

  return { actions, state };
}

/**
 * DM check — navigate to inbox, pause, go back.
 */
function getDMActions(state, sessionMinutes) {
  state.dmChecks++;
  const actions = [];

  // Already navigated to DMs via switchSurface
  // Just pause as if reading, then go back
  actions.push({
    key: 'goBack',
    action: IG_ACTIONS.goBack,
    waitMs: random(3000, 8000),   // Pause in DM inbox
  });

  // Force surface switch on next call
  state.surfaceSwipesRemaining = 0;

  return { actions, state };
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  PLATFORM_ID: 'instagram',
  ACTIONS: IG_ACTIONS,
  REEL_VIEWING_DURATIONS,
  REEL_INTERACTION_RULES,
  SURFACE_WEIGHTS,
  createSessionState,
  getNextActions,
};
