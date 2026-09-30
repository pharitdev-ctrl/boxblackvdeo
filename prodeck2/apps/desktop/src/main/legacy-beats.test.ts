import { expect, test } from "vitest"
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
