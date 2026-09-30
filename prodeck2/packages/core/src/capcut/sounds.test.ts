import { expect, test } from "vitest"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { binVideos, loadDraft } from "./read.ts"
import { buildRoughCut } from "./rough-cut.ts"
import { addSoundTrack, type TimelineSoundCue } from "./sounds.ts"
import type { DraftInfo } from "./types.ts"

const CLIP_A = "8efd5c3a-62ad-4e1b-9ea9-7b603c267884"

/** The fixture draft (30 fps) after a 9.5 s rough cut. */
async function roughCut(): Promise<DraftInfo> {
  const draft = await loadDraft(join(await makeDraftRoot(), "0917"))
  return buildRoughCut(draft.info, [{ binId: CLIP_A, sourceStartUs: 0, sourceDurationUs: 9_500_000 }], binVideos(draft.meta))
}

type Entry = { id: string; [key: string]: unknown }
const list = (info: DraftInfo, key: string) => (info.materials[key] ?? []) as Entry[]
const audioTracks = (info: DraftInfo) => info.tracks.filter((track) => track.type === "audio")

const pop: TimelineSoundCue = { atUs: 1_000_000, effectId: "7167077030767364097", name: "Popping sound", path: "/cache/music/pop.mp3", durationUs: 333_333 }
const call: TimelineSoundCue = { atUs: 4_000_000, effectId: "6817500870616287233", name: "Incoming call", path: "/cache/music/call.mp3", durationUs: 6_000_000 }
const lost: TimelineSoundCue = { atUs: 7_000_000, effectId: "6993230936993204226", name: "ฟิ้ว", path: null, durationUs: 433_333 }

test("a cue becomes a sound material and a segment at its time", async () => {
  const out = addSoundTrack(await roughCut(), [pop]).info
  expect(out.tracks.map((track) => track.type)).toEqual(["video", "audio"])
  const [track] = audioTracks(out)
  expect(track).toMatchObject({ type: "audio", flag: 0, attribute: 0, name: "", is_default_name: true })

  const [segment] = track!.segments
  expect(segment).toMatchObject({
    source_timerange: { start: 0, duration: 333_333 },
    target_timerange: { start: 1_000_000, duration: 333_333 },
    volume: 0.6,
    last_nonzero_volume: 0.6,
    clip: null,
    render_index: 0,
    track_render_index: 1,
    visible: true,
  })

  const material = list(out, "audios").find((entry) => entry.id === segment!.material_id)!
  expect(material).toMatchObject({
    type: "sound",
    name: "Popping sound",
    effect_id: "7167077030767364097",
    path: "/cache/music/pop.mp3",
    duration: 333_333,
    category_id: "7313820083586190081",
  })
})

test("a long sound is cut to 1.5 s and fades out; a short one is left alone", async () => {
  const out = addSoundTrack(await roughCut(), [pop, call]).info
  const [short, long] = audioTracks(out)[0]!.segments
  expect(short!.target_timerange.duration).toBe(333_333)
  expect(long!.target_timerange.duration).toBe(1_500_000)

  const fades = list(out, "audio_fades")
  const fadeOf = (segment: (typeof short)[]) => fades.find((fade) => segment![0]!.extra_material_refs.includes(fade.id))!
  expect(fadeOf([short!]).fade_out_duration).toBe(0)
  expect(fadeOf([long!]).fade_out_duration).toBe(200_000)
})

test("a sound whose file is gone is still written, by its id", async () => {
  const out = addSoundTrack(await roughCut(), [lost]).info
  const material = list(out, "audios")[0]!
  expect(material).toMatchObject({ path: "", effect_id: "6993230936993204226" })
})

test("a cue with no room left on the timeline is left out", async () => {
  const info = await roughCut()
  expect(info.duration).toBe(9_500_000)
  const { info: out, kept, dropped } = addSoundTrack(info, [{ ...pop, atUs: 9_500_000 }, { ...pop, atUs: 12_000_000 }, { ...pop, atUs: -100_000 }])
  expect(out.tracks.map((track) => track.type)).toEqual(["video"])
  expect([kept, dropped]).toEqual([0, 3])

  // one that starts just before the end plays only as long as there is room
  const tail = addSoundTrack(info, [{ ...pop, atUs: 9_400_000 }]).info
  expect(audioTracks(tail)[0]!.segments[0]!.target_timerange).toEqual({ start: 9_400_000, duration: 100_000 })
})

