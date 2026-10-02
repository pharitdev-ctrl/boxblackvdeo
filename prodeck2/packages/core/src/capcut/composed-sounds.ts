import { randomUUID } from "node:crypto"
import { basename } from "node:path"
import { audioTrack, placeSounds, withMaterials } from "./sounds.ts"
import type { DraftInfo, Segment, Written } from "./types.ts"

/** A composed sound to lay on the rough cut: a WAV BOXBLACK rendered, and the bin item it was imported as. */
export interface TimelineComposedSound {
  atUs: number
  /** the file's own length */
  durationUs: number
  /** the WAV, in BOXBLACK's sounds folder */
  path: string
  /** the bin item (soundBinItem), which the material points at with `local_material_id` */
  binId: string
}

/** Its loudness was set when it was rendered, so it plays as it is. */
const VOLUME = 1

/**
 * The ids a write needs, each cut from a fresh UUID in the case CapCut 9.5 used for a local WAV
 * (Task 1 of 0.6.0): upper-case for the material, its extra materials, the segment and the track;
 * lower-case for `music_id`; and 32 hex digits for `unique_id`, a UUID without its dashes, as
 * `videoMaterial` makes one.
 */
function idsFrom(newId: () => string) {
  return {
    upper: () => newId().toUpperCase(),
    lower: () => newId().toLowerCase(),
    hex: () => newId().replaceAll("-", "").toLowerCase(),
  }
}

/**
 * A local WAV's material, with every field CapCut 9.5 writes for a file the user imported, in its
 * order. It is `extract_music` from the `local` category, never a library `sound`, so the sound
 * library (soundsInDraft) never counts it and no Pro check ever sees it.
 */
function wavMaterial(args: { id: string; uniqueId: string; musicId: string; sound: TimelineComposedSound }) {
  const { sound } = args
  return {
    id: args.id,
    unique_id: args.uniqueId,
    type: "extract_music",
    name: basename(sound.path),
    duration: sound.durationUs,
    path: sound.path,
    category_name: "local",
    wave_points: [],
    music_id: args.musicId,
    app_id: 0,
    text_id: "",
    tone_type: "",
    source_platform: 0,
    video_id: "",
    effect_id: "",
    resource_id: "",
    third_resource_id: "",
    category_id: "",
    intensifies_path: "",
    formula_id: "",
    check_flag: 1,
    team_id: "",
    local_material_id: sound.binId,
    tone_speaker: "",
    mock_tone_speaker: "",
    tone_effect_id: "",
    tone_effect_name: "",
    tone_platform: "",
    cloned_model_type: "",
    tone_category_id: "",
    tone_category_name: "",
    tone_second_category_id: "",
    tone_second_category_name: "",
    tone_emotion_name_key: "",
    tone_emotion_style: "",
    tone_emotion_role: "",
    tone_emotion_selection: "",
    tone_emotion_scale: 0,
    moyin_emotion: "",
    request_id: "",
    query: "",
    search_id: "",
    sound_separate_type: "",
    is_text_edit_overdub: false,
    is_ugc: false,
    is_ai_clone_tone: false,
    is_ai_clone_tone_post: false,
    source_from: "",
    copyright_limit_type: "none",
    aigc_history_id: "",
    aigc_item_id: "",
    music_source: "",
    pgc_id: "",
    pgc_name: "",
    similiar_music_info: { original_song_id: "", original_song_name: "" },
    ai_music_type: 0,
    ai_music_enter_from: "",
    lyric_type: 0,
    tts_task_id: "",
    tts_generate_scene: "",
    ai_music_generate_scene: 0,
    tts_benefit_info: { benefit_type: "none", benefit_log_id: "", benefit_log_extra: "", benefit_amount: -1 },
    tts_language_info: null,
  }
}

/**
 * The five extra materials a local WAV's segment points at, in the order CapCut 9.5 lists them, as
 * [materials key, entry] pairs. They are a library sound's, but with no fade, the beats CapCut 9.5
 * fills in, and a channel mapping of no type.
 */
function wavExtras(newId: () => string): [key: string, entry: { id: string; [k: string]: unknown }][] {
  return [
    ["speeds", { id: newId(), type: "speed", mode: 0, speed: 1, curve_speed: null }],
    ["placeholder_infos", { id: newId(), type: "placeholder_info", meta_type: "none", res_path: "", res_text: "", error_path: "", error_text: "" }],
    [
      "beats",
      {
        id: newId(),
        type: "beats",
        enable_ai_beats: false,
        gear: 404,
        gear_count: 0,
        mode: 404,
        user_beats: [],
        user_delete_ai_beats: null,
        ai_beats: { melody_url: "", melody_path: "", beats_url: "", beats_path: "", melody_percents: [0], beat_speed_infos: [] },
      },
    ],
    ["sound_channel_mappings", { id: newId(), type: "", audio_channel_mapping: 0, is_config_open: false }],
    [
      "vocal_separations",
      { id: newId(), type: "vocal_separation", choice: 0, removed_sounds: [], time_range: null, production_path: "", final_algorithm: "", enter_from: "" },
    ],
  ]
}

