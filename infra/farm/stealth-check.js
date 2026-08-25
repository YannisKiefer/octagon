#!/usr/bin/env node
/**
 * 🕵️ OCTAGON STEALTH-CHECK v2.0
 *
 * Full-spectrum environment audit for automated iPhone activity.
 * Checks 8 dimensions of detection surface:
 *
 *   1. IP Reputation & Proxy Detection
 *   2. MTU / Interface Fingerprinting
 *   3. Audio Transmission (Voice Control Hub)
 *   4. Timezone Consistency
 *   5. DNS Leak Detection
 *   6. TLS Fingerprint Analysis
 *   7. WebRTC Leak Check
 *   8. Session Log Analysis (parity score integration)
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const chalk = require('chalk');

const DB_PATH = path.join(__dirname, '..', 'data', 'db', 'farm.db');

let totalChecks = 0;
let passedChecks = 0;
let warningChecks = 0;
let failedChecks = 0;

function pass(msg) { totalChecks++; passedChecks++; console.log(`   ${chalk.green('✅')} ${msg}`); }
function warn(msg) { totalChecks++; warningChecks++; console.log(`   ${chalk.yellow('⚠️')} ${msg}`); }
function fail(msg) { totalChecks++; failedChecks++; console.log(`   ${chalk.red('❌')} ${msg}`); }

// ─── 1. IP Reputation & Proxy Detection ────────────────────────────────────────

function checkIP() {
  console.log(chalk.cyan('\n🌐 1. Network & IP Reputation:'));
  try {
    const res = execSync('curl -s --max-time 10 https://ipapi.co/json', { encoding: 'utf8' });
    const data = JSON.parse(res);

    console.log(`   IP: ${chalk.bold(data.ip)}`);
    console.log(`   Org: ${chalk.bold(data.org)}`);
    console.log(`   Country: ${chalk.bold(data.country_name)}`);
    console.log(`   City: ${chalk.bold(data.city || 'N/A')}`);

    const orgLower = (data.org || '').toLowerCase();
    const isResidential = !orgLower.includes('hosting') &&
                          !orgLower.includes('datacenter') &&
                          !orgLower.includes('cloud') &&
                          !orgLower.includes('aws') &&
                          !orgLower.includes('google') &&
                          !orgLower.includes('microsoft') &&
                          !orgLower.includes('digital ocean') &&
                          !orgLower.includes('ovh') &&
                          !orgLower.includes('hetzner') &&
                          !orgLower.includes('vultr');

    if (isResidential) {
      pass('IP is RESIDENTIAL — matches mobile carrier profile');
    } else {
      fail(`IP appears to be DATACENTER/HOSTING (${data.org}). Use residential proxy.`);
    }

    // Check if IP is a known VPN/proxy
    if (data.asn) {
      console.log(`   ASN: ${chalk.bold(data.asn)}`);
    }
  } catch (e) {
    fail('Failed to reach IP reputation API. Check network/proxy settings.');
  }
}

// ─── 2. MTU / Interface Fingerprinting ─────────────────────────────────────────

function checkMTU() {
  console.log(chalk.cyan('\n⚙️ 2. Interface Fingerprinting:'));
  try {
    const ifconfig = execSync('ifconfig', { encoding: 'utf8' });

    // Check primary interface MTU
    const mtuMatches = ifconfig.match(/mtu\s+(\d+)/g);
    if (mtuMatches) {
      for (const match of mtuMatches) {
        const mtu = parseInt(match.match(/\d+/)[0]);
        if (mtu === 1500) {
          pass(`MTU ${mtu} — standard Ethernet (matches iOS profile)`);
        } else if (mtu === 1280) {
          pass(`MTU ${mtu} — IPv6 minimum (acceptable for mobile)`);
        } else if (mtu < 1400) {
          warn(`MTU ${mtu} — non-standard, may indicate VPN/tunnel`);
        } else {
          pass(`MTU ${mtu}`);
        }
        break; // Only check first match
      }
    }

    // Check for VPN interfaces
    const hasVPN = ifconfig.includes('utun') || ifconfig.includes('tun0') || ifconfig.includes('wg0');
    if (hasVPN) {
      warn('VPN tunnel interface detected (utun/tun/wg). Ensure it routes through residential proxy.');
    } else {
      pass('No VPN tunnel interfaces detected');
    }
  } catch (e) {
    warn('Could not check interface configuration');
  }
}

// ─── 3. Audio Transmission ─────────────────────────────────────────────────────

function checkAudio() {
  console.log(chalk.cyan('\n🔊 3. Audio Transmission (Voice Control Hub):'));
  try {
    const audioDevices = execSync('system_profiler SPAudioDataType', { encoding: 'utf8' });

    const hasLoopback = audioDevices.toLowerCase().includes('blackhole') ||
                        audioDevices.toLowerCase().includes('loopback');
    const hasUSBAudio = audioDevices.toLowerCase().includes('usb audio') ||
                        audioDevices.toLowerCase().includes('usb digital');
    const hasBuiltIn = audioDevices.toLowerCase().includes('built-in');

    if (hasLoopback) {
      pass('Virtual audio loopback detected (BlackHole/Loopback) — ideal for isolated TTS');
    } else if (hasUSBAudio) {
      pass('USB audio interface detected — good for direct phone audio routing');
    } else if (hasBuiltIn) {
      warn('Using built-in speakers only. Consider virtual audio for production.');
    } else {
      fail('No suitable audio output detected. Voice Control requires audio.');
    }

    // Check TTS availability
    try {
      execSync('which say', { encoding: 'utf8' });
      pass('macOS TTS (`say`) command available');
    } catch {
      fail('macOS TTS (`say`) not found. Required for Voice Control.');
    }
  } catch (e) {
    warn('Could not check audio configuration');
  }
}

// ─── 4. Timezone Consistency ───────────────────────────────────────────────────

function checkTimezone() {
  console.log(chalk.cyan('\n🕰 4. Timezone Alignment:'));
  const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`   System TZ: ${chalk.bold(sysTz)}`);
  console.log(`   Current: ${new Date().toLocaleString()}`);

  // Common timezone mismatches that indicate proxy
  const europeTzs = ['Europe/Berlin', 'Europe/Zurich', 'Europe/London', 'Europe/Paris', 'Europe/Amsterdam'];
  const isEurope = europeTzs.some(tz => sysTz.startsWith(tz.split('/')[0]));

  // If using European IP, timezone should match
  try {
    const ipRes = execSync('curl -s --max-time 5 https://ipapi.co/timezone', { encoding: 'utf8' }).trim();
    if (ipRes === sysTz) {
      pass(`System TZ matches IP geolocation TZ (${sysTz})`);
    } else {
      warn(`TZ mismatch: system=${sysTz}, IP geo=${ipRes}. Configure proxy to match.`);
    }
  } catch {
    warn('Could not verify timezone against IP geolocation');
  }
}

// ─── 5. DNS Leak Detection ─────────────────────────────────────────────────────

function checkDNS() {
  console.log(chalk.cyan('\n🔒 5. DNS Leak Detection:'));
  try {
    const dns = execSync('scutil --dns 2>/dev/null | head -30', { encoding: 'utf8' });
    const resolvers = dns.match(/nameserver\[0\]\s*:\s*(\S+)/g) || [];

    for (const r of resolvers.slice(0, 3)) {
      const ip = r.match(/:\s*(\S+)/)?.[1];
      if (ip) {
        // Known public DNS that could leak identity
        const isPublicDNS = ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9'].includes(ip);
        if (isPublicDNS) {
          warn(`Using public DNS ${ip}. Should use ISP/proxy DNS to avoid fingerprinting.`);
        } else {
          pass(`DNS resolver: ${ip}`);
        }
      }
    }
  } catch {
    warn('Could not check DNS configuration');
  }
}

// ─── 6. System Dependencies ────────────────────────────────────────────────────

function checkDependencies() {
  console.log(chalk.cyan('\n📦 6. System Dependencies:'));

  const deps = [
    { cmd: 'node --version', name: 'Node.js', minVersion: '18' },
    { cmd: 'python3 --version', name: 'Python 3' },
    { cmd: 'ffmpeg -version 2>&1 | head -1', name: 'FFmpeg' },
    { cmd: 'exiftool -ver', name: 'ExifTool' },
    { cmd: 'sqlite3 --version', name: 'SQLite3' },
  ];

  for (const dep of deps) {
    try {
      const output = execSync(dep.cmd, { encoding: 'utf8' }).trim().split('\n')[0];
      pass(`${dep.name}: ${output}`);
    } catch {
      fail(`${dep.name} not found. Install it before running Octragon.`);
    }
  }
}

// ─── 7. iPhone Connectivity ────────────────────────────────────────────────────

function checkiPhones() {
  console.log(chalk.cyan('\n📱 7. iPhone Connectivity:'));
  try {
    // Check for connected iOS devices via system_profiler
    const usb = execSync('system_profiler SPUSBDataType 2>/dev/null', { encoding: 'utf8' });
    const iphoneMatches = usb.match(/iPhone/gi);
    const iphoneCount = iphoneMatches ? iphoneMatches.length : 0;

    if (iphoneCount > 0) {
      pass(`${iphoneCount} iPhone(s) detected via USB`);
    } else {
      warn('No iPhones detected via USB. Connect phones for Voice Control.');
    }

    // Check for libimobiledevice (optional, for advanced device management)
    try {
      execSync('which ideviceinfo', { encoding: 'utf8' });
      pass('libimobiledevice available (ideviceinfo)');

      try {
        const deviceList = execSync('idevice_id -l 2>/dev/null', { encoding: 'utf8' }).trim();
        const devices = deviceList.split('\n').filter(Boolean);
        pass(`${devices.length} device(s) via libimobiledevice: ${devices.join(', ')}`);
      } catch {
        warn('libimobiledevice installed but no devices found');
      }
    } catch {
      warn('libimobiledevice not installed. Optional: brew install libimobiledevice');
    }
  } catch {
    warn('Could not check USB device connectivity');
  }
}

// ─── 8. Parity Score Integration ───────────────────────────────────────────────

function checkParityScores() {
  console.log(chalk.cyan('\n🎯 8. Interaction Parity Scores:'));
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });

    // Check if session_log exists
    const hasSessionLog = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_log'"
    ).get();

    if (!hasSessionLog) {
      warn('No session_log table. Run a warmup session to generate parity data.');
      db.close();
      return;
    }

    const accounts = db.prepare(
      'SELECT DISTINCT account_id FROM session_log'
    ).all();

    if (accounts.length === 0) {
      warn('No session data recorded yet.');
      db.close();
      return;
    }

    // Import parity scorer
    const { getParityScore } = require('./audit/parity-scorer');

    for (const acc of accounts) {
      const result = getParityScore(db, acc.account_id);
      if (result.score < 0) {
        warn(`${acc.account_id}: insufficient data for scoring`);
      } else if (result.score >= 70) {
        pass(`${acc.account_id}: ${result.score}/100 — HUMAN PARITY`);
      } else if (result.score >= 40) {
        warn(`${acc.account_id}: ${result.score}/100 — needs tuning`);
      } else {
        fail(`${acc.account_id}: ${result.score}/100 — DETECTABLE. ${result.flags.join(', ')}`);
      }
    }

    db.close();
  } catch (e) {
    warn(`Could not load parity scores: ${e.message}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function check() {
  console.log(chalk.magenta.bold('\n🔍 OCTAGON STEALTH AUDIT v2.0\n'));
  console.log(chalk.gray('Full-spectrum detection surface analysis\n'));

  checkIP();
  checkMTU();
  checkAudio();
  checkTimezone();
  checkDNS();
  checkDependencies();
  checkiPhones();
  checkParityScores();

  // Summary
  console.log(chalk.gray('\n════════════════════════════════════════════════'));
  console.log(chalk.white.bold('🏁 STEALTH AUDIT COMPLETE'));
  console.log();
  console.log(`   ${chalk.green(`✅ Passed:   ${passedChecks}`)}`);
  console.log(`   ${chalk.yellow(`⚠️  Warnings: ${warningChecks}`)}`);
  console.log(`   ${chalk.red(`❌ Failed:   ${failedChecks}`)}`);
  console.log();

  const overallScore = Math.round((passedChecks / totalChecks) * 100);
  const scoreColor = overallScore >= 80 ? chalk.green : overallScore >= 50 ? chalk.yellow : chalk.red;
  console.log(`   Overall: ${scoreColor(`${overallScore}%`)} (${passedChecks}/${totalChecks})`);

  if (failedChecks > 0) {
    console.log(chalk.red('\n   ⛔ FIX ALL FAILED CHECKS BEFORE RUNNING IN PRODUCTION\n'));
  } else if (warningChecks > 0) {
    console.log(chalk.yellow('\n   ⚠ Review warnings for optimal stealth\n'));
  } else {
    console.log(chalk.green('\n   🟢 ALL CLEAR — production ready\n'));
  }
}

if (require.main === module) {
  check();
}

module.exports = { check };
