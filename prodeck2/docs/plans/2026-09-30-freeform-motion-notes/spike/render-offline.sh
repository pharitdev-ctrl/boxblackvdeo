#!/bin/sh
# sh render.sh <compositionDir> <out.mov> [fps]   — runs the app's renderer pack the way the app does (no network tools on PATH)
set -eu
S=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad
P=$S/r044/profile/hyperframes/2026-09-24
R="/Users/ford/Desktop/Thalent Ai/excp/prodeck2/apps/desktop/resources/bin"
H=$S/mg/home
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
printf '{"lastUpdateCheck":"%s","latestVersion":"0.8.65","lastSkillsCheck":"%s"}' "$NOW" "$NOW" > $H/.hyperframes/config.json
env -i HOME=$H TMPDIR=$H/tmp XDG_STATE_HOME=$H/.state PATH=$S/mg/bin \
  HYPERFRAMES_FFMPEG_PATH="$R/ffmpeg" HYPERFRAMES_FFPROBE_PATH="$R/ffprobe" HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 \
  HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1 \
  HYPERFRAMES_BROWSER_PATH="/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/mg/chrome-offline.sh" \
  HYPERFRAMES_FONT_CACHE_DIR=$H/fonts LANG=en_US.UTF-8 \
  "$P/node/bin/node" "$P/node_modules/hyperframes/bin/hyperframes.mjs" render "$1" --format mov --fps "${3:-30}" --workers 2 --quiet --frames-cache-dir off --player-ready-timeout 20000 -o "$2"
