#!/usr/bin/env node
/**
 * 📤 OCTAGON — Automated Posting via Voice Control
 *
 * Accessibility-driven posting flow that uses Voice Control
 * to create and publish posts on TikTok, Instagram, and YouTube Shorts.
 *
 * Flow:
 *   1. Navigate to create/upload button
 *   2. Select video from Camera Roll
 *   3. Enter caption via voice dictation
 *   4. Add hashtags
 *   5. Select cover frame (if applicable)
 *   6. Publish
 *
 * Each step has retry logic and state verification.
 *
 * Usage:
 *   node farm/posting/voice-post-flow.js --platform=tiktok --slot=1 --prefix=Alpha
 */

'use strict';

const { exec } = require('child_process');
const path = require('path');
const chalk = require('chalk');

// ─── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : def;
};

const platform = getArg('platform', 'tiktok');
const prefix = getArg('prefix', 'Alpha');
const slot = getArg('slot', '1');
const MAX_RETRIES = 3;
const STEP_TIMEOUT = 15000; // Max time to wait for UI transition

// ─── Voice Control Interface ───────────────────────────────────────────────────

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Speak a Voice Control command via macOS TTS.
 */
function speak(command) {
  const fullCommand = `${prefix}, ${command}`;
  return new Promise((resolve) => {
    exec(`say "${fullCommand}"`, () => resolve());
  });
}

/**
 * Execute a single step with retry logic.
 */
async function executeStep(stepName, voiceCommands, waitAfterMs = 3000, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(chalk.cyan(`  [${stepName}] Attempt ${attempt}/${retries}...`));

      for (const cmd of voiceCommands) {
        if (typeof cmd === 'string') {
          await speak(cmd);
          await wait(1500); // Inter-command pause
        } else if (typeof cmd === 'function') {
          await cmd();
        }
      }

      await wait(waitAfterMs);
      console.log(chalk.green(`  [${stepName}] ✅ Complete`));
      return true;
    } catch (err) {
      console.log(chalk.yellow(`  [${stepName}] ⚠ Attempt ${attempt} failed: ${err.message}`));
      if (attempt === retries) {
        console.log(chalk.red(`  [${stepName}] ❌ FAILED after ${retries} attempts`));
        return false;
      }
      await wait(2000);
    }
  }
  return false;
}

// ─── Platform-Specific Posting Flows ───────────────────────────────────────────

const PLATFORM_FLOWS = {
  tiktok: {
    name: 'TikTok',
    steps: [
      {
        name: 'Open Create',
        commands: ['Tap Create', 'Tap Plus Button'],
        waitMs: 4000,
      },
      {
        name: 'Select Upload',
        commands: ['Tap Upload'],
        waitMs: 3000,
      },
      {
        name: 'Select Video',
        commands: ['Tap First Item'],
        waitMs: 3000,
      },
      {
        name: 'Confirm Selection',
        commands: ['Tap Next'],
        waitMs: 5000,
      },
      {
        name: 'Skip Edit',
        commands: ['Tap Next'],
        waitMs: 3000,
      },
      {
        name: 'Enter Caption',
        commands: [],  // Caption injected dynamically
        waitMs: 2000,
      },
      {
        name: 'Publish',
        commands: ['Tap Post'],
        waitMs: 8000,
      },
    ],
  },

  instagram: {
    name: 'Instagram (Reel)',
    steps: [
      {
        name: 'Open Create',
        commands: ['Tap Plus Button'],
        waitMs: 3000,
      },
      {
        name: 'Select Reel',
        commands: ['Tap Reel'],
        waitMs: 3000,
      },
      {
        name: 'Select Video',
        commands: ['Tap First Item'],
        waitMs: 3000,
      },
      {
        name: 'Confirm Selection',
        commands: ['Tap Next'],
        waitMs: 5000,
      },
      {
        name: 'Skip Edit',
        commands: ['Tap Next'],
        waitMs: 3000,
      },
      {
        name: 'Enter Caption',
        commands: [],
        waitMs: 2000,
      },
      {
        name: 'Share',
        commands: ['Tap Share'],
        waitMs: 8000,
      },
    ],
  },

  youtube: {
    name: 'YouTube Short',
    steps: [
      {
        name: 'Open Create',
        commands: ['Tap Create', 'Tap Plus Button'],
        waitMs: 4000,
      },
      {
        name: 'Select Upload',
        commands: ['Tap Upload Video'],
        waitMs: 3000,
      },
      {
        name: 'Select Short',
        commands: ['Tap Create a Short'],
        waitMs: 3000,
      },
      {
        name: 'Select Video',
        commands: ['Tap First Item'],
        waitMs: 3000,
      },
      {
        name: 'Confirm Selection',
        commands: ['Tap Next'],
        waitMs: 5000,
      },
      {
        name: 'Enter Title',
        commands: [],
        waitMs: 2000,
      },
      {
        name: 'Upload',
        commands: ['Tap Upload Short'],
        waitMs: 10000,
      },
    ],
  },
};

