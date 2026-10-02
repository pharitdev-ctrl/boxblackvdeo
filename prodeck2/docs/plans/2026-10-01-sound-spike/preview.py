# Makes a preview of 0917's source video with the graphics laid where they play and the spike's sounds mixed under
# the speech: python3 preview.py <tag> <out.mp4> [nosfx]. Speech is set to -16 LUFS, each sound to -24 LUFS.
import json, subprocess, sys, re
S = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/r052/"
FF = "/opt/homebrew/bin/ffmpeg"
G = "/Users/ford/Movies/CapCut/BOXBLACK/graphics/"
tag, out = sys.argv[1], sys.argv[2]
sfx = len(sys.argv) < 4
ms = json.load(open(S + "moments.json"))
def lufs(path):
    r = subprocess.run([FF, "-hide_banner", "-nostdin", "-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True)
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)[-1])
args = [FF, "-y", "-hide_banner", "-nostdin", "-v", "error", "-i", "/Users/ford/Downloads/IMG_9646.MOV"]
vf, af, n = [], ["[0:a:0]loudnorm=I=-16:TP=-1.5:LRA=11[sp]"], 1
last = "[0:v]"
for m in ms:
    if m["mov"]:
        args += ["-itsoffset", str(m["sourceS"]), "-i", G + m["mov"]]
        vf.append(f"{last}[{n}:v]overlay=42:134:eof_action=pass[v{n}]"); last = f"[v{n}]"; n += 1
mix = ["[sp]"]
if sfx:
    for m in ms:
        w = f"{S}out/{tag}-{m['name']}.wav"
        gain = -24 - lufs(w)
        args += ["-i", w]
        d = int(m["sourceS"] * 1000)
        af.append(f"[{n}:a]volume={gain:.1f}dB,adelay={d}|{d}[s{n}]"); mix.append(f"[s{n}]"); n += 1
af.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0,alimiter=limit=0.9[a]")
vf.append(f"{last}scale=540:960[v]")
args += ["-filter_complex", ";".join(vf + af), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-t", "31", out]
r = subprocess.run(args, capture_output=True, text=True)
print(r.returncode, r.stderr[-800:])
