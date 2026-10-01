# UI harness (tutorial screenshots)

Runs the real BOXBLACK renderer in a browser on a scripted fake API (`harness.tsx`), so the tutorial
video can show the actual screens without CapCut, Claude or real footage. Nothing here ships in the app.

```bash
# from prodeck2/
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts
node node_modules/vite/bin/vite.js --config .ui-harness/vite.config.mjs   # http://localhost:5179
```

Query modes: `?fresh` (first launch: no license, no model, no Claude), `?capcut` (CapCut open at start),
`?analysed`, `?outlined`, `?planned`.

`capture.mjs <tutorial folder>` drives every step with Playwright and writes `shots/*.jpg` plus
`shots/manifest.json` (the screen boxes of the controls each step points at).
