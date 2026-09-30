/**
 * For 0.4.3: a draft that holds every CapCut resource BOXBLACK may write with "มี CapCut Pro" off, so the
 * user can open CapCut's export dialog and read which of them it lists as Pro (the cache proved wrong for
 * อัลเทอร์เนตเฟด). On 0917 as the test app wrote it (0.4.2), it:
 *   - takes every exit animation off (all five count as Pro from 0.4.3),
 *   - gives the entrance animations in turn: รวมแบบป๊อปอัป, ร่วงเร็ว, ดึงม่านขึ้น (the three the styles use),
 *   - adds every built-in sound once, 0.7 s apart, on tracks of their own.
 *   node check-pro.mts
 */
import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
import { writeDraft } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/write.ts"
import { addSoundTrack } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/capcut/sounds.ts"
import { BUILT_IN_SOUNDS } from "file:///Users/ford/Desktop/Thalent%20Ai/excp/prodeck2/packages/core/src/flair/sound-catalogue.ts"

const HERE = "/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad/behind"
const draft = await loadDraft(join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917"))
const info: any = structuredClone(draft.info)
if (info.tracks[0].segments.length !== 6) throw new Error("0917 is not the test app's 0.4.2 write")

const ENTRANCES = [
  { resourceId: "7664531520492686613", name: "รวมแบบป๊อปอัป" },
  { resourceId: "7664533258335440148", name: "ร่วงเร็ว" },
  { resourceId: "7643711191419833618", name: "ดึงม่านขึ้น" },
]
let outs = 0
let ins = 0
const used: Record<string, number> = {}
for (const material of info.materials.material_animations ?? []) {
  const before = material.animations?.length ?? 0
  material.animations = (material.animations ?? []).filter((animation: any) => animation.type !== "out")
  outs += before - material.animations.length
  for (const animation of material.animations) {
    if (animation.type !== "in") continue
    const pick = ENTRANCES[ins++ % ENTRANCES.length]!
    Object.assign(animation, { id: pick.resourceId, resource_id: pick.resourceId, name: pick.name, path: "" })
    used[pick.name] = (used[pick.name] ?? 0) + 1
  }
}
const cues = BUILT_IN_SOUNDS.map((sound, i) => ({ atUs: 300_000 + i * 700_000, effectId: sound.effectId, name: sound.name, path: null, durationUs: sound.durationUs }))
const withSounds: any = addSoundTrack(info, cues)
await writeDraft(draft, withSounds.info)
const record = { outsRemoved: outs, entrances: used, sounds: BUILT_IN_SOUNDS.length, soundCounts: withSounds.counts, placed: cues.map((cue) => [cue.atUs, cue.name]) }
writeFileSync(join(HERE, "check-pro.json"), JSON.stringify(record, null, 1))
console.log(JSON.stringify({ outsRemoved: outs, entrances: used, sounds: BUILT_IN_SOUNDS.length, counts: withSounds.counts }))
