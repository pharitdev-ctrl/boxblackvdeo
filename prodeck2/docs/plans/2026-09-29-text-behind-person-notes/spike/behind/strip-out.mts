// Takes every "out" text animation off draft 0917 (CapCut's export dialog marks อัลเทอร์เนตเฟด as Pro); nothing else changes.
import { homedir } from "node:os"
import { join } from "node:path"
import { loadDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
import { writeDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/write.ts"
const draft = await loadDraft(join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"))
const info: any = structuredClone(draft.info)
let removed = 0
for (const material of info.materials.material_animations ?? []) {
  const before = material.animations?.length ?? 0
  material.animations = (material.animations ?? []).filter((animation: any) => animation.type !== "out")
  removed += before - material.animations.length
}
await writeDraft(draft, info)
console.log(`removed ${removed} out animations; tracks ${info.tracks.map((t: any) => `${t.type}/${t.flag}/${t.segments.length}`).join(" ")}`)
