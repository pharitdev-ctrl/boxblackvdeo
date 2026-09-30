import { randomUUID } from "node:crypto"
import type { BinVideo, Segment, TimeRange, Track } from "./types.ts"

/**
 * Object shapes copied from a video segment CapCut Mac 9.2.0 wrote into a real
 * draft (0815, main track, segment 0), with user edits reset to defaults
 * (volume 3.04 → 1.0). Field order is kept as CapCut wrote it.
 */

/** Segment, material and track ids are upper-case UUIDs in CapCut drafts. */
export function newId(): string {
  return randomUUID().toUpperCase()
}

export function videoTrack(id: string, segments: Segment[]): Track {
  return { id, type: "video", flag: 0, attribute: 0, name: "", is_default_name: true, segments }
}

export function videoMaterial(id: string, clip: BinVideo): Record<string, unknown> & { id: string } {
  return {
    id,
    unique_id: randomUUID().replaceAll("-", ""),
    type: "video",
    duration: clip.durationUs,
    path: clip.path,
    media_path: "",
    local_id: "",
    // the bin does not record audio streams; CapCut re-probes the file on open
    has_audio: true,
    reverse_path: "",
    intensifies_path: "",
    reverse_intensifies_path: "",
    intensifies_audio_path: "",
    cartoon_path: "",
    width: clip.width,
    height: clip.height,
    category_id: "",
    category_name: "local",
    material_id: "",
    material_name: clip.name,
    material_url: "",
    crop: {
      upper_left_x: 0.0,
      upper_left_y: 0.0,
      upper_right_x: 1.0,
      upper_right_y: 0.0,
      lower_left_x: 0.0,
      lower_left_y: 1.0,
      lower_right_x: 1.0,
      lower_right_y: 1.0,
    },
    crop_ratio: "free",
    audio_fade: null,
    crop_scale: 1.0,
    extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: "", time_range: { start: 0, duration: 0 } },
    matting: {
      flag: 0,
      path: "",
      interactiveTime: [],
      has_use_quick_brush: false,
      strokes: [],
      has_use_quick_eraser: false,
      expansion: 0,
      feather: 0,
      reverse: false,
      custom_matting_id: "",
      enable_matting_stroke: false,
      is_clould: false,
      mask_video_path: "",
      cloud_product_fps: 0.0,
    },
    source: 0,
    source_platform: 0,
    formula_id: "",
    check_flag: 62978047,
    video_algorithm: {
      algorithms: [],
      time_range: null,
      path: "",
      gameplay_configs: [],
      ai_in_painting_config: [],
      complement_frame_config: null,
      motion_blur_config: null,
      deflicker: null,
      noise_reduction: null,
      quality_enhance: null,
      super_resolution: null,
      ai_background_configs: [],
      smart_complement_frame: null,
      aigc_generate: null,
      aigc_generate_list: [],
      mouth_shape_driver: null,
      ai_expression_driven: null,
      ai_motion_driven: null,
      image_interpretation: null,
      story_video_modify_video_config: {
        task_id: "",
        is_overwrite_last_video: false,
        tracker_task_id: "",
        generate_id: "",
        generate_card_id: "",
      },
      skip_algorithm_index: [],
    },
    is_unified_beauty_mode: false,
    is_set_beauty_mode: false,
    object_locked: null,
    smart_motion: null,
    multi_camera_info: null,
    freeze: null,
    picture_from: "none",
    picture_set_category_id: "",
    picture_set_category_name: "",
    team_id: "",
    local_material_id: clip.id,
    origin_material_id: "",
    request_id: "",
    has_sound_separated: false,
    is_text_edit_overdub: false,
    is_ai_generate_content: false,
    aigc_type: "none",
    is_copyright: false,
    aigc_history_id: "",
    aigc_item_id: "",
    local_material_from: "",
    smart_match_info: null,
    beauty_face_preset_infos: [],
    beauty_body_preset_id: "",
    beauty_face_auto_preset: { preset_id: "", name: "", rate_map: "", scene: "" },
    beauty_face_auto_preset_infos: [],
    beauty_body_auto_preset: null,
    live_photo_timestamp: -1,
    live_photo_cover_path: "",
    content_feature_info: null,
    corner_pin: null,
    surface_trackings: [],
    video_mask_stroke: {
      resource_id: "",
      path: "",
      type: "",
      color: "",
      size: 0.0,
      alpha: 0.0,
      distance: 0.0,
      texture: 0.0,
      horizontal_shift: 0.0,
      vertical_shift: 0.0,
    },
    video_mask_shadow: { resource_id: "", path: "", color: "", alpha: 0.0, blur: 0.0, distance: 0.0, angle: 0.0 },
    pre_applied_vip_materials: [],
    workflow_node_id: "",
  }
}

/**
 * Every video segment CapCut writes carries six per-segment helper materials, in
 * this order. Returns [materials key, entry] pairs; the ids become the segment's
 * extra_material_refs.
 */
export function segmentExtras(): [key: string, entry: { id: string; [k: string]: unknown }][] {
  return [
    ["speeds", { id: newId(), type: "speed", mode: 0, speed: 1.0, curve_speed: null }],
    [
      "placeholder_infos",
      { id: newId(), type: "placeholder_info", meta_type: "none", res_path: "", res_text: "", error_path: "", error_text: "" },
    ],
    [
      "canvases",
      {
        id: newId(),
        type: "canvas_color",
        color: "",
        blur: 0.0,
        image: "",
        album_image: "",
        image_id: "",
        image_name: "",
        source_platform: 0,
        team_id: "",
      },
    ],
    ["sound_channel_mappings", { id: newId(), type: "none", audio_channel_mapping: 0, is_config_open: false }],
    [
      "material_colors",
      {
        id: newId(),
        is_color_clip: false,
        is_gradient: false,
        solid_color: "",
        gradient_colors: [],
        gradient_percents: [],
        gradient_angle: 90.0,
        width: 0.0,
        height: 0.0,
      },
    ],
    [
      "vocal_separations",
      {
        id: newId(),
        type: "vocal_separation",
        choice: 0,
        removed_sounds: [],
        time_range: null,
        production_path: "",
        final_algorithm: "",
        enter_from: "",
      },
    ],
  ]
}

export function videoSegment(args: {
  id: string
  materialId: string
  extraRefs: string[]
  source: TimeRange
  target: TimeRange
}): Segment {
  return {
    id: args.id,
    source_timerange: args.source,
    target_timerange: args.target,
    render_timerange: { start: 0, duration: 0 },
    desc: "",
    state: 0,
    speed: 1.0,
    is_loop: false,
    is_tone_modify: false,
    reverse: false,
    intensifies_audio: false,
    cartoon: false,
    volume: 1.0,
    last_nonzero_volume: 1.0,
    clip: {
      scale: { x: 1.0, y: 1.0 },
      rotation: 0.0,
      transform: { x: 0.0, y: 0.0 },
      flip: { vertical: false, horizontal: false },
      alpha: 1.0,
    },
    uniform_scale: { on: true, value: 1.0 },
    material_id: args.materialId,
    extra_material_refs: args.extraRefs,
    render_index: 0,
    keyframe_refs: [],
    enable_lut: true,
    enable_adjust: true,
    enable_hsl: false,
    visible: true,
    group_id: "",
    enable_color_curves: true,
    enable_hsl_curves: true,
    track_render_index: 0,
    hdr_settings: { mode: 1, intensity: 1.0, nits: 1000 },
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
    // added by CapCut 9.4 when it re-saves a segment
    hdr_vivid_settings: null,
  }
}
