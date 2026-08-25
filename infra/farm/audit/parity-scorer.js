#!/usr/bin/env node
/**
 * 🎯 OCTAGON PARITY SCORER
 *
 * Computes a 0-100 "Humanity Score" per device by analyzing
 * the session_log table for behavioral fingerprint patterns.
 *
 * Scoring Dimensions (25% each):
 *   1. Timing Entropy — Shannon entropy of inter-action intervals
 *   2. Gesture Variance — StdDev of action durations and timing patterns
 *   3. Session Pattern — Circadian compliance and session length distribution
 *   4. Behavioral Ratio — Like/save/comment ratios within platform norms
 *
 * Usage:
 *   node farm/audit/parity-scorer.js                    # Score all devices
 *   node farm/audit/parity-scorer.js --id=farm_device_1  # Score specific device
 *   node farm/audit/parity-scorer.js --json              # JSON output
 */

'use strict';

const path = require('path');
const chalk = require('chalk');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db', 'farm.db');
const args = process.argv.slice(2);
const targetId = args.find(a => a.startsWith('--id='))?.split('=')[1];
const jsonOutput = args.includes('--json');

// ─── Platform Norms ────────────────────────────────────────────────────────────
// Empirical ratios from human user studies

const PLATFORM_NORMS = {
  tiktok: {
    likeToSwipeRatio:    { min: 0.08, max: 0.22, ideal: 0.14 },
    saveToSwipeRatio:    { min: 0.02, max: 0.08, ideal: 0.04 },
    commentToSwipeRatio: { min: 0.04, max: 0.15, ideal: 0.08 },
    profileToSwipeRatio: { min: 0.02, max: 0.08, ideal: 0.04 },
    avgSessionMinutes:   { min: 8,    max: 45,   ideal: 20 },
    avgSwipeInterval:    { min: 4000, max: 18000, ideal: 8000 },
  },
  instagram: {
    likeToSwipeRatio:    { min: 0.10, max: 0.25, ideal: 0.16 },
    saveToSwipeRatio:    { min: 0.03, max: 0.10, ideal: 0.06 },
    commentToSwipeRatio: { min: 0.03, max: 0.12, ideal: 0.07 },
    profileToSwipeRatio: { min: 0.03, max: 0.10, ideal: 0.05 },
    avgSessionMinutes:   { min: 5,    max: 35,   ideal: 15 },
    avgSwipeInterval:    { min: 5000, max: 22000, ideal: 10000 },
  },
  youtube: {
    likeToSwipeRatio:    { min: 0.06, max: 0.18, ideal: 0.11 },
    saveToSwipeRatio:    { min: 0.01, max: 0.04, ideal: 0.02 },
    commentToSwipeRatio: { min: 0.04, max: 0.14, ideal: 0.08 },
    profileToSwipeRatio: { min: 0.02, max: 0.08, ideal: 0.04 },
    avgSessionMinutes:   { min: 10,   max: 50,   ideal: 25 },
    avgSwipeInterval:    { min: 6000, max: 25000, ideal: 12000 },
  },
};

// ─── Entropy ───────────────────────────────────────────────────────────────────

/**
 * Calculate Shannon entropy of a distribution (higher = more random = more human).
 * Bots produce low entropy (periodic patterns). Humans produce high entropy.
 */
function shannonEntropy(values, numBins = 20) {
  if (values.length < 5) return 0;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const bins = new Array(numBins).fill(0);

  for (const v of values) {
    const bin = Math.min(numBins - 1, Math.floor(((v - min) / range) * numBins));
    bins[bin]++;
  }

  let entropy = 0;
  const total = values.length;
  for (const count of bins) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }

  // Normalize to 0-1 (max entropy for numBins = log2(numBins))
  return entropy / Math.log2(numBins);
}

/**
 * Standard deviation
 */
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Score how well a value fits within a norm range.
 * Returns 0-100 where 100 = perfect match to ideal.
 */
function normScore(value, norm) {
  if (value < norm.min) {
    return Math.max(0, 100 - ((norm.min - value) / norm.min) * 200);
  }
  if (value > norm.max) {
    return Math.max(0, 100 - ((value - norm.max) / norm.max) * 200);
  }
  // Within range: score by proximity to ideal
  const distFromIdeal = Math.abs(value - norm.ideal);
  const maxDist = Math.max(norm.ideal - norm.min, norm.max - norm.ideal);
  return 100 - (distFromIdeal / maxDist) * 30; // Within range = always 70-100
}

// ─── Scoring Functions ─────────────────────────────────────────────────────────

/**
 * Dimension 1: Timing Entropy (25%)
 * Analyzes inter-action intervals for randomness.
 */