/** A local WAV's segment, with every field CapCut 9.5 writes for one, in its order. */
function wavSegment(args: { id: string; materialId: string; extraRefs: string[]; atUs: number; durationUs: number; trackIndex: number }): Segment {
  return {
    id: args.id,
    source_timerange: { start: 0, duration: args.durationUs },
    target_timerange: { start: args.atUs, duration: args.durationUs },
    render_timerange: { start: 0, duration: 0 },
    desc: "",
    state: 0,
    speed: 1,
    is_loop: false,
    is_tone_modify: false,
    reverse: false,
    intensifies_audio: false,
    cartoon: false,
    volume: VOLUME,
    last_nonzero_volume: VOLUME,
    clip: null,
    uniform_scale: null,
    material_id: args.materialId,
    extra_material_refs: args.extraRefs,
    render_index: 0,
    keyframe_refs: [],
    enable_lut: false,
    enable_adjust: false,
    enable_hsl: false,
    visible: true,
    group_id: "",
    enable_color_curves: true,
    enable_hsl_curves: true,
    track_render_index: args.trackIndex,
    hdr_settings: null,
    hdr_vivid_settings: null,
    enable_color_wheels: true,
    track_attribute: 0,
    is_placeholder: false,
    template_id: "",
    enable_smart_color_adjust: false,
    template_scene: "default",
    common_keyframes: [],
    caption_info: null,
    responsive_layout: { enable: false, target_follow: "", size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
    enable_color_match_adjust: false,
    enable_color_correct_adjust: false,
    enable_adjust_mask: false,
    raw_segment_id: "",
    lyric_keyframes: null,
    enable_video_mask: true,
    digital_human_template_group_id: "",
    color_correct_alg_result: "",
    source: "segmentsourcenormal",
    enable_mask_stroke: false,
    enable_mask_shadow: false,
    enable_color_adjust_pro: false,
    segment_color_tag: "",
  }
}

/**
 * Adds the composed sounds on new audio tracks, written as CapCut 9.5 lays a WAV the user imported
 * (docs/plans/2026-10-01-sound-spike/capcut-local-wav.md). Pure. Each plays its whole file from
 * its start, on a frame, at full volume and with no fade, but never past the end of the timeline.
 * Unlike a library sound it has no 1.5 s cap: it was composed for the room it has. Sounds that
 * overlap go on the first lane free by their start, as addSoundTrack lays library sounds. Every
 * material points at its bin item by `binId`, which the caller adds to the bin (soundBinItem).
 *
 * `newId` makes a UUID, in either case, for every id the write mints, so a test can repeat a write
 * exactly. Answers how many it placed and how many it left out: no room left, or a start before
 * the rough cut's.
 */
export function addComposedSoundTrack(info: DraftInfo, sounds: TimelineComposedSound[], newId: () => string = randomUUID): Written {
  const ids = idsFrom(newId)
  const out = structuredClone(info)
  const placed = placeSounds(info, sounds)
  const counts = { kept: placed.length, dropped: sounds.length - placed.length }
  if (placed.length === 0) return { info: out, ...counts }

  const audios: unknown[] = []
  const extrasByKey: Record<string, unknown[]> = {}
  // each lane's segments; lane n becomes the n-th new track
  const lanes: Segment[][] = []
  for (const { sound, atUs, durationUs, lane } of placed) {
    const materialId = ids.upper()
    audios.push(wavMaterial({ id: materialId, uniqueId: ids.hex(), musicId: ids.lower(), sound }))
    const extras = wavExtras(ids.upper)
    for (const [key, entry] of extras) (extrasByKey[key] ??= []).push(entry)
    const onLane = (lanes[lane] ??= [])
    onLane.push(wavSegment({ id: ids.upper(), materialId, extraRefs: extras.map(([, entry]) => entry.id), atUs, durationUs, trackIndex: out.tracks.length + lane }))
  }

  out.materials = withMaterials(out.materials, { audios, ...extrasByKey })
  out.tracks = [...out.tracks, ...lanes.map((segments) => audioTrack(ids.upper(), segments))]
  return { info: out, ...counts }
}
