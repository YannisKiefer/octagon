#!/usr/bin/env bash
# run-whop-daily.sh — Daily Whop pipeline: scout -> joiner -> DM sender
# Schedule via LaunchAgent or cron (runs 2x/day)

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/src"
DATA="$DIR/data"
LOG="$DATA/whop_daily_$(date +%Y-%m-%d_%H%M).log"
PYTHON=python3

mkdir -p "$DATA"

echo "=== Whop Daily Pipeline — $(date) ===" | tee "$LOG"

# Step 1: Scout — discover new communities via GraphQL
echo "[1/3] Running scout..." | tee -a "$LOG"
$PYTHON "$SRC/whop-scout.py" --limit 50 >> "$LOG" 2>&1 || true

# Step 2: Joiner — join free communities for profile presence
echo "[2/3] Running joiner..." | tee -a "$LOG"
$PYTHON "$SRC/whop-joiner.py" >> "$LOG" 2>&1 || true

# Step 3: DM sender — send DMs to community owners
echo "[3/3] Running DM sender..." | tee -a "$LOG"
$PYTHON "$SRC/whop-dm-auto.py" >> "$LOG" 2>&1 || true

echo "=== Done — $(date) ===" | tee -a "$LOG"