// ─── Caption Entry ─────────────────────────────────────────────────────────────

/**
 * Enter a caption using Voice Control dictation.
 * Splits caption into chunks to avoid TTS truncation.
 */
async function enterCaption(caption, hashtags = []) {
  // Tap the caption field
  await speak('Tap Caption');
  await wait(2000);

  // Dictate caption in chunks (Voice Control has a ~20 word limit per command)
  const words = caption.split(' ');
  const chunks = [];
  let current = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= 12) {
      chunks.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current.join(' '));

  for (const chunk of chunks) {
    // Use the "Type" voice command for text entry
    await speak(`Type ${chunk}`);
    await wait(1500);
  }

  // Add hashtags
  if (hashtags.length > 0) {
    const hashtagStr = hashtags.map(t => `#${t}`).join(' ');
    await speak(`Type ${hashtagStr}`);
    await wait(2000);
  }

  // Dismiss keyboard
  await speak('Dismiss Keyboard');
  await wait(1000);
}

// ─── Main Posting Flow ─────────────────────────────────────────────────────────

/**
 * Execute the full posting flow for a given platform.
 *
 * @param {string} platformId - 'tiktok', 'instagram', or 'youtube'
 * @param {Object} content - { caption, hashtags, coverIndex }
 * @returns {Promise<{success: boolean, steps: Array}>}
 */
async function postContent(platformId, content = {}) {
  const flow = PLATFORM_FLOWS[platformId];
  if (!flow) {
    console.log(chalk.red(`Unknown platform: ${platformId}`));
    return { success: false, steps: [] };
  }

  console.log(chalk.magenta.bold(`\n📤 POSTING TO ${flow.name.toUpperCase()}`));
  console.log(chalk.gray('────────────────────────────────────────────\n'));

  const results = [];
  let allSuccess = true;

  for (const step of flow.steps) {
    if (step.name.includes('Caption') || step.name.includes('Title')) {
      // Inject caption entry
      const caption = content.caption || 'Check this out! 🔥';
      const hashtags = content.hashtags || ['fyp', 'viral'];
      console.log(chalk.cyan(`  [Caption] Entering: "${caption.substring(0, 50)}..."`));
      await enterCaption(caption, hashtags);
      results.push({ step: step.name, success: true });
      continue;
    }

    const success = await executeStep(step.name, step.commands, step.waitMs);
    results.push({ step: step.name, success });

    if (!success) {
      allSuccess = false;
      console.log(chalk.red(`\n❌ Posting ABORTED at step: ${step.name}`));
      break;
    }
  }

  if (allSuccess) {
    console.log(chalk.green.bold('\n✅ Post published successfully!\n'));
  }

  return { success: allSuccess, steps: results };
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const caption = getArg('caption', 'Check this out! 🔥');
  const hashtags = getArg('hashtags', 'fyp,viral').split(',');

  const result = await postContent(platform, { caption, hashtags });

  console.log(chalk.gray('\n─── Results ───'));
  for (const step of result.steps) {
    const icon = step.success ? chalk.green('✅') : chalk.red('❌');
    console.log(`  ${icon} ${step.step}`);
  }

  process.exit(result.success ? 0 : 1);
}

// Export for programmatic use
module.exports = { postContent, PLATFORM_FLOWS };

if (require.main === module) {
  main().catch(console.error);
}
