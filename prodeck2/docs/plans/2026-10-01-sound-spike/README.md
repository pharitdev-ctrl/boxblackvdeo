# Spike: Claude composes musical sound effects as code (2026-10-01)

The user asked for musical sound effects that really fit the video, because CapCut's ready-made sounds sometimes do not. They wanted it free. Three free routes were offered: CapCut's library, CC0 files shipped with the app, and generating the sound. They chose to try "Claude writes the sound as Web Audio code, the app renders it offline" (route 1). After hearing the result, they chose to build it as a feature (2026-10-01, answer "1").

## What was tried

- **Moments.** Four moments of draft 0917: the hook question (no graphic), the rocket graphic, the countdown graphic and the arrival graphic.
  - Word times are taken from the transcript. The graphics' moments match the rough cut's word times exactly, so the source video lines up.
  - The graphics' HTML fragments (as edited in the 0.5.1 live test) are given to Claude so it can land hits on what is seen.
- **Palette call** (`palette-system.txt`). One call sets the clip's sound palette: key, tempo feel, instruments, character, a recurring motif and what to avoid. It took 9 s. See `out/palette.txt`.
- **Writing calls** (`contract.txt`). One call per moment, four in parallel. Each call:
  - writes one `function compose(ctx, cue, kit)`;
  - builds the sound on an `OfflineAudioContext` (2 channels, 48 kHz);
  - uses `kit.rand`, `kit.noise`, `kit.reverb` and `kit.note`, all seeded and deterministic;
  - has no network, files, timers or promises.

  The calls used `claude -p` with the app's low-overhead flags, `claude-opus-5-5`, effort medium.
- **Rendering** (`render.mjs`, `harness.js`).
  - The graphics pack's `chrome-headless-shell` loads `about:blank`. Every connection off the machine goes to a proxy that is not there, as in `offlineChrome`.
  - The code runs once, `startRendering` is called, and the result is encoded to a 16-bit WAV in the page.
  - The render step reports peak, RMS and the trailing silence. One repair call is made if a render fails or comes out silent.
- **Preview** (`preview.py`).
  - Built from the source video, with the graphics' `.mov` laid at their boxes.
  - Speech is set to -16 LUFS and each sound to -24 LUFS.
  - Encoded with Homebrew's ffmpeg; the bundled LGPL ffmpeg has no H.264 or AAC encoder.
  - The preview videos show the user's face. They stay in the session scratchpad and are not kept here.

## Results

| Moment | Writing call | Render | Hits measured (s) | Words (s) |
|---|---|---|---|---|
| hook | 23.7 s | first time, peak 0.42 | 0.24, 1.36, 1.92 (end 2.2) | อวกาศ 0.24, อวกาศ 1.36, ไง 1.92 |
| rocket | 42.5 s | first time, peak 0.23 | 0.78, 0.94, 1.70 | สวย 0.78, อวกาศ 0.94; the underline animation |
| countdown | 28.7 s | first time, peak 0.80 | 0 (start), 1.26, 2.22, 2.42 | สาม 0, สอง 1.26, หนึ่ง 2.22 |
| arrival | 34.4 s | first time, peak 0.43 | 0.22, 0.76, 0.92, 1.33 | follows the stars and the label pop |

- **Repairs.** None of the four needed a repair.
- **Spectra** (`out/specs.png`). The sounds are layered:
  - noise whooshes;
  - detuned harmonics;
  - pitch slides;
  - reverb tails.

  None of them are bare tones.
- **Loudness.** Integrated loudness of the raw renders ranged from -31.6 to -19.6 LUFS, so the app must normalise each sound. The preview used -24 LUFS under -16 LUFS speech.
- **The palette held.** The motif G4-C5-E5-G5 is questioning at the hook and completes on bells at the arrival.
- **The user's verdict** (2026-10-01): build it (option 1 of: build / try real-instrument samples first / stop).

## Not yet known (for the design), answered in 0.6.0

- Whether CapCut accepts a local WAV laid as an audio material in a draft, and how it must be written. It probably works as local video does, but this is not tested.
  - **Answered:** yes, as an `extract_music` material with a `music` bin item (`capcut-local-wav.md`). Tested with the user in CapCut 9.5: the sound plays, it survives a re-save, and export shows no Pro prompt.
- The cost in calls for a whole clip. 0917 had 11 sound slots in 0.5.0.
  - **Answered:** one plan call, then one compose call per sound. The live test on 0917 planned 12 sounds and 10 sounds, about 2 minutes per whole clip. Every sound passed on its first write.
- Whether a graphic's sound should be written in the same call as the graphic, or after it from its fragment.
  - **Answered:** after the graphic, from its fragment. The sound's brief carries the graphic's idea and html.
  - A graphic that is redone or edited rewrites its tied sounds in the same run.
