#!/bin/bash
# Logs one Claude Code call of the test app (its arguments, the system prompt and what it is sent) under live/calls,
# then becomes the real Claude Code, so that a stop sent by the app reaches it as it would without this script.
L=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/live/calls
n=$(date +%H%M%S)-$$
printf '%s\n' "$@" > "$L/$n.args"
prev=""
for a in "$@"; do
  if [ "$prev" = "--system-prompt-file" ]; then cp "$a" "$L/$n.system.txt"; fi
  prev="$a"
done
cat > "$L/$n.stdin"
date +%H:%M:%S > "$L/$n.started"
exec /opt/homebrew/bin/claude "$@" < "$L/$n.stdin"
