You are implementing Task 4 of the BOXBLACK 0.6.0 plan "Composed sound effects": Main: the sealed window, the renderer, the loudness.

Read `docs/plans/2026-09-30-freeform-motion-notes/prompts/r060-common.md` first. It covers the project, where to read, the rules and the report format.

Your task is "Task 4" in `docs/plans/2026-10-01-composed-sound.md`. Steps 1 to 6 there are your work.

## Already decided (do not re-decide)

**Building on Task 2.** Task 2 is done and in review. You use:
- `SOUND_HARNESS`, `soundProblems` and `RenderStats` from `@boxblack/core/sound/harness`;
- `lintCompose` from `@boxblack/core/sound/lint`;
- `SOUND_VERSION`, `LOUDNESS_LUFS` and the types from `@boxblack/core/sound/spec`.

Read the harness string to see exactly what `renderSound` returns.

**The sealed window.** This is the security boundary for code Claude writes. Build it exactly as Step 1 says, and add:
- `webPreferences.disableDialogs: true`, so `alert`, `confirm`, `prompt` and `print` cannot block the page;
- `webPreferences.webSecurity: true`;
- `webPreferences.images: false`;
- `webContents.setAudioMuted(true)`. Nothing should play aloud; an `OfflineAudioContext` does not anyway.

Electron is injected (`{ BrowserWindow, session }`), so the unit tests use fakes and never start Electron. Pin every option and handler in a test, so a later change cannot loosen one silently.

**`index.ts`.** Make the lifecycle changes of Step 2:
- `mainWindow`;
- `send` to the main window only;
- `activate` making a new main window when it is missing;
- the sealed page closed on `before-quit`.

Do not wire the sound renderer into anything yet. Task 5 does that. You may create nothing in `index.ts` but the lifecycle changes and the sealed page's close-on-quit.

**`sound-render.ts`**

*Jobs and errors*
- `SoundJob` = `{ code: string; seconds: number; words: MotionWord[]; loudness: SoundLoudness }`. Export it.
- `EnvironmentError` is the one in `graphics-render.ts`. Import it, or move it to a small shared module if importing pulls too much along; say which you did.

*Seed and files*
- The seed is `parseInt(hash.slice(0, 8), 16)`.
- Files are written through a temp name and renamed into place. A rename is the only thing that makes `<hash>.wav` exist.
- The temp raw WAV goes to `<dir>/<hash>.raw.wav` and is removed afterwards. A leftover one is overwritten.
- `ensure` renders one at a time; a second `ensure` while one runs queues behind it.
- `failures` are kept until `forgetFailures()`. `forgetMachine()` clears a machine fault.

*Process runner*
- Look at how `graphics-render.ts` and `media/loudness.ts` run processes, and use the same injected runner (`runProcess`), so tests fake ffmpeg.

**`sound-loudness.ts`.** It parses the integrated loudness and the true peak (or sample peak, whichever `ebur128` prints with `peak=sample`; choose and say which) from captured ffmpeg output. Tests use real captured text: write it into the test from a real `ebur128` run's format. Do not run ffmpeg in tests.

**`hashOfHtml` is not yours.** Task 6 owns it.

## Working conditions

Other implementers work at the same time:
- Task 7a, in `packages/core/src/capcut/`.
- Task 3, in `packages/core/src/sound/plan.ts`.
- Task 6, in:
  - `apps/desktop/src/main/composed-cues.ts`, `highlights.ts`, `emphasis.ts`, `planner.ts` and `legacy-beats.ts`;
  - `apps/desktop/src/shared/api.ts`;
  - the renderer test fixtures.

Do not touch their files. A failing test outside your files is probably theirs in progress: wait and run it again, and do not fix it.
