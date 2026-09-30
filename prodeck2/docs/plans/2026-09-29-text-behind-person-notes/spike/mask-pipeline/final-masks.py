"""
The masks the user chose (panel 4 of flicker-compare2): Vision's accurate mask, its edge snapped to the
picture with a guided filter on the frame's brightness, then smoothed over ±2 frames (nearer frames
weigh more). Full size, for the ProRes cutout.
  python3 final-masks.py <work dir>      reads <work>/frames/*.jpg and <work>/masks/*-accurate.png,
                                          writes <work>/final/NNNN.png (1080x1920 grey)
"""
import glob, os, subprocess, sys
import numpy as np
from scipy import ndimage

FF = "/opt/homebrew/bin/ffmpeg"
W, H = 1080, 1920
work = sys.argv[1]
n = len(glob.glob(f"{work}/frames/*.jpg"))
os.makedirs(f"{work}/final", exist_ok=True)


def gray(path):
    out = subprocess.run([FF, "-v", "error", "-i", path, "-vf", f"scale={W}:{H}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.uint8).reshape(H, W).astype(np.float32) / 255


def guided(guide, src, r=12, eps=1e-3):
    box = lambda x: ndimage.uniform_filter(x, size=2 * r + 1, mode="reflect")
    mean_i, mean_p = box(guide), box(src)
    a = (box(guide * src) - mean_i * mean_p) / (box(guide * guide) - mean_i * mean_i + eps)
    b = mean_p - a * mean_i
    return np.clip(box(a) * guide + box(b), 0, 1)


snapped = [guided(gray(f"{work}/frames/{k:04d}.jpg"), gray(f"{work}/masks/{k:04d}-accurate.png")) for k in range(1, n + 1)]
weights = np.array([1, 2, 3, 2, 1], dtype=np.float32)
for i in range(n):
    mask = sum(w * snapped[min(max(i + d, 0), n - 1)] for w, d in zip(weights, range(-2, 3))) / weights.sum()
    subprocess.run([FF, "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-i", "-", "-y", f"{work}/final/{i + 1:04d}.png"], input=(np.clip(mask, 0, 1) * 255).round().astype(np.uint8).tobytes(), check=True)
print(f"{work}: {n} final masks")
