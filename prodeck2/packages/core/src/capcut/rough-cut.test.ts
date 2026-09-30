import { test } from "vitest"
import assert from "node:assert/strict"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut, outputCanvas } from "./rough-cut.ts"
import type { BinVideo, Cut, DraftInfo, Segment } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"
const CLIP_B: BinVideo = {
  id: "0b0b0b0b-0000-4000-8000-000000000002",
  path: "/fixture/media/B.mp4",
  name: "B.mp4",
  durationUs: 10_000_000,
  width: 1920,
  height: 1080,
}

async function fixture(): Promise<{ info: DraftInfo; bin: BinVideo[] }> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  return { info: draft.info, bin: [...binVideos(draft.meta), CLIP_B] }
}

const cuts: Cut[] = [
  { binId: CLIP_A, sourceStartUs: 10_000_000, sourceDurationUs: 4_000_000 },
  { binId: CLIP_B.id, sourceStartUs: 1_000_000, sourceDurationUs: 2_500_000 },
  { binId: CLIP_A, sourceStartUs: 2_000_000, sourceDurationUs: 3_000_000 },
]

function mainSegments(info: DraftInfo): Segment[] {
  assert.equal(info.tracks.length, 1)
  const track = info.tracks[0]!
  assert.equal(track.type, "video")
  return track.segments
}

function materialList(info: DraftInfo, key: string): { id: string; [k: string]: unknown }[] {
  return info.materials[key] as { id: string; [k: string]: unknown }[]
}

test("buildRoughCut lays the cuts end to end on a single video track", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  assert.deepEqual(
    mainSegments(out).map((s) => s.target_timerange),
    [
      { start: 0, duration: 4_000_000 },
      { start: 4_000_000, duration: 2_500_000 },
      { start: 6_500_000, duration: 3_000_000 },
    ],
  )
  assert.equal(out.duration, 9_500_000)
})

test("buildRoughCut keeps each cut's position inside its source file", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  assert.deepEqual(
    mainSegments(out).map((s) => s.source_timerange),
    [
      { start: 10_000_000, duration: 4_000_000 },
      { start: 1_000_000, duration: 2_500_000 },
      { start: 2_000_000, duration: 3_000_000 },
    ],
  )
})

test("buildRoughCut snaps cut boundaries to frames the way CapCut does", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, [{ binId: CLIP_A, sourceStartUs: 766_700, sourceDurationUs: 1_833_300 }], bin)
  const [segment] = mainSegments(out)
  // frames 23..78 @30fps — the exact pair CapCut 9.2 wrote for the same span in a real draft
  assert.deepEqual(segment!.source_timerange, { start: 766_666, duration: 1_833_334 })
  assert.deepEqual(segment!.target_timerange, { start: 0, duration: 1_833_333 })
})

test("buildRoughCut keeps a cut that ends at the end of its file inside the file", async () => {
  const { info, bin } = await fixture()
  const odd: BinVideo = { ...CLIP_B, id: "odd", durationUs: 10_020_000 } // 300.6 frames
  const out = buildRoughCut(info, [{ binId: "odd", sourceStartUs: 9_000_000, sourceDurationUs: 1_020_000 }], [...bin, odd])
  assert.deepEqual(mainSegments(out)[0]!.source_timerange, { start: 9_000_000, duration: 1_000_000 })
})

test("buildRoughCut gives every segment its own video material, even for the same file", async () => {
  // CapCut 9.4 re-saved a shared material as three copies with one id (M0 spike, 2026-09-17);
  // real drafts hold one material per segment (0815: one file, eight materials)
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  const videos = materialList(out, "videos")
  const segments = mainSegments(out)
  assert.equal(videos.length, cuts.length)
  assert.equal(new Set(segments.map((s) => s.material_id)).size, cuts.length)
  const material = (s: Segment) => videos.find((v) => v.id === s.material_id)!
  assert.deepEqual(
    segments.map((s) => [material(s).path, material(s).local_material_id]),
    [
      ["/fixture/media/IMG_9646.MOV", CLIP_A],
      ["/fixture/media/B.mp4", CLIP_B.id],
      ["/fixture/media/IMG_9646.MOV", CLIP_A],
    ],
  )
})

test("buildRoughCut copies the bin item's file facts into the video material", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  const a = materialList(out, "videos")[0]!
  assert.equal(a.material_name, "IMG_9646.MOV")
  assert.equal(a.duration, 31_106_000)
  assert.deepEqual([a.width, a.height], [1080, 1920])
})

test("buildRoughCut writes the segment fields CapCut 9.4 adds on save", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  assert.equal(mainSegments(out)[0]!.hdr_vivid_settings, null)
})

