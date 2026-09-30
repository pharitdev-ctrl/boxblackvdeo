#!/bin/sh
# sh sheet.sh <id> <seconds>  : 8 frames of o-<id>.mov over grey, as sheet-<id>.png
S=/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad
FF="/Users/ford/Desktop/Thalent Ai/excp/prodeck2/apps/desktop/resources/bin/ffmpeg"
cd $S/r050/e2e
id=$1; D=$2
mkdir -p fr-$id && rm -f fr-$id/*.png
"$FF" -nostdin -v error -y -i o-$id.mov -vf "fps=8/$D,scale=iw/3:ih/3" -frames:v 8 -pix_fmt rgba fr-$id/%02d.png
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
sheet.save(f"sheet-{id}.png"); print("sheet", sheet.size, len(ims), "frames")
PY
