import { expect, test } from "vitest"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import type { CueAnchor } from "@boxblack/core/flair/plan"
import type { StoredOutline } from "../shared/api.ts"
import { hasBeatless, withBeats } from "./legacy-beats.ts"

const outline = (flair: StoredOutline["flair"]) => ({ flair }) as StoredOutline
const everywhere = { cue: () => "b2", insert: () => "b2", zoom: () => "b2" }

test("only joins, moments of speech and pieces saved without a beat are given one", () => {
  const stored = outline({
    looks: {},
    cues: [
      { anchor: { kind: "cut", videoId: "v", sourceUs: 1 }, effectId: "s", edited: true },
      { anchor: { kind: "cut", videoId: "v", sourceUs: 2, beatId: "b1" }, effectId: "s", edited: true },
      { anchor: { kind: "highlight", groupId: "g", line: 0 }, effectId: "s", edited: true },
      { anchor: { kind: "beat", beatId: "b1", edge: "start" }, effectId: "s", edited: true },
    ],
    inserts: [{ anchor: { kind: "speech", videoId: "v", sourceUs: 3 }, binId: "m", edited: true }],
    zooms: [
      { anchor: { videoId: "v", sourceUs: 4 }, kind: "punch", edited: true },
      { anchor: { videoId: "v", sourceUs: 5, beatId: "b1" }, kind: "punch", edited: true },
    ],
  })
  expect(hasBeatless(stored)).toBe(true)
  const next = withBeats(stored, everywhere)
  expect(next.flair!.cues!.map((cue) => cue.anchor)).toEqual([
    { kind: "cut", videoId: "v", sourceUs: 1, beatId: "b2" },
    { kind: "cut", videoId: "v", sourceUs: 2, beatId: "b1" },
    { kind: "highlight", groupId: "g", line: 0 },
    { kind: "beat", beatId: "b1", edge: "start" },
  ])
  expect(next.flair!.inserts!.map((insert) => insert.anchor)).toEqual([{ kind: "speech", videoId: "v", sourceUs: 3, beatId: "b2" }])
  expect(next.flair!.zooms!.map((zoom) => zoom.anchor)).toEqual([
    { videoId: "v", sourceUs: 4, beatId: "b2" },
    { videoId: "v", sourceUs: 5, beatId: "b1" },
  ])
  expect(hasBeatless(next)).toBe(false)
})

test("a move saved before it knew its beat is given the beat its moment of speech plays in, like a cutaway, whether it moves the footage or a cutaway", () => {
  const move = (sourceUs: number, beatId?: string, insert?: boolean) => ({
    anchor: { kind: "speech" as const, videoId: "v", sourceUs, ...(beatId !== undefined ? { beatId } : {}) },
    ...(insert ? { insert: true } : {}),
    from: "light" as const,
    about: "ดันเข้า",
    poses: [{ s: 0, scale: 1.1, x: 0, y: 0, rot: 0, ease: "line" as const }],
    edited: false,
    off: false,
  })
  const stored = outline({ looks: {}, moves: [move(1), move(2, "b1"), move(3, undefined, true)] })
  expect(hasBeatless(stored)).toBe(true)
  const next = withBeats(stored, { cue: () => undefined, insert: () => "b2", zoom: () => undefined })
  expect(next.flair!.moves).toEqual([move(1, "b2"), move(2, "b1"), move(3, "b2", true)])
  expect(hasBeatless(next)).toBe(false)
})

test("what has no place on the cut now is left as it was, and nothing to settle changes nothing", () => {
  const stored = outline({ looks: {}, zooms: [{ anchor: { videoId: "v", sourceUs: 4 }, kind: "punch", edited: true }] })
  expect(withBeats(stored, { cue: () => undefined, insert: () => undefined, zoom: () => undefined })).toBe(stored)
  const settled = outline({ looks: {}, zooms: [{ anchor: { videoId: "v", sourceUs: 4, beatId: "b1" }, kind: "punch", edited: true }] })
  expect(hasBeatless(settled)).toBe(false)
  expect(withBeats(settled, everywhere)).toBe(settled)
  expect(withBeats(outline(undefined), everywhere)).toEqual(outline(undefined))
})

