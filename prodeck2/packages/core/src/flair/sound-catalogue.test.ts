import { expect, test } from "vitest"
import { BUILT_IN_SOUNDS, soundNeedsPro, usableSounds } from "./sound-catalogue.ts"

test("the built-in sounds are CapCut ids for CapCut to fetch, each once", () => {
  expect(BUILT_IN_SOUNDS.length).toBeGreaterThanOrEqual(25)
  const ids = BUILT_IN_SOUNDS.map((sound) => sound.effectId)
  expect(new Set(ids).size).toBe(ids.length)
  for (const sound of BUILT_IN_SOUNDS) {
    expect(sound.effectId).toMatch(/^\d{18,20}$/)
    // no file: CapCut downloads it by id when the draft is opened
    expect(sound.path).toBeNull()
  }
})

test("each says in Thai what it is for, so Claude can place it by meaning", () => {
  for (const sound of BUILT_IN_SOUNDS) {
    expect(sound.name.trim()).not.toBe("")
    expect(sound.use).toMatch(/[฀-๿]/)
  }
})

test("every one is a short effect: a long one would play over the talking", () => {
  for (const sound of BUILT_IN_SOUNDS) {
    expect(sound.durationUs).toBeGreaterThan(0)
    expect(sound.durationUs).toBeLessThanOrEqual(5_000_000)
  }
})

test("only free sounds: a Pro one locks the export of anyone without CapCut Pro", () => {
  // the two the user saw marked Pro in CapCut's own list
  const pro = ["7517109130840426533", "7541601071157020682"]
  for (const sound of BUILT_IN_SOUNDS) expect(pro).not.toContain(sound.effectId)
})

test("no sound CapCut could not fetch on a real machine: it left a placeholder instead of a file", () => {
  // "ว้าว": written into 0923 on 2026-09-23, CapCut never downloaded it; หยดน้ำ, ชัตเตอร์ and จุ๊บ:
  // written into 0917 with the other 11 never used before, and the only ones CapCut could not fetch
  for (const broken of ["6988031765445085186", "6995835233664796674", "6988031765445085185", "6993230936981424130"]) {
    expect(BUILT_IN_SOUNDS.map((sound) => sound.effectId)).not.toContain(broken)
  }
})

test("counts only the built-in sounds as free: any other one may be Pro", () => {
  expect(soundNeedsPro(BUILT_IN_SOUNDS[0]!.effectId)).toBe(false)
  expect(soundNeedsPro("123")).toBe(true)
  const mine = { effectId: "123", name: "from a draft", durationUs: 1_000_000, path: null }
  expect(usableSounds([BUILT_IN_SOUNDS[0]!, mine], false)).toEqual([BUILT_IN_SOUNDS[0]])
  expect(usableSounds([BUILT_IN_SOUNDS[0]!, mine], true)).toEqual([BUILT_IN_SOUNDS[0], mine])
  // a built-in id read back from a draft is still the free sound, whatever else the draft says about it
  const fromDraft = { ...BUILT_IN_SOUNDS[0]!, name: "as a draft names it", durationUs: 1_234_567, path: "/cache/x.mp3" }
  expect(usableSounds([fromDraft], false)).toEqual([fromDraft])
})
