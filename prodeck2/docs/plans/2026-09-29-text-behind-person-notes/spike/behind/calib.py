"""
Calibration files for how CapCut picks a frame from a ProRes overlay (spec §13 item 2 follow-up).
Each frame is transparent but for one opaque row of 9 blocks at the top: a white marker block, then the
frame's index in 8 bits (white = 1). Two files, both 90 frames in a 1/600 timescale:
  calib-cfr.mov  pts 20·n ticks (exactly 1/30 s apart)
  calib-vfr.mov  pts 20·n + 1 from frame 30 on (a 21-tick step, like the iPhone source)
  python3 calib.py
"""
import os, subprocess
import numpy as np
FF = "/Applications/BOXBLACK.app/Contents/Resources/bin/ffmpeg"
OUT = os.path.expanduser("~/Movies/CapCut/BOXBLACK/spike-behind")
W, H, N, B = 1080, 1920, 90, 120
frames = np.zeros((N, H, W, 4), dtype=np.uint8)
for n in range(N):
    bits = [1] + [(n >> (7 - i)) & 1 for i in range(8)]
    for i, bit in enumerate(bits):
        v = 255 if bit else 0
        frames[n, 0:B, i * B:(i + 1) * B, :3] = v
        frames[n, 0:B, i * B:(i + 1) * B, 3] = 255
raw = frames.tobytes()
for name, expr in (("calib-cfr", "20*N"), ("calib-vfr", "20*N+gte(N,30)")):
    subprocess.run([FF, "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-framerate", "30", "-i", "-",
                    "-vf", f"format=yuva444p10le,settb=1/600,setpts='{expr}'", "-fps_mode", "passthrough", "-enc_time_base:v", "1/600", "-video_track_timescale", "600",
                    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "8", "-qscale:v", "12", "-vendor", "apl0",
                    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-y", os.path.join(OUT, name + ".mov")],
                   input=raw, check=True)
    print(name, subprocess.run(["/opt/homebrew/bin/ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts", "-of", "csv=p=0", os.path.join(OUT, name + ".mov")], capture_output=True, text=True).stdout.split()[28:33])
