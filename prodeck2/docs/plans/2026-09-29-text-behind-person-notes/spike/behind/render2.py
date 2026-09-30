"""
Person files built frame for frame from what CapCut shows (calibration export 0917-calib, 2026-09-29):
- CapCut shows a CFR ProRes overlay's first frame whose time is at or after the time asked (ceil);
- it shows the iPhone source (uneven frame steps) as the latest frame at or before the time asked (+1 µs).
So file frame j+1 = the source frame the main layer shows at the range's timeline frame j, file frame 0 is a
spare copy of the first, the file is exact CFR 30, and the segment's source.start is 16667 µs: every
timeline frame then asks for the middle of the gap before the frame it should get, 16.7 ms from either edge.
Colour stays YUV (source decoded to yuv444p10le), alpha from the chosen mask filter, black where alpha is 0.
  python3 render2.py [name...]      writes ~/Movies/CapCut/BOXBLACK/spike-behind/<name>-v2.mov and jobs2.json
"""
import json, os, subprocess, sys, glob, shutil, time
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
VISION = os.path.join(HERE, "..", "cutout", "vision")
HB = "/opt/homebrew/bin/ffmpeg"           # decoding to raw (the bundled build has no rawvideo muxer)
FF = "/Applications/BOXBLACK.app/Contents/Resources/bin/ffmpeg"  # the encode, as the product would
SRC = "/Users/ford/Downloads/IMG_9646.MOV"
OUT = os.path.expanduser("~/Movies/CapCut/BOXBLACK/spike-behind")
W, H = 1080, 1920
SOURCE_START = 16667
jobs = json.load(open(os.path.join(HERE, "jobs.json")))
pts = json.load(open(os.path.join(HERE, "pts.json")))
pts_us = [p * 1_000_000 / 600 for p in pts]
wanted = set(sys.argv[1:])


def shown_main(t_main_us):
    return max(k for k, p in enumerate(pts_us) if p <= t_main_us + 1)


for r in jobs["ranges"]:
    if wanted and r["name"] not in wanted:
        continue
    t0 = time.time()
    n0, n1 = round(r["start"] * 30 / 1e6), round(r["end"] * 30 / 1e6)
    main_seq = [shown_main(r["S"] + (n * 1_000_000 // 30 - r["start"])) for n in range(n0, n1)]
    seq = [main_seq[0]] + main_seq
    r.update({"seq": seq, "sourceStart": SOURCE_START, "fileUs": len(seq) * 1_000_000 // 30, "keyOffset": r["S"] - SOURCE_START, "file": f"{r['name']}-v2.mov"})
    work = os.path.join(HERE, "work2", r["name"])
    if os.path.isdir(work):
        shutil.move(work, os.path.expanduser(f"~/.Trash/work2-{r['name']}-{int(time.time())}"))
    for d in ("src", "frames", "masks"):
        os.makedirs(os.path.join(work, d))
    lo, hi = min(seq), max(seq)
    subprocess.run([HB, "-v", "error", "-i", SRC, "-an", "-vf", f"select='between(n,{lo},{hi})'", "-fps_mode", "passthrough", "-q:v", "2", "-start_number", str(lo), "-y", os.path.join(work, "src", "%04d.jpg")], check=True)
    for j, k in enumerate(seq):  # Vision sees the sequence as it will play, repeats included
        shutil.copy(os.path.join(work, "src", f"{k:04d}.jpg"), os.path.join(work, "frames", f"{j + 1:04d}.jpg"))
    frames = sorted(glob.glob(os.path.join(work, "frames", "*.jpg")))
    subprocess.run([os.path.join(VISION, "segment"), "accurate", os.path.join(work, "masks")] + frames, check=True, capture_output=True)
    subprocess.run(["python3", os.path.join(VISION, "final-masks.py"), work], check=True, capture_output=True)
    # colour: the source decoded once to yuv444p10le, frames lo..hi, picked in sequence order
    dec = subprocess.Popen([HB, "-v", "error", "-i", SRC, "-an", "-vf", f"select='between(n,{lo},{hi})',format=yuv444p10le", "-fps_mode", "passthrough", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen([FF, "-v", "error", "-f", "rawvideo", "-pix_fmt", "yuva444p10le", "-s", f"{W}x{H}", "-framerate", "30", "-i", "-",
                            "-vf", "settb=1/600,setpts=20*N", "-fps_mode", "passthrough", "-enc_time_base:v", "1/600", "-video_track_timescale", "600",
                            "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "8", "-qscale:v", "12", "-vendor", "apl0",
                            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-y", os.path.join(OUT, r["file"])], stdin=subprocess.PIPE)
    size = W * H * 3 * 2
    have, current = lo - 1, None
    for j, k in enumerate(seq):
        while have < k:
            current = np.frombuffer(dec.stdout.read(size), dtype=np.uint16).reshape(3, H, W)
            have += 1
        m = np.asarray(Image.open(os.path.join(work, "final", f"{j + 1:04d}.png")), dtype=np.uint16)
        a = (m.astype(np.uint32) * 1023 // 255).astype(np.uint16)
        y, u, v = current.copy()
        zero = a == 0
        y[zero], u[zero], v[zero] = 64, 512, 512
        enc.stdin.write(np.stack([y, u, v, a]).tobytes())
    enc.stdin.close()
    enc.wait()
    dec.stdout.close()
    dec.wait()
    out = os.path.join(OUT, r["file"])
    got = [int(x.strip(",")) for x in subprocess.run(["/opt/homebrew/bin/ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts", "-of", "csv=p=0", out], capture_output=True, text=True).stdout.split() if x.strip(",")]
    repeats = sum(1 for a, b in zip(main_seq, main_seq[1:]) if a == b)
    skips = sum(1 for a, b in zip(main_seq, main_seq[1:]) if b - a > 1)
    print(f"{r['name']}: {len(seq)} frames (source {lo}..{hi}, repeats {repeats}, skips {skips}), CFR {got == [20 * i for i in range(len(seq))]}, {os.path.getsize(out) / 1e6:.1f} MB, {time.time() - t0:.1f} s", flush=True)
json.dump(jobs, open(os.path.join(HERE, "jobs2.json"), "w"), indent=1)