test("buildRoughCut gives every segment the extra materials CapCut expects, all resolvable", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  const allIds = new Set(
    Object.values(out.materials).flatMap((list) => (Array.isArray(list) ? list.map((m) => (m as { id: string }).id) : [])),
  )
  for (const segment of mainSegments(out)) {
    assert.equal(segment.extra_material_refs.length, 6)
    for (const ref of segment.extra_material_refs) assert.ok(allIds.has(ref), `dangling ref ${ref}`)
  }
  for (const key of ["speeds", "placeholder_infos", "canvases", "sound_channel_mappings", "material_colors", "vocal_separations"]) {
    assert.equal(materialList(out, key).length, cuts.length, key)
  }
})

test("buildRoughCut never reuses an id", async () => {
  const { info, bin } = await fixture()
  const out = buildRoughCut(info, cuts, bin)
  const ids = [
    ...out.tracks.map((t) => t.id),
    ...mainSegments(out).map((s) => s.id),
    ...Object.values(out.materials).flatMap((list) => (Array.isArray(list) ? list.map((m) => (m as { id: string }).id) : [])),
  ]
  assert.equal(new Set(ids).size, ids.length)
})

test("buildRoughCut sizes an 'original' ratio canvas to the first clip", async () => {
  const { info, bin } = await fixture()
  assert.deepEqual([info.canvas_config.width, info.canvas_config.height], [1920, 1080])
  const out = buildRoughCut(info, cuts, bin)
  assert.deepEqual([out.canvas_config.width, out.canvas_config.height], [1080, 1920])
})

test("buildRoughCut wipes whatever was on the timeline before", async () => {
  const { info, bin } = await fixture()
  const dirty: DraftInfo = {
    ...info,
    tracks: [{ id: "OLD-TRACK", type: "text", segments: [] }],
    materials: { ...info.materials, texts: [{ id: "OLD-TEXT" }] },
    keyframes: { ...info.keyframes, texts: [{ id: "OLD-KF" }] },
  }
  const out = buildRoughCut(dirty, cuts, bin)
  assert.deepEqual(out.materials.texts, [])
  assert.deepEqual(out.keyframes.texts, [])
  assert.ok(!out.tracks.some((t) => t.id === "OLD-TRACK"))
})

test("buildRoughCut carries fields it does not understand through untouched", async () => {
  const { info, bin } = await fixture()
  const withFuture: DraftInfo = { ...info, some_future_field: { keep: true } }
  const out = buildRoughCut(withFuture, cuts, bin)
  assert.deepEqual(out.some_future_field, { keep: true })
  assert.deepEqual(out.platform, info.platform)
  assert.equal(out.id, info.id)
})

test("buildRoughCut does not mutate its input", async () => {
  const { info, bin } = await fixture()
  const before = structuredClone(info)
  buildRoughCut(info, cuts, bin)
  assert.deepEqual(info, before)
})

test("buildRoughCut rejects a cut that points at a file not in the bin", async () => {
  const { info, bin } = await fixture()
  assert.throws(
    () => buildRoughCut(info, [{ binId: "missing", sourceStartUs: 0, sourceDurationUs: 1_000_000 }], bin),
    /missing/,
  )
})

test("buildRoughCut rejects a cut that runs past the end of its source file", async () => {
  const { info, bin } = await fixture()
  assert.throws(
    () => buildRoughCut(info, [{ binId: CLIP_B.id, sourceStartUs: 9_000_000, sourceDurationUs: 2_000_000 }], bin),
    /past the end/,
  )
})

test("buildRoughCut rejects a cut shorter than one frame", async () => {
  const { info, bin } = await fixture()
  assert.throws(
    () => buildRoughCut(info, [{ binId: CLIP_B.id, sourceStartUs: 0, sourceDurationUs: 10_000 }], bin),
    /shorter than one frame/,
  )
})

test("buildRoughCut rejects an empty cut list", async () => {
  const { info, bin } = await fixture()
  assert.throws(() => buildRoughCut(info, [], bin), /no cuts/)
})

test("outputCanvas is the first clip's size when the draft follows the footage, and the draft's own size otherwise", async () => {
  const { info, bin } = await fixture()
  const portrait = bin[0]!
  assert.equal(info.canvas_config.ratio, "original")
  assert.deepEqual(outputCanvas(info, portrait), { width: portrait.width, height: portrait.height })
  const fixed = { ...info, canvas_config: { ...info.canvas_config, ratio: "16:9", width: 1920, height: 1080 } }
  assert.deepEqual(outputCanvas(fixed, portrait), { width: 1920, height: 1080 })
})
