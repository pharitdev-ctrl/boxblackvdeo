"""
Frame-by-frame check of the proof export (spec §13 item 2): for every export frame inside a person range,
which source frame the main layer shows and which the person layer shows. Each candidate pair (main k,
person k') is composited the way CapCut does (person file frame over the source frame, alpha from the file),
put through the piece's zoom at that moment, and compared with the export in a band around the person's
edge, where a one-frame slip shows. Frames match when the best pair has k' == k.
  python3 frames.py <export.mov>
Writes frames-<range>.csv and prints a summary per range.
"""
import json, os, subprocess, sys
import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
FF = "/opt/homebrew/bin/ffmpeg"
SRC = "/Users/ford/Downloads/IMG_9646.MOV"
FILES = os.path.expanduser("~/Movies/CapCut/BOXBLACK/spike-behind")
W, H = 540, 960  # half size is enough to see a frame's motion and keeps it quick
export = sys.argv[1]
jobs = json.load(open(os.path.join(HERE, "jobs2.json")))["ranges"]
written = json.load(open(os.path.join(HERE, "written2-ids.json")))
keys_of = {p["name"]: p["keys"] for p in written["people"]}
pts = json.load(open(os.path.join(HERE, "pts.json")))
pts_us = [p * 1_000_000 / 600 for p in pts]


def frames(path, first, count, fmt):
    """count frames from frame index first (decode order = presentation order here), as float arrays"""
    ch = 4 if fmt == "rgba" else 3
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-vf", f"select='between(n,{first},{first + count - 1})',scale={W}:{H}:flags=area", "-fps_mode", "passthrough",
                          "-f", "rawvideo", "-pix_fmt", fmt, "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, H, W, ch).astype(np.float32)


def value_at(keys, t):
    ts = [k[0] for k in keys]
    vs = [k[1] for k in keys]
    if t <= ts[0]:
        return vs[0]
    if t >= ts[-1]:
        return vs[-1]
    return float(np.interp(t, ts, vs))


def zoom(img, scale, pos_y):
    """CapCut's clip: scale about the centre, then move up by pos_y half-heights (+1 is the top edge)"""
    if scale == 1 and pos_y == 0:
        return img
    cy, cx = (H - 1) / 2, (W - 1) / 2
    shift_down = -pos_y * H / 2
    out = np.empty_like(img)
    for c in range(img.shape[2]):
        # output (y, x) samples input at ((y - cy - shift) / s + cy, (x - cx) / s + cx)
        out[..., c] = ndimage.affine_transform(img[..., c], [1 / scale, 1 / scale], offset=[cy - (cy + shift_down) / scale, cx - cx / scale], order=1, mode="nearest")
    return out


summary = []
for r in jobs:
    f_first = -(-r["start"] * 30 // 1_000_000)
    f_last = (r["end"] - 1) * 30 // 1_000_000
    n = f_last - f_first + 1
    ex = frames(export, f_first, n, "rgb24")
    lo = max(r["i0"] - 3, 0)
    src = frames(SRC, lo, r["iEnd"] - lo + 4, "rgb24")
    over = frames(os.path.join(FILES, r["file"]), 0, len(r["seq"]), "rgba")
    fidx = {}
    for j, k in enumerate(r["seq"]):
        if j and k not in fidx: fidx[k] = j
    keys = keys_of[r["name"]]
    rows = []
    for idx in range(n):
        f = f_first + idx
        t_us = f * 1_000_000 // 30
        u = r["S"] + (t_us - r["start"])  # the source moment the main piece plays at this frame
        centre = max(i for i, p in enumerate(pts_us) if p <= u + 0.5)
        cands = [k for k in range(centre - 2, centre + 3) if k in fidx and 0 <= k - lo < len(src)]
        # the band around the person's edge in the expected person frame, above the subtitles
        a = over[fidx.get(centre, 1), ..., 3] / 255
        solid = a > 0.5
        band = ndimage.binary_dilation(solid, iterations=8) & ~ndimage.binary_erosion(solid, iterations=8)
        band[int(H * 0.82):] = False
        t_file = u - r["keyOffset"]
        if keys:
            scale = value_at(keys[0][1], t_file)
            pos_y = value_at(keys[2][1], t_file)
        else:
            scale, pos_y = 1.0, 0.0
        best = []
        for km in cands:
            base = src[km - lo]
            for ko in cands:
                o = over[fidx[ko]]
                al = o[..., 3:] / 255
                comp = zoom(base * (1 - al) + o[..., :3] * al, scale, pos_y)
                err = np.abs(comp - ex[idx]).mean(axis=2)[band].mean()
                best.append((err, km, ko))
        best.sort()
        (e1, km, ko), e2 = best[0], best[1][0]
        rows.append((f, t_us, centre, km, ko, round(e1, 3), round(e2 - e1, 3)))
    with open(os.path.join(HERE, f"frames2-{r['name']}.csv"), "w") as out:
        out.write("export_frame,t_us,expected_src,main_src,person_src,err,margin\n")
        for row in rows:
            out.write(",".join(map(str, row)) + "\n")
    slips = [row[4] - row[3] for row in rows]
    off = [row[3] - row[2] for row in rows]
    weak = sum(1 for row in rows if row[6] < 0.05)
    summary.append((r["name"], n, {d: slips.count(d) for d in sorted(set(slips))}, {d: off.count(d) for d in sorted(set(off))}, weak, round(float(np.mean([row[5] for row in rows])), 2)))
    print(f"{r['name']}: {n} frames · person−main {summary[-1][2]} · main−expected {summary[-1][3]} · weak margins {weak} · mean err {summary[-1][5]}", flush=True)
