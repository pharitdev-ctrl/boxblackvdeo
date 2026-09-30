import type { Segment, TimeRange } from "./types.ts"

/**
 * A filled rounded rectangle on a sticker track — what CapCut 9.4 draws behind text, since the
 * text material's own `background_*` fields are ignored (spike, 2026-09-18). Fields copied from
 * the rect the user drew in their own project (0815, CapCut 9.4): `shape_type: 4` is the
 * rectangle, `shape_size` and `custom_points` are canvas pixels around the shape's centre, and
 * `roundness` is a percentage per corner.
 */
export function barMaterial(args: { id: string; color: string; alpha: number; roundness: number; width: number; height: number }): { id: string; [key: string]: unknown } {
  const halfWidth = args.width / 2
  const halfHeight = args.height / 2
  const corner = Math.max(0, Math.min(100, args.roundness))
  return {
    id: args.id,
    type: "shape",
    shape_type: 4,
    roundness: [corner, corner, corner, corner],
    custom_points: [-halfWidth, halfHeight, halfWidth, halfHeight, halfWidth, -halfHeight, -halfWidth, -halfHeight],
    shape_size: [args.width, args.height],
    global_alpha: 1,
    color: "",
    border_line_style: 0,
    border_width: 4,
    border_color: "#CCCCCC",
    shadow_color: "#000000",
    shadow_alpha: 0.5,
    shadow_distance: 10,
    shadow_angle: 45,
    check_flag: 81,
    name: "rect_item",
    combo_info: { text_templates: [] },
    shape_scale: [],
    custom_points_in: [0, 0, 0, 0, 0, 0, 0, 0],
    custom_points_out: [0, 0, 0, 0, 0, 0, 0, 0],
    border_alpha: 0,
    shadow_ambiguity: 0,
    endpoint_left_style: 0,
    endpoint_right_style: 0,
    line_style: 0,
    fill_render_style: {
      color: {
        solid: { color: args.color, alpha: args.alpha },
        gradient: { color: ["#CCCCCC", "#CCCCCC", "#CCCCCC"], alpha: [1, 1, 1], percent: [0, 0.5, 1], angle: 0, mode: "all", style: "linear" },
        texture: { path: "", flip: [], scale: 1, alpha: 1, angle: 0, blend: "no", range: 0, fill: "tile", resource_id: "", effect_id: "", play_speed: 1 },
        render_type: "solid",
      },
      alpha: 1,
    },
    constant_material_id: "",
  }
}

/** The segment that puts a bar on a sticker track, centred on (x, y) in CapCut's transform units. */
export function barSegment(args: { id: string; materialId: string; target: TimeRange; x: number; y: number; renderIndex: number; trackIndex: number }): Segment {
  return {
    id: args.id,
    source_timerange: null,
    target_timerange: args.target,
    render_timerange: { start: 0, duration: 0 },
    desc: "",
    state: 0,
    speed: 1,
    is_loop: false,
    is_tone_modify: false,
    reverse: false,
    intensifies_audio: false,
    cartoon: false,
    volume: 1,
    last_nonzero_volume: 1,
    clip: { scale: { x: 1, y: 1 }, rotation: 0, transform: { x: args.x, y: args.y }, flip: { vertical: false, horizontal: false }, alpha: 1 },
    uniform_scale: { on: true, value: 1 },
    material_id: args.materialId,
    extra_material_refs: [],
    render_index: args.renderIndex,
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
