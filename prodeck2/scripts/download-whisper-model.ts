/**
 * Downloads the whisper.cpp model into the folder the desktop app reads from:
 *   node scripts/download-whisper-model.ts
 * Resumes a partial download and verifies the SHA-256 before the file is used.
 */
import { homedir } from "node:os"
import { join } from "node:path"
import { downloadModel, modelState, WHISPER_MODELS } from "../packages/core/src/asr/models.ts"

const dir = join(homedir(), "Library/Application Support/BOXBLACK/models")
const model = WHISPER_MODELS[0]!

console.log(`${model.file} → ${dir}`, await modelState(dir, model))
let lastPercent = -1
const path = await downloadModel(dir, model, {
  onProgress: (received, total) => {
    const percent = Math.floor((received / total) * 100)
    if (percent !== lastPercent && percent % 5 === 0) console.log(`${percent}%  ${(received / 1e6).toFixed(0)} MB`)
    lastPercent = percent
  },
})
console.log(`ready: ${path}`)
