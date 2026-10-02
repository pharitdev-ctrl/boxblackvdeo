import { expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { addComposedSoundTrack, type TimelineComposedSound } from "./composed-sounds.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import { addSoundTrack } from "./sounds.ts"
import type { DraftInfo } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/** The fixture draft (30 fps, one video track) after a 9.5 s rough cut. */
async function roughCut(): Promise<DraftInfo> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  return buildRoughCut(draft.info, [{ binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 9_500_000 }], binVideos(draft.meta))
}

type Entry = { id: string; [key: string]: unknown }
const list = (info: DraftInfo, key: string) => (info.materials[key] ?? []) as Entry[]
/** What a write added to the end of one of the draft's material lists. */
const added = (before: DraftInfo, after: DraftInfo, key: string) => list(after, key).slice(list(before, key).length)
const audioTracks = (info: DraftInfo) => info.tracks.filter((track) => track.type === "audio")

// what CapCut 9.5 wrote for a local WAV dragged onto the timeline (Task 1 of 0.6.0), with the ids
// and the path replaced: the writer must give these shapes field by field, in CapCut's key order
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/local-wav/${name}.json`, import.meta.url), "utf8")) as Entry
const MATERIAL = fixture("material")
const EXTRAS = fixture("extras") as unknown as Record<string, Entry>
const SEGMENT = fixture("segment")
const TRACK = fixture("track")
/** The extra materials a sound's segment points at, in the order CapCut lists them. */
const EXTRA_KEYS = ["speeds", "placeholder_infos", "beats", "sound_channel_mappings", "vocal_separations"]

const UPPER_UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX_32 = /^[0-9a-f]{32}$/

/** The fixture's own sound: a 4 s WAV in BOXBLACK's sounds folder, at the start, imported as the fixture's bin item. */
const wav: TimelineComposedSound = {
  atUs: 0,
  durationUs: MATERIAL.duration as number,
  path: MATERIAL.path as string,
  binId: MATERIAL.local_material_id as string,
}

/** Makes UUIDs in turn, lower-case with letters in them, so each id's case shows which way it was cut. */
function counter(): () => string {
  let made = 0
  return () => `abcdef00-0000-4000-8000-${String(++made).padStart(12, "0")}`
}

test("a composed sound is written as CapCut 9.5 wrote a local WAV, field by field", async () => {
  const info = await roughCut()
  expect(info.tracks).toHaveLength(1)
  const out = addComposedSoundTrack(info, [wav]).info

  const [material, ...others] = added(info, out, "audios")
  expect(others).toEqual([])
  expect(material!.id).toMatch(UPPER_UUID)
  expect(material!.unique_id).toMatch(HEX_32)
  expect(material!.music_id).toMatch(LOWER_UUID)
  expect(material).toEqual({ ...MATERIAL, id: material!.id, unique_id: material!.unique_id, music_id: material!.music_id })
  expect(Object.keys(material!)).toEqual(Object.keys(MATERIAL))

  const extras = EXTRA_KEYS.map((key) => {
    const entries = added(info, out, key)
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.id).toMatch(UPPER_UUID)
    expect(entry).toEqual({ ...EXTRAS[key], id: entry.id })
    expect(Object.keys(entry)).toEqual(Object.keys(EXTRAS[key]!))
    return entry
  })

  expect(out.tracks).toHaveLength(2)
  const { segments, ...track } = out.tracks[1]!
  expect(track.id).toMatch(UPPER_UUID)
  expect(track).toEqual({ ...TRACK, id: track.id })
  expect(Object.keys(out.tracks[1]!)).toEqual([...Object.keys(TRACK), "segments"])

  // the fixture's segment sits at 0 on the track above the one video track, as this one does
  expect(segments).toHaveLength(1)
  const segment = segments[0]!
  expect(segment.id).toMatch(UPPER_UUID)
  expect(segment).toEqual({ ...SEGMENT, id: segment.id, material_id: material!.id, extra_material_refs: extras.map((entry) => entry.id) })
  expect(Object.keys(segment)).toEqual(Object.keys(SEGMENT))
})

test("the material is named after its file and points at the bin item it is given", async () => {
  const path = "/Users/x/Movies/CapCut/BOXBLACK/sounds/ab12cd34ef56ab78.wav"
  const info = await roughCut()
  const out = addComposedSoundTrack(info, [{ atUs: 1_000_000, durationUs: 2_500_000, path, binId: "0f0f0f0f-1111-4222-8333-444444444444" }]).info
  expect(added(info, out, "audios")[0]).toMatchObject({
    name: "ab12cd34ef56ab78.wav",
    path,
    duration: 2_500_000,
    local_material_id: "0f0f0f0f-1111-4222-8333-444444444444",
  })
})

test("a composed sound is not a library sound, so the sound library never counts it", async () => {
  const library = { atUs: 1_000_000, effectId: "7167077030767364097", name: "Popping sound", path: "/cache/music/pop.mp3", durationUs: 333_333 }
  const out = addComposedSoundTrack(addSoundTrack(await roughCut(), [library]).info, [{ ...wav, atUs: 3_000_000 }]).info
  // the type is the guard: the sound library reads only "sound" materials (it would also skip this one
  // for its empty effect_id, so asking soundsInDraft could not catch a wrong type)
  expect(list(out, "audios").map((entry) => entry.type)).toEqual(["sound", "extract_music"])
})

test("a sound whose length is not a positive number is left out", async () => {
  const info = await roughCut()
  const written = addComposedSoundTrack(info, [{ ...wav, durationUs: Number.NaN }, { ...wav, atUs: 1_000_000, durationUs: 0 }, { ...wav, atUs: 2_000_000 }])
  expect([written.kept, written.dropped]).toEqual([1, 2])
  expect(audioTracks(written.info).flatMap((track) => track.segments.map((segment) => segment.target_timerange))).toEqual([{ start: 2_000_000, duration: 4_000_000 }])
  expect(added(info, written.info, "audios").map((entry) => entry.duration)).toEqual([4_000_000])
})

test("a long sound plays whole, at full volume, with no fade", async () => {
  const info = await roughCut()
  const out = addComposedSoundTrack(info, [{ ...wav, atUs: 1_000_000, durationUs: 6_000_000 }]).info
  const [segment] = audioTracks(out)[0]!.segments
  expect(segment).toMatchObject({
    source_timerange: { start: 0, duration: 6_000_000 },
    target_timerange: { start: 1_000_000, duration: 6_000_000 },
    volume: 1,
    last_nonzero_volume: 1,
  })
  expect(segment!.extra_material_refs).toHaveLength(5)
  expect(out.materials.audio_fades).toEqual(info.materials.audio_fades)
})

test("each start lands on a frame, and a hair before the start is the start", async () => {
  const out = addComposedSoundTrack(await roughCut(), [
    // 150 ms is frame 4.5 at 30 fps, so 5
    { ...wav, atUs: 150_000, durationUs: 500_000 },
    // the first piece's source start was rounded up to a frame, so its own start maps just below zero
    { ...wav, atUs: -1_667, durationUs: 100_000 },
  ]).info
  expect(audioTracks(out)[0]!.segments.map((segment) => segment.target_timerange.start)).toEqual([0, 166_666])
})

test("a sound near the end plays only as long as there is room; one with no room, or before the start, is left out", async () => {
  const info = await roughCut()
  expect(info.duration).toBe(9_500_000)
  const written = addComposedSoundTrack(info, [{ ...wav, atUs: 9_500_000 }, { ...wav, atUs: 12_000_000 }, { ...wav, atUs: -100_000 }])
  expect(written.info.tracks).toEqual(info.tracks)
  expect([written.kept, written.dropped]).toEqual([0, 3])

  const tail = addComposedSoundTrack(info, [{ ...wav, atUs: 9_400_000 }])
  expect([tail.kept, tail.dropped]).toEqual([1, 0])
  expect(audioTracks(tail.info)[0]!.segments[0]).toMatchObject({ source_timerange: { start: 0, duration: 100_000 }, target_timerange: { start: 9_400_000, duration: 100_000 } })
  // the material is still the whole file, and the cut is not faded
  expect(added(info, tail.info, "audios")[0]!.duration).toBe(4_000_000)
  expect(tail.info.materials.audio_fades).toEqual(info.materials.audio_fades)
})

test("a sound that starts while another still plays goes on the first free lane, each lane its own audio track", async () => {
  const info = await roughCut()
  const first = { ...wav, atUs: 0, durationUs: 2_000_000 }
  const second = { ...wav, atUs: 1_000_000, durationUs: 2_000_000 }
  const third = { ...wav, atUs: 2_500_000, durationUs: 1_000_000 }
  const written = addComposedSoundTrack(info, [third, second, first])
  const tracks = audioTracks(written.info)
  // the first lane is free again by 2.5 s, so the third goes back on it
  expect(tracks.map((track) => track.segments.map((segment) => segment.target_timerange.start))).toEqual([[0, 2_500_000], [1_000_000]])
  expect(tracks.map((track) => ({ type: track.type, flag: track.flag, attribute: track.attribute }))).toEqual([
    { type: "audio", flag: 0, attribute: 0 },
    { type: "audio", flag: 0, attribute: 0 },
  ])
  // each track draws in its own place, after everything that was there already
  expect(tracks.map((track) => track.segments.map((segment) => segment.track_render_index))).toEqual([
    [info.tracks.length, info.tracks.length],
    [info.tracks.length + 1],
  ])
  expect([written.kept, written.dropped]).toEqual([3, 0])
})

test("sounds and tracks already in the draft are left where they are", async () => {
  const library = { atUs: 1_000_000, effectId: "7167077030767364097", name: "Popping sound", path: "/cache/music/pop.mp3", durationUs: 333_333 }
  const before = addSoundTrack(await roughCut(), [library]).info
  const out = addComposedSoundTrack(before, [{ ...wav, atUs: 1_000_000 }]).info
  expect(out.tracks.slice(0, before.tracks.length)).toEqual(before.tracks)
  for (const key of [...EXTRA_KEYS, "audios"]) {
    expect(list(out, key).slice(0, list(before, key).length)).toEqual(list(before, key))
    expect(added(before, out, key)).toHaveLength(1)
  }
  expect(out.materials.audio_fades).toEqual(before.materials.audio_fades)
})

test("no sounds, no track, and nothing changes", async () => {
  const info = await roughCut()
  const written = addComposedSoundTrack(info, [])
  expect(written).toEqual({ info, kept: 0, dropped: 0 })
})

test("the draft passed in is left untouched", async () => {
  const info = await roughCut()
  const copy = structuredClone(info)
  addComposedSoundTrack(info, [wav, { ...wav, atUs: 1_000_000 }])
  expect(info).toEqual(copy)
})

test("every id comes from the maker it is given, in the case CapCut uses, so a write can be repeated exactly", async () => {
  const info = await roughCut()
  const sounds = [wav, { ...wav, atUs: 1_000_000 }]
  const out = addComposedSoundTrack(info, sounds, counter()).info
  expect(addComposedSoundTrack(info, sounds, counter()).info).toEqual(out)

  const materials = added(info, out, "audios")
  const extras = EXTRA_KEYS.flatMap((key) => added(info, out, key))
  const tracks = audioTracks(out)
  const segments = tracks.flatMap((track) => track.segments)
  const upper = [...materials, ...extras, ...tracks, ...segments].map((entry) => entry.id)
  for (const id of upper) expect(id).toMatch(/^ABCDEF00-0000-4000-8000-\d{12}$/)
  for (const material of materials) {
    expect(material.music_id).toMatch(/^abcdef00-0000-4000-8000-\d{12}$/)
    expect(material.unique_id).toMatch(/^abcdef00000040008000\d{12}$/)
  }
  // the bin item's id is the caller's
  expect(materials.map((material) => material.local_material_id)).toEqual([wav.binId, wav.binId])

  const all = [...upper, ...materials.map((material) => material.music_id), ...materials.map((material) => material.unique_id)]
  expect(all).toHaveLength(2 + 2 * 5 + 2 + 2 + 2 + 2)
  expect(new Set(all.map((id) => String(id).toLowerCase().replaceAll("-", ""))).size).toBe(all.length)
})

test("with no maker given, each write mints fresh ids of the right shape", async () => {
  const info = await roughCut()
  const one = added(info, addComposedSoundTrack(info, [wav]).info, "audios")[0]!
  const two = added(info, addComposedSoundTrack(info, [wav]).info, "audios")[0]!
  for (const material of [one, two]) {
    expect(material.id).toMatch(UPPER_UUID)
    expect(material.music_id).toMatch(LOWER_UUID)
    expect(material.unique_id).toMatch(HEX_32)
  }
  expect([one.id, one.music_id, one.unique_id]).not.toEqual([two.id, two.music_id, two.unique_id])
})
