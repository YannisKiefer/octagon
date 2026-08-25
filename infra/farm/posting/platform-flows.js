/**
 * 📋 OCTAGON — Per-Platform Posting Sequences
 *
 * Defines the exact Voice Control command sequences for each platform's
 * posting flow. Used by voice-post-flow.js to execute platform-specific
 * navigation paths.
 *
 * Each flow maps UI elements to voice commands and provides:
 *   - Button labels (what Voice Control needs to hear)
 *   - Wait times per transition (for UI loading)
 *   - Alternative commands (fallback if primary label fails)
 *   - State assertions (expected screen state after each step)
 */

'use strict';

// ─── TikTok Posting Flow ───────────────────────────────────────────────────────

const TIKTOK_FLOW = {
  platformId: 'tiktok',
  name: 'TikTok Post',

  steps: [
    {
      id: 'open_create',
      name: 'Open Create Screen',
      primary: ['Tap Plus Button'],
      fallback: ['Tap Create', 'Tap Add'],
      waitMs: 4000,
      expectedState: 'camera_or_upload_screen',
    },
    {
      id: 'select_upload',
      name: 'Select Upload Mode',
      primary: ['Tap Upload'],
      fallback: ['Tap Gallery'],
      waitMs: 3000,
      expectedState: 'gallery_picker',
    },
    {
      id: 'select_video',
      name: 'Select Video from Gallery',
      primary: ['Tap First Item'],
      fallback: ['Tap Recent Video'],
      waitMs: 3000,
      expectedState: 'video_selected',
    },
    {
      id: 'confirm_clip',
      name: 'Confirm Clip Selection',
      primary: ['Tap Next'],
      fallback: ['Tap Continue'],
      waitMs: 5000,
      expectedState: 'edit_screen',
    },
    {
      id: 'skip_edit',
      name: 'Skip Editing',
      primary: ['Tap Next'],
      fallback: ['Tap Skip'],
      waitMs: 3000,
      expectedState: 'post_details_screen',
    },
    {
      id: 'enter_caption',
      name: 'Enter Caption',
      type: 'caption_entry',
      primary: ['Tap Add Description', 'Tap Caption'],
      waitMs: 2000,
      expectedState: 'keyboard_open',
    },
    {
      id: 'set_cover',
      name: 'Select Cover',
      primary: ['Tap Select Cover'],
      fallback: [],
      waitMs: 4000,
      expectedState: 'cover_selector',
      optional: true,   // Can skip if not needed
    },
    {
      id: 'confirm_cover',
      name: 'Confirm Cover Selection',
      primary: ['Tap Save'],
      fallback: ['Tap Done'],
      waitMs: 2000,
      expectedState: 'post_details_screen',
      optional: true,
    },
    {
      id: 'publish',
      name: 'Publish Post',
      primary: ['Tap Post'],
      fallback: ['Tap Publish'],
      waitMs: 10000,
      expectedState: 'profile_or_feed',
    },
  ],

  captionConfig: {
    maxLength: 2200,
    hashtagPrefix: '#',
    mentionPrefix: '@',
    allowEmoji: true,
  },
};

// ─── Instagram Reel Flow ───────────────────────────────────────────────────────

const INSTAGRAM_REEL_FLOW = {
  platformId: 'instagram',
  name: 'Instagram Reel',

  steps: [
    {
      id: 'open_create',
      name: 'Open Create Screen',
      primary: ['Tap Plus Button'],
      fallback: ['Tap Create', 'Tap New Post'],
      waitMs: 3000,
      expectedState: 'content_type_selector',
    },
    {
      id: 'select_reel',
      name: 'Select Reel Type',
      primary: ['Tap Reel'],
      fallback: ['Tap Reels'],
      waitMs: 3000,
      expectedState: 'reel_camera_or_gallery',
    },
    {
      id: 'open_gallery',
      name: 'Open Gallery',
      primary: ['Tap Gallery'],
      fallback: ['Tap Camera Roll'],
      waitMs: 2000,
      expectedState: 'gallery_picker',
    },
    {
      id: 'select_video',
      name: 'Select Video',
      primary: ['Tap First Item'],
      fallback: ['Tap Recent'],
      waitMs: 3000,
      expectedState: 'video_selected',
    },
    {
      id: 'confirm_selection',
      name: 'Confirm Selection',
      primary: ['Tap Add'],
      fallback: ['Tap Next'],
      waitMs: 4000,
      expectedState: 'edit_reel_screen',
    },
    {
      id: 'skip_edit',
      name: 'Skip Editing',
      primary: ['Tap Next'],
      fallback: ['Tap Preview'],
      waitMs: 3000,
      expectedState: 'share_screen',
    },
    {
      id: 'enter_caption',
      name: 'Enter Caption',
      type: 'caption_entry',
      primary: ['Tap Write a Caption'],
      waitMs: 2000,
      expectedState: 'keyboard_open',
    },
    {
      id: 'share',
      name: 'Share Reel',
      primary: ['Tap Share'],
      fallback: ['Tap Share Reel'],
      waitMs: 8000,
      expectedState: 'profile_or_feed',
    },
  ],

  captionConfig: {
    maxLength: 2200,
    hashtagPrefix: '#',
    mentionPrefix: '@',
    allowEmoji: true,
  },
};

// ─── Instagram Feed Post Flow ──────────────────────────────────────────────────

