#!/bin/sh
# Copies the code 0.5.0 may change into <scratchpad>/r050/<name>/tree, since the repo has no git.
set -eu
name="${1:?usage: sh snap.sh <name>}"
repo="/Users/ford/Desktop/Thalent Ai/excp/prodeck2"
dest="/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r050/$name/tree"
if [ -e "$dest" ]; then echo "snapshot $name already at $dest, kept"; exit 0; fi
mkdir -p "$dest"
cd "$repo"
rsync -aR packages/core/src packages/core/package.json apps/desktop/src apps/desktop/scripts apps/desktop/package.json apps/desktop/electron-builder.cjs docs/specs docs/plans "$dest/"
rsync -aR --exclude 'resources/graphics/emoji/' apps/desktop/resources/graphics "$dest/"
echo "snapshot $name at $dest"
