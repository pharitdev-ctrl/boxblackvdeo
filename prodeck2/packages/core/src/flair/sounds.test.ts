import { describe, expect, it } from "vitest"
import { mergeSounds, soundsInDraft } from "./sounds.ts"

const CACHE = "/Users/someone/Library/Containers/com.lemon.lvoverseas/Data/Movies/CapCut/User Data/Cache/music"
const pop = {
  id: "m1",
  type: "sound",
  name: "Popping sound Popa No reverberation sound #10(1364638)",
  duration: 333_333,
  path: `${CACHE}/pop.mp3`,
  effect_id: "7167077030767364097",
}
const whoosh = { id: "m2", type: "sound", name: "ฟิ้ว", duration: 433_333, path: `${CACHE}/whoosh.mp3`, effect_id: "6993230936993204226" }

const draft = (audios: unknown[]) => ({ materials: { audios } })
const exists = (path: string) => path.endsWith("pop.mp3")

describe("soundsInDraft", () => {
  it("reads a sound with its id, name, length and cached file", () => {
    expect(soundsInDraft(draft([pop]), exists)).toEqual([
      { effectId: "7167077030767364097", name: pop.name, durationUs: 333_333, path: `${CACHE}/pop.mp3` },
    ])
  })

  it("says so when the cached file is gone", () => {
    expect(soundsInDraft(draft([whoosh]), exists)[0]!.path).toBeNull()
  })

  it("marks a sound CapCut could not fetch: it left its placeholder where the file would be", () => {
    const wow = { id: "m3", type: "sound", name: "ว้าว", duration: 1_000_000, path: "##_material_placeholder_23B2EC28-9736-45F9-966B-EBC7E2D228BE_##", effect_id: "6988031765445085186" }
    expect(soundsInDraft(draft([wow, pop]), exists)).toEqual([
      { effectId: "6988031765445085186", name: "ว้าว", durationUs: 1_000_000, path: null, unfetchable: true },
      { effectId: "7167077030767364097", name: pop.name, durationUs: 333_333, path: `${CACHE}/pop.mp3` },
    ])
    // the same sound used twice in one draft, fetched the second time: it has its file
    const fetched = { ...pop, id: "m4" }
    const failed = { ...pop, path: "##_material_placeholder_A_##" }
    expect(soundsInDraft(draft([failed, fetched]), exists)).toEqual([{ effectId: pop.effect_id, name: pop.name, durationUs: 333_333, path: pop.path }])
    expect(soundsInDraft(draft([fetched, failed]), exists)).toEqual([{ effectId: pop.effect_id, name: pop.name, durationUs: 333_333, path: pop.path }])
    // only CapCut's own marker counts: a real file that happens to have the word in its name is a file
    const named = { ...pop, path: `${CACHE}/placeholder_pop.mp3` }
    expect(soundsInDraft(draft([named]), exists)[0]).toEqual({ effectId: pop.effect_id, name: pop.name, durationUs: 333_333, path: named.path })
  })

  it("leaves out music, recordings and anything without an effect id", () => {
    const audios = [
      { ...pop, type: "music" },
      { ...pop, id: "m3", type: "extract_music" },
      { ...pop, id: "m4", effect_id: "" },
      { ...pop, id: "m5", effect_id: undefined },
    ]
    expect(soundsInDraft(draft(audios), exists)).toEqual([])
  })

  it("leaves out an entry with no name or no length", () => {
    expect(soundsInDraft(draft([{ ...pop, name: "  " }]), exists)).toEqual([])
    expect(soundsInDraft(draft([{ ...pop, duration: 0 }]), exists)).toEqual([])
  })

  it("gives one entry for the same sound used twice, keeping what the first said", () => {
    // the second use was trimmed in that draft, which is not the sound's own length
    const twice = soundsInDraft(draft([pop, { ...pop, id: "m6", duration: 120_000, name: "สั้นกว่า" }, whoosh]), exists)
    expect(twice.map((sound) => sound.effectId)).toEqual(["7167077030767364097", "6993230936993204226"])
    expect(twice[0]).toMatchObject({ durationUs: 333_333, name: pop.name })
  })

  it("survives a draft with nothing in it", () => {
    expect(soundsInDraft({}, exists)).toEqual([])
    expect(soundsInDraft({ materials: {} }, exists)).toEqual([])
    expect(soundsInDraft({ materials: { audios: "not a list" } }, exists)).toEqual([])
    expect(soundsInDraft(null, exists)).toEqual([])
  })
})

describe("mergeSounds", () => {
  const a = { effectId: "1", name: "ปัง", durationUs: 100, path: null }
  const b = { effectId: "1", name: "ปัง", durationUs: 100, path: "/cache/a.mp3" }
  const c = { effectId: "2", name: "ก๊อก", durationUs: 200, path: "/cache/c.mp3" }

  it("leaves out a sound CapCut could not fetch on this machine, from any list, unless one has its file", () => {
    const broken = { ...a, unfetchable: true as const }
    const builtIn = { ...a, use: "ป๊อป" }
    expect(mergeSounds([[broken], [builtIn, c]])).toEqual([c])
    expect(mergeSounds([[builtIn], [broken, c]])).toEqual([c])
    // another draft has the file after all: it is there, and nothing says otherwise
    expect(mergeSounds([[broken], [b]])).toEqual([b])
  })

  it("keeps one entry per sound and takes the file that is still there", () => {
    expect(mergeSounds([[a], [b]])).toEqual([b])
    expect(mergeSounds([[b], [a]])).toEqual([b])
  })

  it("when both lists have a file or a label, the first one's stays, like its name and length", () => {
    const first = { effectId: "1", name: "ปัง", durationUs: 100, path: "/cache/first.mp3", use: "ป๊อป" }
    const later = { effectId: "1", name: "ปัง", durationUs: 100, path: "/cache/later.mp3", use: "กระแทก" }
    expect(mergeSounds([[first], [later]])).toEqual([first])
  })

  it("sorts by name, so the list Claude sees is stable", () => {
    expect(mergeSounds([[a], [c]]).map((sound) => sound.name)).toEqual(["ก๊อก", "ปัง"])
  })

  it("a sound a draft measured keeps its own length and file, and takes the catalogue's word for what it is for", () => {
    // the catalogue rounds lengths up to whole seconds; a draft CapCut wrote has the real one
    const measured = { effectId: "7", name: "ฟาด", durationUs: 392_993, path: "/cache/fad.mp3" }
    const listed = { effectId: "7", name: "ฟาด", durationUs: 1_000_000, path: null, use: "ฟาด เน้นคำแรงๆ" }
    expect(mergeSounds([[measured], [listed]])).toEqual([{ ...measured, use: "ฟาด เน้นคำแรงๆ" }])
  })

  it("sorts by what the sound is for when it says, which is what the picker shows", () => {
    const idea = { effectId: "8", name: "A light bulb", durationUs: 1, path: null, use: "ไอเดียผุด" }
    const bell = { effectId: "9", name: "Z bell ring", durationUs: 1, path: null, use: "ติ๊ง" }
    expect(mergeSounds([[idea, bell]]).map((sound) => sound.use)).toEqual(["ติ๊ง", "ไอเดียผุด"])
  })

  it("has nothing to merge when no draft uses a sound", () => {
    expect(mergeSounds([])).toEqual([])
    expect(mergeSounds([[], []])).toEqual([])
  })
})
