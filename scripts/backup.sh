#!/usr/bin/env bash
# Squad Squadra Trips Backup — sync trips/ to Google Drive via rclone
#
# Prerequisites:
#   brew install rclone
#   rclone config  →  create remote named "gdrive" (Google Drive)
#
# Usage:
#   ./scripts/backup.sh          # normal sync
#   ./scripts/backup.sh --dry-run  # preview without changes
#
# Runs daily at 14:00 via launchd (com.squadra.trips-backup.plist)

set -euo pipefail

TRIPS_DIR="$HOME/Squad Squadra/trips"
REMOTE="gdrive:squadra-trips"
LOG_FILE="$HOME/.local/share/squadra/backup.log"

mkdir -p "$(dirname "$LOG_FILE")"

EXTRA_FLAGS=("$@")

echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting Squad Squadra trips backup" | tee -a "$LOG_FILE"

# Generate HTML versions of all markdown files for mobile viewing
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "$(date '+%Y-%m-%d %H:%M:%S') — Generating HTML from markdown..." | tee -a "$LOG_FILE"
cd "$SCRIPT_DIR" && node --import tsx/esm src/scripts/export-html.ts 2>&1 | tee -a "$LOG_FILE"

/usr/local/bin/rclone sync "$TRIPS_DIR" "$REMOTE" \
  --exclude ".DS_Store" \
  --exclude ".obsidian/**" \
  --log-file "$LOG_FILE" \
  --log-level INFO \
  --stats-one-line \
  "${EXTRA_FLAGS[@]+"${EXTRA_FLAGS[@]}"}"

# Remove local HTML files — they only need to live in Drive
find "$TRIPS_DIR" -name "itinerary-html" -type d -exec rm -rf {} + 2>/dev/null || true

echo "$(date '+%Y-%m-%d %H:%M:%S') — Backup complete" | tee -a "$LOG_FILE"