test("a graphic saved before it knew its beat is given the beat its moment of speech plays in, like a cutaway", () => {
  const spec = { kind: "motion" as const, version: "m", box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.8 }, seconds: 3, why: "", idea: "ป้ายเด้งขึ้น", words: [], html: null }
  const stored = outline({
    looks: {},
    graphics: [
      { anchor: { kind: "speech", videoId: "v", sourceUs: 3 }, spec, edited: true, off: false },
      { anchor: { kind: "speech", videoId: "v", sourceUs: 4, beatId: "b1" }, spec, edited: false, off: false },
    ],
  })
  expect(hasBeatless(stored)).toBe(true)
  const next = withBeats(stored, { cue: () => "nope", insert: (anchor) => (anchor.kind === "speech" && anchor.sourceUs === 3 ? "b2" : undefined), zoom: () => "nope" })
  expect(next.flair!.graphics!.map((graphic) => graphic.anchor)).toEqual([
    { kind: "speech", videoId: "v", sourceUs: 3, beatId: "b2" },
    { kind: "speech", videoId: "v", sourceUs: 4, beatId: "b1" },
  ])
  expect(hasBeatless(next)).toBe(false)
})

test("a composed sound saved before it knew its beat is given the beat its moment of speech plays in, like a graphic, and so is the moment of the graphic it is tied to", () => {
  const at = (sourceUs: number, beatId?: string): CueAnchor => ({ kind: "speech", videoId: "v", sourceUs, ...(beatId ? { beatId } : {}) })
  const sound = (anchor: CueAnchor, graphic?: CueAnchor): ComposedSound => ({
    anchor,
    ...(graphic ? { graphic, graphicHtml: "0123456789abcdef" } : {}),
    from: "medium",
    role: "เสียงติ๊ง",
    loudness: "normal",
    seconds: 1,
    words: [],
    code: null,
    version: SOUND_VERSION,
    off: false,
  })
  const find = { cue: () => "nope", insert: (anchor: CueAnchor) => (anchor.kind === "speech" && anchor.sourceUs === 3 ? "b2" : undefined), zoom: () => "nope" }
  const stored = outline({ looks: {}, composed: [sound(at(3)), sound(at(3), at(3)), sound(at(4, "b1")), sound(at(9))] })
  expect(hasBeatless(stored)).toBe(true)
  const next = withBeats(stored, find)
  expect(next.flair!.composed).toEqual([sound(at(3, "b2")), sound(at(3, "b2"), at(3, "b2")), sound(at(4, "b1")), sound(at(9))])
  // a sound whose own moment knows its beat but whose graphic's does not still has something to settle
  const tiedOnly = outline({ looks: {}, composed: [sound(at(3, "b2"), at(3))] })
  expect(hasBeatless(tiedOnly)).toBe(true)
  expect(withBeats(tiedOnly, find).flair!.composed).toEqual([sound(at(3, "b2"), at(3, "b2"))])
  const settled = outline({ looks: {}, composed: [sound(at(3, "b2"), at(3, "b2"))] })
  expect(hasBeatless(settled)).toBe(false)
  expect(withBeats(settled, find)).toBe(settled)
})

test("a stored composed entry that is no sound is left as it is, and does not stop the others being settled", () => {
  const odd = [null, { anchor: { kind: "speech", videoId: "v", sourceUs: 3 } }]
  const sound = { anchor: { kind: "speech", videoId: "v", sourceUs: 3 }, from: "medium", role: "", loudness: "normal", seconds: 1, words: [], code: null, version: SOUND_VERSION, off: false }
  const stored = outline({ looks: {}, composed: [...odd, sound] as unknown as ComposedSound[] })
  expect(hasBeatless(stored)).toBe(true)
  const find = { cue: () => "nope", insert: () => "b2", zoom: () => "nope" }
  expect(withBeats(stored, find).flair!.composed).toEqual([...odd, { ...sound, anchor: { ...sound.anchor, beatId: "b2" } }])
  expect(hasBeatless(outline({ looks: {}, composed: odd as unknown as ComposedSound[] }))).toBe(false)
})
