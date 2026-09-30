#!/bin/sh
# sh try.sh <id> <W> <H> <D> : lint, wrap, render, and make a contact sheet of 8 frames
set -u
S=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad
cd $S/mg
id=$1; W=$2; H=$3; D=$4
F="/Users/ford/Desktop/Thalent Ai/excp/prodeck2/apps/desktop/resources/bin/ffmpeg"
echo "== $id: $(wc -l < w/$id.html) lines, $(wc -c < w/$id.html) bytes"
grep -nE "requestAnimationFrame|setTimeout|setInterval|Date\.|performance\.now|Math\.random|https?://|<img|<link|@import|fetch\(|XMLHttpRequest|WebSocket|infinite" w/$id.html | cut -c1-120 | sed 's/^/   lint: /'
HOME_REAL=$HOME node mk.mjs w/$id.html $S/mg/c-$id $W $H $D 30 "${5:-[]}" >/dev/null
start=$(date +%s)
sh render.sh $S/mg/c-$id $S/mg/o-$id.mov > log-$id.txt 2>&1; code=$?
echo "   render exit $code in $(( $(date +%s) - start )) s, $(ls -la o-$id.mov 2>/dev/null | awk '{print int($5/1048576)" MB"}')"
grep -iE "error|warn|exception|failed" log-$id.txt | grep -v "static-frame" | cut -c1-200 | head -5 | sed 's/^/   log: /'
mkdir -p fr-$id && rm -f fr-$id/*.png
"$F" -v error -y -i o-$id.mov -vf "fps=8/$D,scale=iw/4:ih/4" -frames:v 8 -pix_fmt rgba fr-$id/%02d.png
python3 - "$id" <<'PY'
import sys,glob
from PIL import Image
id=sys.argv[1]; fs=sorted(glob.glob(f"fr-{id}/*.png"))
ims=[Image.open(f).convert("RGBA") for f in fs]
w,h=ims[0].size
sheet=Image.new("RGBA",(w*4+50,h*2+30),(40,43,50,255))
for i,im in enumerate(ims):
    bg=Image.new("RGBA",im.size,(86,92,104,255)); bg.alpha_composite(im)
    sheet.paste(bg,(10+(i%4)*(w+10),10+(i//4)*(h+10)))
sheet.save(f"sheet-{id}.png"); print("   sheet", sheet.size, len(ims), "frames")
PY