function scoreTimingEntropy(sessions) {
  if (sessions.length < 10) return { score: 50, detail: 'insufficient data' };

  // Calculate intervals between consecutive actions
  const intervals = [];
  for (let i = 1; i < sessions.length; i++) {
    intervals.push(sessions[i].wait_ms);
  }

  const entropy = shannonEntropy(intervals);

  // Human-like entropy is typically 0.6-0.9
  // Perfect periodicity would be ~0, pure random ~1
  let score;
  if (entropy < 0.3) score = entropy * 100;          // Too periodic = bad
  else if (entropy > 0.95) score = 85;               // Too random = slightly suspicious
  else score = 60 + (entropy - 0.3) * 60;            // Sweet spot

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    detail: `entropy=${entropy.toFixed(3)}, intervals=${intervals.length}`,
    entropy,
  };
}

/**
 * Dimension 2: Gesture Variance (25%)
 * Analyzes standard deviation of action durations per action type.
 */
function scoreGestureVariance(sessions) {
  if (sessions.length < 10) return { score: 50, detail: 'insufficient data' };

  // Group durations by action type
  const byAction = {};
  for (const s of sessions) {
    if (!byAction[s.action_key]) byAction[s.action_key] = [];
    byAction[s.action_key].push(s.wait_ms);
  }

  const variances = [];
  for (const [action, durations] of Object.entries(byAction)) {
    if (durations.length < 3) continue;
    const sd = stdDev(durations);
    const mean = durations.reduce((s, v) => s + v, 0) / durations.length;
    const cv = sd / mean; // Coefficient of variation

    // Humans have CV of 0.2-0.6 for gesture timings
    // Bots are typically < 0.1
    variances.push(cv);
  }

  if (variances.length === 0) return { score: 50, detail: 'no action types with enough data' };

  const avgCV = variances.reduce((s, v) => s + v, 0) / variances.length;

  let score;
  if (avgCV < 0.05) score = 10;               // Nearly identical = definite bot
  else if (avgCV < 0.15) score = 30 + avgCV * 200;  // Low variance
  else if (avgCV < 0.60) score = 70 + avgCV * 40;   // Human range
  else score = 90;                                    // High variance

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    detail: `avgCV=${avgCV.toFixed(3)}, actionTypes=${variances.length}`,
    avgCV,
  };
}

/**
 * Dimension 3: Session Pattern (25%)
 * Checks circadian compliance and session length distribution.
 */
function scoreSessionPattern(sessions, accountId) {
  if (sessions.length < 10) return { score: 50, detail: 'insufficient data' };

  // Extract session hours
  const hours = sessions.map(s => {
    const d = new Date(s.timestamp);
    return d.getHours();
  });

  // Check for activity during suspicious hours (1 AM - 5 AM)
  const suspiciousHours = hours.filter(h => h >= 1 && h <= 5);
  const suspiciousRatio = suspiciousHours.length / hours.length;

  // Session length check
  const sessionMinutes = sessions.map(s => s.session_minute);
  const maxSessionMin = Math.max(...sessionMinutes);
  const sessionLengthScore = maxSessionMin > 120 ? 30 :
                              maxSessionMin > 90 ? 50 :
                              maxSessionMin > 60 ? 70 :
                              maxSessionMin > 15 ? 90 : 60;

  // Penalty for overnight activity
  const circadianScore = 100 - (suspiciousRatio * 300);

  const combined = (circadianScore * 0.6 + sessionLengthScore * 0.4);

  return {
    score: Math.round(Math.min(100, Math.max(0, combined))),
    detail: `nightActivity=${(suspiciousRatio * 100).toFixed(1)}%, maxSession=${maxSessionMin.toFixed(0)}m`,
    suspiciousRatio,
    maxSessionMin,
  };
}

/**
 * Dimension 4: Behavioral Ratio (25%)
 * Compares like/save/comment ratios against platform norms.
 */
function scoreBehavioralRatio(sessions, platform) {
  const norms = PLATFORM_NORMS[platform] || PLATFORM_NORMS.tiktok;

  const totalSwipes = sessions.filter(s => s.action_key === 'swipeNext').length;
  if (totalSwipes < 5) return { score: 50, detail: 'insufficient swipes' };

  const totalLikes = sessions.filter(s => s.action_key === 'likePost').length;
  const totalSaves = sessions.filter(s => s.action_key === 'savePost').length;
  const totalComments = sessions.filter(s => s.action_key === 'openComments').length;
  const totalProfiles = sessions.filter(s => s.action_key === 'openProfile').length;

  const likeRatio = totalLikes / totalSwipes;
  const saveRatio = totalSaves / totalSwipes;
  const commentRatio = totalComments / totalSwipes;
  const profileRatio = totalProfiles / totalSwipes;

  const scores = [
    normScore(likeRatio, norms.likeToSwipeRatio),
    normScore(saveRatio, norms.saveToSwipeRatio),
    normScore(commentRatio, norms.commentToSwipeRatio),
    normScore(profileRatio, norms.profileToSwipeRatio),
  ];

  const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;

  return {
    score: Math.round(Math.min(100, Math.max(0, avgScore))),
    detail: `like=${(likeRatio * 100).toFixed(1)}% save=${(saveRatio * 100).toFixed(1)}% comment=${(commentRatio * 100).toFixed(1)}%`,
    ratios: { likeRatio, saveRatio, commentRatio, profileRatio },
  };
}