test("a cue a hair before the start, from rounding the first piece to its frame, plays from the start", async () => {
  // the first piece's source start was rounded up to a frame, so its own start maps just below zero
  const out = addSoundTrack(await roughCut(), [{ ...pop, atUs: -1_667 }]).info
  expect(audioTracks(out)[0]!.segments[0]!.target_timerange.start).toBe(0)
})

test("cues go on one track in time order, with their own extra materials", async () => {
  const out = addSoundTrack(await roughCut(), [lost, pop, call]).info
  const [track] = audioTracks(out)
  expect(track!.segments.map((segment) => segment.target_timerange.start)).toEqual([1_000_000, 4_000_000, 7_000_000])

  for (const segment of track!.segments) {
    expect(segment.extra_material_refs).toHaveLength(6)
    const kinds = segment.extra_material_refs.map((ref) => {
      for (const key of ["speeds", "placeholder_infos", "beats", "sound_channel_mappings", "vocal_separations", "audio_fades"]) {
        if (list(out, key).some((entry) => entry.id === ref)) return key
      }
      return "?"
    })
    expect(kinds).toEqual(["speeds", "placeholder_infos", "beats", "sound_channel_mappings", "vocal_separations", "audio_fades"])
  }

  const ids = [...track!.segments.map((segment) => segment.id), ...list(out, "audios").map((entry) => entry.id)]
  expect(new Set(ids).size).toBe(ids.length)
})

test("a sound that starts before the one before it has ended goes on a second track, so both play whole", async () => {
  // two highlight lines under a second apart, each with its pop
  const first: TimelineSoundCue = { ...pop, atUs: 150_000, durationUs: 1_000_000 }
  const second: TimelineSoundCue = { ...lost, atUs: 1_070_000, durationUs: 1_000_000 }
  const later: TimelineSoundCue = { ...pop, atUs: 2_500_000, durationUs: 1_000_000 }
  const info = await roughCut()
  const out = addSoundTrack(info, [second, later, first]).info
  const tracks = audioTracks(out)
  // each on its frame at 30 fps: 150 ms is frame 4.5, so 5; 1.07 s is frame 32.1, so 32
  expect(tracks.map((track) => track.segments.map((segment) => segment.target_timerange.start))).toEqual([[166_666, 2_500_000], [1_066_666]])
  for (const track of tracks) {
    const spans = track.segments.map((segment) => [segment.target_timerange.start, segment.target_timerange.start + segment.target_timerange.duration])
    for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1]!)
  }
  // each track draws in its own place, after everything that was there already
  expect(tracks.map((track) => track.segments[0]!.track_render_index)).toEqual([info.tracks.length, info.tracks.length + 1])
  expect(tracks[1]!.segments[0]!.target_timerange.duration).toBe(1_000_000)
})

test("sounds already on the timeline are left where they are", async () => {
  const first = addSoundTrack(await roughCut(), [pop]).info
  const second = addSoundTrack(first, [lost]).info
  expect(list(second, "audios").map((entry) => entry.effect_id)).toEqual([pop.effectId, lost.effectId])
  expect(audioTracks(second)).toHaveLength(2)
  expect(list(second, "audio_fades")).toHaveLength(2)
})

test("no cues, no track, and what was there already is left alone", async () => {
  const info = await roughCut()
  const out = addSoundTrack(info, []).info
  expect(out.tracks).toEqual(info.tracks)
  expect(out.materials.audios).toEqual(info.materials.audios)
})

test("the writer says how many sounds it placed and how many had no room", async () => {
  const info = await roughCut()
  // one at the very end and one before the start have no room; the other two play
  expect(addSoundTrack(info, [pop, { ...pop, atUs: 9_500_000 }, { ...pop, atUs: -100_000 }, call])).toMatchObject({ kept: 2, dropped: 2 })
  expect(addSoundTrack(info, [])).toMatchObject({ kept: 0, dropped: 0 })
})
