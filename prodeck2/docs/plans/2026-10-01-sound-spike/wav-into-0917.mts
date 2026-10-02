// Task 1 spike: writes the spike WAV into draft 0917 as CapCut itself wrote a local WAV in the user's "ทดสอบเสียง"
// project (type extract_music, category local, a bin entry of metetype music), at 12.633 s (the spoken "สาม").
import { randomUUID, randomBytes } from "node:crypto"
import { join } from "node:path"
import { homedir } from "node:os"
import { loadDraft, readJson } from "/Users/ford/Desktop/Thalent Ai/excp/prodeck2/packages/core/src/capcut/read.ts"
import { writeDraft } from "/Users/ford/Desktop/Thalent Ai/excp/prodeck2/packages/core/src/capcut/write.ts"
const FOLDER = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft/0917")
const WAV = join(homedir(), "Movies/CapCut/BOXBLACK/sounds/spike-countdown.wav")
const AT = 12_633_333, DURATION = 4_000_000
const UP = () => randomUUID().toUpperCase()
const draft = await loadDraft(FOLDER)
const info: any = await readJson(join(FOLDER, "draft_info.json"))
const binId = randomUUID()
const ids = { audio: UP(), speed: UP(), placeholder: UP(), beats: UP(), channel: UP(), vocal: UP(), segment: UP(), track: UP() }
const empty = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, ""]))
info.materials.audios.push({
  id: ids.audio, unique_id: randomBytes(16).toString("hex"), type: "extract_music", name: "spike-countdown.wav", duration: DURATION, path: WAV,
  category_name: "local", wave_points: [], music_id: randomUUID(), app_id: 0,
  ...empty(["text_id", "tone_type", "video_id", "effect_id", "resource_id", "third_resource_id", "category_id", "intensifies_path", "formula_id", "team_id", "tone_speaker", "mock_tone_speaker", "tone_effect_id", "tone_effect_name", "tone_platform", "cloned_model_type", "tone_category_id", "tone_category_name", "tone_second_category_id", "tone_second_category_name", "tone_emotion_name_key", "tone_emotion_style", "tone_emotion_role", "tone_emotion_selection", "moyin_emotion", "request_id", "query", "search_id", "sound_separate_type", "source_from", "aigc_history_id", "aigc_item_id", "music_source", "pgc_id", "pgc_name", "ai_music_enter_from", "tts_task_id", "tts_generate_scene"]),
  source_platform: 0, check_flag: 1, local_material_id: binId, tone_emotion_scale: 0.0,
  is_text_edit_overdub: false, is_ugc: false, is_ai_clone_tone: false, is_ai_clone_tone_post: false, copyright_limit_type: "none",
  similiar_music_info: { original_song_id: "", original_song_name: "" }, ai_music_type: 0, lyric_type: 0, ai_music_generate_scene: 0,
  tts_benefit_info: { benefit_type: "none", benefit_log_id: "", benefit_log_extra: "", benefit_amount: -1 }, tts_language_info: null,
})
info.materials.speeds.push({ id: ids.speed, type: "speed", mode: 0, speed: 1.0, curve_speed: null })
info.materials.placeholder_infos.push({ id: ids.placeholder, type: "placeholder_info", meta_type: "none", res_path: "", res_text: "", error_path: "", error_text: "" })
info.materials.beats.push({ id: ids.beats, type: "beats", enable_ai_beats: false, gear: 404, gear_count: 0, mode: 404, user_beats: [], user_delete_ai_beats: null, ai_beats: { melody_url: "", melody_path: "", beats_url: "", beats_path: "", melody_percents: [0.0], beat_speed_infos: [] } })
info.materials.sound_channel_mappings.push({ id: ids.channel, type: "", audio_channel_mapping: 0, is_config_open: false })
info.materials.vocal_separations.push({ id: ids.vocal, type: "vocal_separation", choice: 0, removed_sounds: [], time_range: null, production_path: "", final_algorithm: "", enter_from: "" })
const segment = {
  id: ids.segment, source_timerange: { start: 0, duration: DURATION }, target_timerange: { start: AT, duration: DURATION }, render_timerange: { start: 0, duration: 0 },
  desc: "", state: 0, speed: 1.0, is_loop: false, is_tone_modify: false, reverse: false, intensifies_audio: false, cartoon: false, volume: 1.0, last_nonzero_volume: 1.0,
  clip: null, uniform_scale: null, material_id: ids.audio, extra_material_refs: [ids.speed, ids.placeholder, ids.beats, ids.channel, ids.vocal], render_index: 0, keyframe_refs: [],
  enable_lut: false, enable_adjust: false, enable_hsl: false, visible: true, group_id: "", enable_color_curves: true, enable_hsl_curves: true, track_render_index: info.tracks.length,
  hdr_settings: null, hdr_vivid_settings: null, enable_color_wheels: true, track_attribute: 0, is_placeholder: false, template_id: "", enable_smart_color_adjust: false, template_scene: "default",
  common_keyframes: [], caption_info: null, responsive_layout: { enable: false, target_follow: "", size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
  enable_color_match_adjust: false, enable_color_correct_adjust: false, enable_adjust_mask: false, raw_segment_id: "", lyric_keyframes: null, enable_video_mask: true,
  digital_human_template_group_id: "", color_correct_alg_result: "", source: "segmentsourcenormal", enable_mask_stroke: false, enable_mask_shadow: false, enable_color_adjust_pro: false, segment_color_tag: "",
}
info.tracks.push({ id: ids.track, type: "audio", flag: 0, attribute: 0, name: "", is_default_name: true, segments: [segment] })
const nowS = Math.floor(Date.now() / 1000)
await writeDraft(draft, info, {
  bin: (meta: any) => {
    const group = meta.draft_materials.find((g: any) => g.type === 0)
    group.value.push({ ai_group_type: "", create_time: nowS, duration: DURATION, enter_from: 0, extra_info: "spike-countdown.wav", file_Path: WAV, height: 0, id: binId, import_time: nowS, import_time_ms: Date.now() * 1000, item_source: 1, material_color_tag: "", md5: "", metetype: "music", roughcut_time_range: { duration: DURATION, start: 0 }, sub_time_range: { duration: -1, start: -1 }, type: 0, width: 0 })
    return meta
  },
})
console.log("written", ids.audio, binId)
