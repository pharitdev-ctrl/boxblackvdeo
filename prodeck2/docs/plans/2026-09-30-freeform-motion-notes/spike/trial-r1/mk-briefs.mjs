// node mk-briefs.mjs : writes b-<id>.txt for every brief, in the form the app's motionBrief will use
import { readFileSync, writeFileSync } from "node:fs"
for (const b of JSON.parse(readFileSync("briefs.json", "utf8"))) {
  const words = b.words.map(([text, at], i) => `--w${i + 1} "${text}" ${at.toFixed(2)}`).join(" · ")
  writeFileSync(`b-${b.id}.txt`, `Brief:\n- Stage: W = ${b.w}, H = ${b.h} px.\n- D = ${b.d} seconds.\n- Words, in order, with the time each is said now: ${words}.\n- What to draw: ${b.idea}\n- The clip is about: ${b.about}.\n`)
}
