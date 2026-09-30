import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import { addSubtitleTrack, type TimelineCaption } from "./subtitles.ts"
import type { DraftInfo, Segment } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/** The fixture draft (30 fps) after a 9.5 s rough cut, as the writer would have it. */
async function roughCut(): Promise<DraftInfo> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  return buildRoughCut(
    draft.info,
    [
      { binId: CLIP_A, sourceStartUs: 10_000_000, sourceDurationUs: 4_000_000 },
      { binId: CLIP_A, sourceStartUs: 2_000_000, sourceDurationUs: 5_500_000 },
    ],
    binVideos(draft.meta),
  )
}

type Entry = { id: string; [key: string]: unknown }
const list = (info: DraftInfo, key: string) => (info.materials[key] ?? []) as Entry[]
const textTrack = (info: DraftInfo) => info.tracks.find((track) => track.type === "text")
const times = (segments: Segment[]) => segments.map((segment) => [segment.target_timerange.start, segment.target_timerange.duration])

const captions: TimelineCaption[] = [
  { startUs: 500_000, endUs: 2_000_000, text: "สวัสดีครับ" },
  { startUs: 2_200_000, endUs: 4_000_000, text: "Hello ทดสอบซับ" },
]

test("captions go on one text track above the video, as a caption group CapCut can restyle all at once", async () => {
  const info = await roughCut()
  const out = addSubtitleTrack(info, captions, "boxblack_1789645411052")

  expect(out.tracks.map((track) => track.type)).toEqual(["video", "text"])
  const track = textTrack(out)!
  expect(track).toMatchObject({ type: "text", flag: 1, attribute: 0, name: "", is_default_name: true })
  expect(times(track.segments)).toEqual([
    [500_000, 1_500_000],
    [2_200_000, 1_800_000],
  ])

  const texts = list(out, "texts")
  expect(texts).toHaveLength(2)
  track.segments.forEach((segment, i) => {
    expect(segment.source_timerange).toBeNull()
    expect(segment).toMatchObject({ clip: { transform: { x: 0, y: -0.8 } }, render_index: 14000, track_render_index: 1, visible: true })
    const material = texts.find((text) => text.id === segment.material_id)!
    expect(material).toMatchObject({
      type: "subtitle",
      group_id: "boxblack_1789645411052",
      add_type: 2,
      text_color: "#FFFFFF",
      border_color: "#000000",
      check_flag: 15,
    })
    const content = JSON.parse(material.content as string)
    expect(content.text).toBe(captions[i]!.text)
    expect(content.styles).toHaveLength(1)
    expect(content.styles[0]).toMatchObject({
      range: [0, captions[i]!.text.length],
      fill: { content: { solid: { color: [1, 1, 1] }, render_type: "solid" } },
      strokes: [{ width: 0.08, mode: 0, content: { solid: { color: [0, 0, 0] }, render_type: "solid" } }],
    })
    const [animationId] = segment.extra_material_refs
    expect(segment.extra_material_refs).toHaveLength(1)
    expect(list(out, "material_animations").find((entry) => entry.id === animationId)).toEqual({
      id: animationId,
      type: "sticker_animation",
      animations: [],
      multi_language_current: "none",
    })
  })
  const ids = [...track.segments.map((s) => s.id), ...texts.map((t) => t.id), ...list(out, "material_animations").map((a) => a.id)]
  expect(new Set(ids).size).toBe(ids.length)
})

test("the text style range counts UTF-16 code units, as CapCut does", async () => {
  const out = addSubtitleTrack(await roughCut(), [{ startUs: 0, endUs: 1_000_000, text: "Hi 👋" }], "g")
  expect(JSON.parse(list(out, "texts")[0]!.content as string).styles[0].range).toEqual([0, 5])
})

test("caption edges land on frames, and captions never overlap", async () => {
  const out = addSubtitleTrack(
    await roughCut(),
    [
      { startUs: 1_010_000, endUs: 2_490_000, text: "หนึ่ง" },
      { startUs: 2_400_000, endUs: 3_000_000, text: "สอง" },
    ],
    "g",
  )
  // 30 fps: 1.01 s is frame 30, 2.49 s frame 75; the second caption waits for the first to end
  expect(times(textTrack(out)!.segments)).toEqual([
    [1_000_000, 1_500_000],
    [2_500_000, 500_000],
  ])
})

test("captions end with the timeline; blank ones and ones shorter than a frame are left out", async () => {
  const info = await roughCut()
  expect(info.duration).toBe(9_500_000)
  const out = addSubtitleTrack(
    info,
    [
      { startUs: 0, endUs: 1_000_000, text: "   " },
      { startUs: 1_000_000, endUs: 1_010_000, text: "สั้น" },
      { startUs: 9_000_000, endUs: 10_000_000, text: " ท้าย " },
      { startUs: 9_600_000, endUs: 11_000_000, text: "เลยไปแล้ว" },
    ],
    "g",
  )
  expect(times(textTrack(out)!.segments)).toEqual([[9_000_000, 500_000]])
  expect(JSON.parse(list(out, "texts")[0]!.content as string).text).toBe("ท้าย")
})

test("with nothing to show, the draft is left as it was", async () => {
  const info = await roughCut()
  expect(addSubtitleTrack(info, [], "g")).toEqual(info)
  expect(addSubtitleTrack(info, [{ startUs: 0, endUs: 1_000_000, text: "" }], "g")).toEqual(info)
})

test("captions given out of order are placed by time", async () => {
  const out = addSubtitleTrack(await roughCut(), [...captions].reverse(), "g")
  expect(times(textTrack(out)!.segments)).toEqual([
    [500_000, 1_500_000],
    [2_200_000, 1_800_000],
  ])
})

test("the video track and its materials are not touched, and the input is not modified", async () => {
  const info = await roughCut()
  info.materials.texts = [{ id: "EXISTING-TEXT" }]
  const before = structuredClone(info)
  const out = addSubtitleTrack(info, captions, "g")
  expect(info).toEqual(before)
  expect(out.tracks[0]).toEqual(info.tracks[0])
  for (const key of Object.keys(info.materials).filter((key) => key !== "texts" && key !== "material_animations")) {
    expect(out.materials[key], key).toEqual(info.materials[key])
  }
  expect(list(out, "texts").map((text) => text.id)).toContain("EXISTING-TEXT")
  expect(out.duration).toBe(info.duration)
})
