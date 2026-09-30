import { newId } from "./templates.ts"
import { snapToFrame } from "./time.ts"
import type { DraftInfo, Segment, Track, Written } from "./types.ts"

/** A sound effect to drop on the rough cut. */
export interface TimelineSoundCue {
  atUs: number
  effectId: string
  /** as CapCut names it */
  name: string
  /** the file in CapCut's music cache, or null to let CapCut find it by id */
  path: string | null
  /** the sound's own length */
  durationUs: number
}

/** Longer than this and a sound effect plays over the talking. */
const MAX_CUE_US = 1_500_000
/** A sound that had to be cut short goes out gently instead of stopping dead. */
const FADE_US = 200_000
/** Under the talking, not over it. */
const VOLUME = 0.6
/** The category CapCut files its own sound effects under (0815). */
const CATEGORY_ID = "7313820083586190081"

/** A sound effect material, with the fields CapCut 9.4 writes for one of its own library sounds. */
function soundMaterial(id: string, cue: TimelineSoundCue) {
  return {
    id,
    unique_id: "",
    type: "sound",
    name: cue.name,
    duration: cue.durationUs,
    path: cue.path ?? "",
    category_name: "ติดเทรนด์",
    category_id: CATEGORY_ID,
    effect_id: cue.effectId,
    wave_points: [],
    music_id: "",
    app_id: 1775,
    text_id: "",
    tone_type: "",
    source_platform: 0,
    video_id: "",
    resource_id: "",
    third_resource_id: "",
    intensifies_path: "",
    formula_id: "",
    check_flag: 1,
    team_id: "",
    local_material_id: "",
    request_id: "",
    query: "",
    search_id: "",
    sound_separate_type: "",
    is_text_edit_overdub: false,
    is_ugc: false,
    source_from: "",
    copyright_limit_type: "none",
    music_source: "",
    similiar_music_info: { original_song_id: "", original_song_name: "" },
    ai_music_type: 0,
    lyric_type: 0,
  }
}

const extra = (type: string, rest: Record<string, unknown>) => ({ id: newId(), type, ...rest })

/**
 * Adds the sound effects on new audio tracks. Pure. A cue plays from the start of its sound for
 * at most 1.5 s, never past the end of the timeline, and one that had to be cut short fades out.
 * A cue that starts while an earlier one is still playing goes on the next track down, so both
 * play whole where they were put; most clips need one track. Answers how many it placed and how
 * many it left out: no room left, or a start before the rough cut's.
 */
export function addSoundTrack(info: DraftInfo, cues: TimelineSoundCue[]): Written {
  const out = structuredClone(info)
  const audios: unknown[] = []
  const speeds: unknown[] = []
  const placeholders: unknown[] = []
  const beats: unknown[] = []
  const mappings: unknown[] = []
  const separations: unknown[] = []
  const fades: unknown[] = []
  // each lane becomes a track; a cue takes the first lane that is free by its start
  const lanes: { endUs: number; segments: Segment[] }[] = []

  for (const cue of [...cues].sort((a, b) => a.atUs - b.atUs)) {
    // on a frame, like the text and the picture it is meant to land with; a hair before the start
    // (the first piece rounded up to its frame) is the start
    const atUs = Math.max(0, snapToFrame(cue.atUs, info.fps))
    const room = info.duration - atUs
    const duration = Math.min(cue.durationUs, MAX_CUE_US, room)
    if (snapToFrame(cue.atUs, info.fps) < 0 || duration <= 0) continue
    let lane = lanes.findIndex((candidate) => candidate.endUs <= atUs)
    if (lane === -1) lane = lanes.push({ endUs: 0, segments: [] }) - 1
    lanes[lane]!.endUs = atUs + duration

    const materialId = newId()
    audios.push(soundMaterial(materialId, cue))
    const speed = extra("speed", { mode: 0, speed: 1, curve_speed: null })
    const placeholder = extra("placeholder_info", { meta_type: "none", res_path: "", res_text: "", error_path: "", error_text: "" })
    const beat = extra("beats", { enable_ai_beats: false, gear: 404, gear_count: 0, mode: 404, user_beats: [], user_delete_ai_beats: null })
    const mapping = extra("none", { audio_channel_mapping: 0, is_config_open: false })
    const separation = extra("vocal_separation", { choice: 0, removed_sounds: [], time_range: null, production_path: "", final_algorithm: "", enter_from: "" })
    // only a sound that was cut short needs to be let down gently
    const cut = duration < cue.durationUs
    const fade = extra("audio_fade", { fade_type: 0, fade_in_duration: 0, fade_out_duration: cut ? Math.min(FADE_US, Math.floor(duration / 2)) : 0 })
    speeds.push(speed)
    placeholders.push(placeholder)
    beats.push(beat)
    mappings.push(mapping)
    separations.push(separation)
    fades.push(fade)

    lanes[lane]!.segments.push({
      id: newId(),
      source_timerange: { start: 0, duration },
      target_timerange: { start: atUs, duration },
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
      material_id: materialId,
      extra_material_refs: [speed.id, placeholder.id, beat.id, mapping.id, separation.id, fade.id],
      render_index: 0,
      keyframe_refs: [],
      enable_lut: false,
      enable_adjust: false,
      enable_hsl: false,
      visible: true,
      group_id: "",
      enable_color_curves: true,
      enable_hsl_curves: true,
      track_render_index: out.tracks.length + lane,
      hdr_settings: null,
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
      source: "segmentsourcenormal",
      segment_color_tag: "",
    })
  }

  const counts = { kept: audios.length, dropped: cues.length - audios.length }
  if (lanes.length === 0) return { info: out, ...counts }

  const existing = (key: string) => (Array.isArray(out.materials[key]) ? (out.materials[key] as unknown[]) : [])
  out.materials = {
    ...out.materials,
    audios: [...existing("audios"), ...audios],
    speeds: [...existing("speeds"), ...speeds],
    placeholder_infos: [...existing("placeholder_infos"), ...placeholders],
    beats: [...existing("beats"), ...beats],
    sound_channel_mappings: [...existing("sound_channel_mappings"), ...mappings],
    vocal_separations: [...existing("vocal_separations"), ...separations],
    audio_fades: [...existing("audio_fades"), ...fades],
  }
  const tracks: Track[] = lanes.map(({ segments }) => ({ id: newId(), type: "audio", flag: 0, attribute: 0, name: "", is_default_name: true, segments }))
  out.tracks = [...out.tracks, ...tracks]
  return { info: out, ...counts }
}