// ─── Main Scorer ───────────────────────────────────────────────────────────────

function getParityScore(db, accountId) {
  // Get recent session data (last 24h)
  const sessions = db.prepare(`
    SELECT action_key, wait_ms, swipe_count, session_minute, timestamp
    FROM session_log
    WHERE account_id = ?
      AND timestamp > datetime('now', '-24 hours')
    ORDER BY timestamp ASC
  `).all(accountId);

  // Detect platform from most recent entry or account_health
  const healthRow = db.prepare(
    'SELECT platform FROM account_health WHERE id = ?'
  ).get(accountId);
  const platform = healthRow?.platform || 'tiktok';

  if (sessions.length < 5) {
    return {
      accountId,
      platform,
      score: -1,
      breakdown: {},
      flags: ['insufficient_data'],
      detail: `Only ${sessions.length} session entries in last 24h`,
    };
  }

  // Score all 4 dimensions
  const timing = scoreTimingEntropy(sessions);
  const gesture = scoreGestureVariance(sessions);
  const session = scoreSessionPattern(sessions, accountId);
  const behavior = scoreBehavioralRatio(sessions, platform);

  // Weighted average
  const totalScore = Math.round(
    timing.score * 0.25 +
    gesture.score * 0.25 +
    session.score * 0.25 +
    behavior.score * 0.25
  );

  // Flag any dimension below 40
  const flags = [];
  if (timing.score < 40) flags.push('low_timing_entropy');
  if (gesture.score < 40) flags.push('low_gesture_variance');
  if (session.score < 40) flags.push('suspicious_session_pattern');
  if (behavior.score < 40) flags.push('abnormal_engagement_ratios');

  const result = {
    accountId,
    platform,
    score: totalScore,
    breakdown: {
      timingEntropy: timing,
      gestureVariance: gesture,
      sessionPattern: session,
      behavioralRatio: behavior,
    },
    flags,
    sessionCount: sessions.length,
  };

  // Update parity_score in DB
  try {
    db.prepare(
      'UPDATE account_health SET parity_score = ? WHERE id = ?'
    ).run(totalScore, accountId);
  } catch (e) { /* ok */ }

  return result;
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const db = new Database(DB_PATH, { readonly: false });

  // Ensure session_log exists
  try {
    db.prepare('SELECT 1 FROM session_log LIMIT 1').get();
  } catch (e) {
    console.log(chalk.yellow('No session_log table found. Run a warmup session first.'));
    db.close();
    return;
  }

  let accounts;
  if (targetId) {
    accounts = [{ id: targetId }];
  } else {
    accounts = db.prepare('SELECT DISTINCT account_id as id FROM session_log').all();
  }

  if (accounts.length === 0) {
    console.log(chalk.yellow('No session data found.'));
    db.close();
    return;
  }

  const results = [];

  for (const acc of accounts) {
    const result = getParityScore(db, acc.id);
    results.push(result);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(chalk.magenta.bold('\n🎯 OCTAGON PARITY SCORES'));
    console.log(chalk.gray('═══════════════════════════════════════════════\n'));

    for (const r of results) {
      const scoreColor = r.score >= 70 ? chalk.green :
                          r.score >= 40 ? chalk.yellow :
                          r.score >= 0 ? chalk.red : chalk.gray;

      console.log(
        `${chalk.bold(r.accountId.padEnd(30))} ` +
        `${scoreColor(r.score >= 0 ? `${r.score}/100` : 'N/A')} ` +
        `${chalk.gray(`(${r.platform})`)}`
      );

      if (r.score >= 0) {
        const b = r.breakdown;
        console.log(chalk.gray(`  Timing:   ${b.timingEntropy.score}/100 — ${b.timingEntropy.detail}`));
        console.log(chalk.gray(`  Gesture:  ${b.gestureVariance.score}/100 — ${b.gestureVariance.detail}`));
        console.log(chalk.gray(`  Session:  ${b.sessionPattern.score}/100 — ${b.sessionPattern.detail}`));
        console.log(chalk.gray(`  Behavior: ${b.behavioralRatio.score}/100 — ${b.behavioralRatio.detail}`));
      }

      if (r.flags.length > 0) {
        console.log(chalk.red(`  ⚠ Flags: ${r.flags.join(', ')}`));
      }
      console.log();
    }
  }

  db.close();
}

// Export for programmatic use + run as CLI
module.exports = { getParityScore, PLATFORM_NORMS };

if (require.main === module) {
  main();
}