const INSTAGRAM_FEED_FLOW = {
  platformId: 'instagram',
  name: 'Instagram Feed Post',

  steps: [
    {
      id: 'open_create',
      name: 'Open Create Screen',
      primary: ['Tap Plus Button'],
      fallback: ['Tap Create'],
      waitMs: 3000,
      expectedState: 'content_type_selector',
    },
    {
      id: 'select_post',
      name: 'Select Post Type',
      primary: ['Tap Post'],
      fallback: ['Tap Feed Post'],
      waitMs: 2000,
      expectedState: 'gallery_picker',
    },
    {
      id: 'select_media',
      name: 'Select Media',
      primary: ['Tap First Item'],
      waitMs: 3000,
      expectedState: 'media_selected',
    },
    {
      id: 'confirm',
      name: 'Confirm Selection',
      primary: ['Tap Next'],
      waitMs: 4000,
      expectedState: 'filter_screen',
    },
    {
      id: 'skip_filter',
      name: 'Skip Filter',
      primary: ['Tap Next'],
      waitMs: 3000,
      expectedState: 'share_screen',
    },
    {
      id: 'enter_caption',
      name: 'Enter Caption',
      type: 'caption_entry',
      primary: ['Tap Write a Caption'],
      waitMs: 2000,
      expectedState: 'keyboard_open',
    },
    {
      id: 'share',
      name: 'Share Post',
      primary: ['Tap Share'],
      waitMs: 8000,
      expectedState: 'profile_or_feed',
    },
  ],

  captionConfig: {
    maxLength: 2200,
    hashtagPrefix: '#',
    mentionPrefix: '@',
    allowEmoji: true,
  },
};

// ─── YouTube Short Flow ────────────────────────────────────────────────────────

const YOUTUBE_SHORT_FLOW = {
  platformId: 'youtube',
  name: 'YouTube Short',

  steps: [
    {
      id: 'open_create',
      name: 'Open Create Menu',
      primary: ['Tap Plus Button'],
      fallback: ['Tap Create'],
      waitMs: 4000,
      expectedState: 'create_menu',
    },
    {
      id: 'select_upload',
      name: 'Select Upload',
      primary: ['Tap Upload a Video'],
      fallback: ['Tap Upload Video'],
      waitMs: 3000,
      expectedState: 'gallery_picker',
    },
    {
      id: 'select_video',
      name: 'Select Video',
      primary: ['Tap First Item'],
      waitMs: 3000,
      expectedState: 'video_selected',
    },
    {
      id: 'create_short',
      name: 'Create as Short',
      primary: ['Tap Create a Short'],
      fallback: ['Tap Short'],
      waitMs: 4000,
      expectedState: 'trim_screen',
    },
    {
      id: 'confirm_trim',
      name: 'Confirm Trim',
      primary: ['Tap Next'],
      waitMs: 3000,
      expectedState: 'details_screen',
    },
    {
      id: 'enter_title',
      name: 'Enter Title',
      type: 'caption_entry',
      primary: ['Tap Add a Title'],
      fallback: ['Tap Title'],
      waitMs: 2000,
      expectedState: 'keyboard_open',
    },
    {
      id: 'enter_description',
      name: 'Enter Description',
      type: 'caption_entry',
      primary: ['Tap Add a Description'],
      fallback: ['Tap Description'],
      waitMs: 2000,
      expectedState: 'keyboard_open',
      optional: true,
    },
    {
      id: 'set_visibility',
      name: 'Set Visibility',
      primary: ['Tap Public'],
      fallback: [],
      waitMs: 2000,
      expectedState: 'visibility_set',
      optional: true,
    },
    {
      id: 'upload',
      name: 'Upload Short',
      primary: ['Tap Upload Short'],
      fallback: ['Tap Upload', 'Tap Publish'],
      waitMs: 12000,
      expectedState: 'upload_complete',
    },
  ],

  captionConfig: {
    maxLength: 100,      // Shorts titles are short
    hashtagPrefix: '#',
    mentionPrefix: '@',
    allowEmoji: true,
  },
};

// ─── Flow Registry ─────────────────────────────────────────────────────────────

const FLOWS = {
  tiktok: TIKTOK_FLOW,
  instagram_reel: INSTAGRAM_REEL_FLOW,
  instagram_feed: INSTAGRAM_FEED_FLOW,
  instagram: INSTAGRAM_REEL_FLOW,     // Default IG flow = Reel
  youtube: YOUTUBE_SHORT_FLOW,
};

/**
 * Get the posting flow for a given platform.
 * @param {string} platformId - 'tiktok', 'instagram', 'instagram_reel', 'instagram_feed', 'youtube'
 * @returns {Object} The flow definition
 */
function getFlow(platformId) {
  const flow = FLOWS[platformId];
  if (!flow) {
    throw new Error(`Unknown platform: ${platformId}. Available: ${Object.keys(FLOWS).join(', ')}`);
  }
  return flow;
}

/**
 * Get all available flows.
 */
function listFlows() {
  return Object.entries(FLOWS).map(([id, flow]) => ({
    id,
    name: flow.name,
    steps: flow.steps.length,
  }));
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  TIKTOK_FLOW,
  INSTAGRAM_REEL_FLOW,
  INSTAGRAM_FEED_FLOW,
  YOUTUBE_SHORT_FLOW,
  FLOWS,
  getFlow,
  listFlows,
};
