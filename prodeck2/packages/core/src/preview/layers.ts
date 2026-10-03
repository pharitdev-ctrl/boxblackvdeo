import { basename } from "node:path"
import type { DraftInfo } from "../capcut/types.ts"

/**
 * What a draft shows at a moment, read the way spike B found CapCut draws it (docs/plans/2026-10-03-agent-spike/
 * findings.md): a segment's place is its clip's transform in halves of the canvas from the centre, x right and y up,
 * its size the clip's scale where scale 1 fits the material inside the canvas, both keyframed by the time in the
 * segment's source file (`time_offset`), linearly (the writers lay every keyframe as a "Line"). Text is sized at
 * `size × 4.8` px on a 1080-wide canvas, subtitles at `size × 3.9`. Drawn in render order: the main video first, then
 * every other segment by its render index. CapCut's text animations, effects, templates and stickers are not read.
 */

/** A segment's place: scale, position in half-canvases from the centre (x right, y up), rotation in degrees clockwise, opacity. */
export interface PreviewLook {
  scale: number
  x: number
  y: number
  rot: number
  alpha: number
}

export type Rgb = [number, number, number]

/** A piece of text in one colour, with the outline it reads against. */
export interface PreviewRun {
  text: string
  color: Rgb
  stroke: { width: number; color: Rgb } | null
}

export type PreviewLayer =
  | {
      kind: "video"
      /** the file on this machine */
      file: string
      /** a still picture: any time of it is the same */
      photo: boolean
      /** the time in the file this moment shows */
      sourceUs: number
      native: { width: number; height: number }
      look: PreviewLook
      /** above the main video, so it may be see-through (a graphic) */
      overlay: boolean
    }
  | {
      kind: "text"
      /** the lines of the text, each a list of runs */
      lines: PreviewRun[][]
      /** the size in pixels of the draft's canvas */
      sizePx: number
      /** the font file's name without its extension, or "" for CapCut's own font */
      font: string
      subtitle: boolean
      look: PreviewLook
    }
  | {
      kind: "shape"
      /** in pixels of the draft's canvas */
      width: number
      height: number
      /** CSS colour */
      color: string
      /** per cent of the height the corners round by */
      roundness: number
      look: PreviewLook
    }

/** A sound as it plays: from `sourceUs` in its file, at `startUs` on the timeline, for `durationUs`. */
export interface PreviewSound {
  file: string
  startUs: number
  durationUs: number
  sourceUs: number
  volume: number
}

interface Points {
  property: string
  points: { atUs: number; value: number }[]
}

interface Placed {
  order: number
  startUs: number
  durationUs: number
  sourceStartUs: number
  speed: number
  clip: PreviewLook
  keyframes: Points[]
  layer: (sourceUs: number, look: PreviewLook) => PreviewLayer
}

export interface PreviewDraft {
  canvas: { width: number; height: number }
  durationUs: number
  placed: Placed[]
  /** the main video's own sound and every audio segment */
  sounds: PreviewSound[]
  /** what is not drawn, one line each, for the note under the preview */
  skipped: string[]
}

/** Text px per size unit on a 1080-wide canvas, measured against CapCut's export (spike B). */
export const TEXT_PX_PER_SIZE = 4.8
export const SUBTITLE_PX_PER_SIZE = 3.9
/** CapCut draws a shape 1.5 times the size its `shape_size` says (capcut/highlights.ts). */
const SHAPE_SCALE = 1.5

type Json = Record<string, any>

const rgbOfHex = (hex: string): Rgb => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1]!, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const cssOf = (rgb: Rgb, alpha = 1) => `rgba(${rgb.map((v) => Math.round(v * 255)).join(",")},${alpha})`

/** A keyframed value at a time in the source file, linear between points, held before the first and after the last. */
export function valueAt(keyframes: Points[], property: string, sourceUs: number): number | null {
  const points = keyframes.find((one) => one.property === property)?.points
  if (!points || points.length === 0) return null
  if (sourceUs <= points[0]!.atUs) return points[0]!.value
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (sourceUs <= b.atUs) return a.value + ((b.value - a.value) * (sourceUs - a.atUs)) / Math.max(1, b.atUs - a.atUs)
  }
  return points.at(-1)!.value
}

/** The lines of a text material, each split into runs of one colour by its styles' ranges (in code points). */
function linesOf(material: Json): { lines: PreviewRun[][]; size: number; font: string } {
  let text = ""
  let styles: Json[] = []
  try {
    const content = JSON.parse(material.content)
    text = String(content.text ?? "")
    styles = Array.isArray(content.styles) ? content.styles : []
  } catch {
    text = String(material.content ?? "")
  }
  const chars = [...text]
  const first = styles[0] ?? {}
  const runOf = (style: Json, from: number, to: number): PreviewRun => {
    const stroke = style.strokes?.[0]
    return {
      text: chars.slice(from, to).join(""),
      color: (style.fill?.content?.solid?.color as Rgb | undefined) ?? rgbOfHex(material.text_color ?? "#ffffff"),
      stroke: stroke && stroke.width > 0 ? { width: stroke.width, color: (stroke.content?.solid?.color as Rgb | undefined) ?? [0, 0, 0] } : null,
    }
  }
  const runs: PreviewRun[] = []
  let at = 0
  for (const style of [...styles].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0))) {
    const [from, to] = (style.range as [number, number] | undefined) ?? [0, chars.length]
    if (from > at) runs.push(runOf(first, at, from))
    if (to > from) runs.push(runOf(style, Math.max(from, at), to))
    at = Math.max(at, to)
  }
  if (at < chars.length) runs.push(runOf(first, at, chars.length))
  // split the runs into lines at each line break
  const lines: PreviewRun[][] = [[]]
  for (const run of runs) {
    run.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines.at(-1)!.push({ ...run, text: part })
    })
  }
  const fontPath = String(first.font?.path ?? material.font_path ?? "")
  return { lines: lines.filter((line) => line.length > 0), size: Number(first.size ?? material.font_size ?? 15), font: fontPath ? basename(fontPath).replace(/\.(ttf|otf)$/i, "") : "" }
}

/**
 * Reads a draft for previewing: every segment that can be drawn, with its time and place, and the sounds. `local`
 * finds a material's file on this machine (null when it cannot be found: the segment is left out and listed).
 */
export function readPreviewDraft(info: DraftInfo, local: (path: string) => string | null = (path) => path || null): PreviewDraft {
  const canvas = { width: info.canvas_config.width, height: info.canvas_config.height }
  const materials = new Map<string, { kind: string; m: Json }>()
  for (const [kind, list] of Object.entries(info.materials as Json)) if (Array.isArray(list)) for (const m of list) if (m?.id) materials.set(m.id, { kind, m })
  const placed: Placed[] = []
  const sounds: PreviewSound[] = []
  const skipped: string[] = []
  const mainTrack = info.tracks.findIndex((track) => track.type === "video")
  const textScale = canvas.width / 1080

  info.tracks.forEach((track, trackIndex) => {
    for (const segment of track.segments as Json[]) {
      if (segment.visible === false) continue
      const target = segment.target_timerange
      const source = segment.source_timerange
      const at = `${(target.start / 1e6).toFixed(2)}s`
      const found = materials.get(segment.material_id)
      if (!found) {
        skipped.push(`${track.type} ไม่มีวัสดุ @${at}`)
        continue
      }
      const { kind, m } = found
      const clip = segment.clip ?? {}
      const base = {
        startUs: target.start as number,
        durationUs: target.duration as number,
        sourceStartUs: (source?.start as number | undefined) ?? 0,
        speed: (segment.speed as number | undefined) ?? 1,
        clip: { scale: clip.scale?.x ?? 1, x: clip.transform?.x ?? 0, y: clip.transform?.y ?? 0, rot: clip.rotation ?? 0, alpha: clip.alpha ?? 1 },
        keyframes: ((segment.common_keyframes ?? []) as Json[]).map((group) => ({
          property: String(group.property_type),
          points: ((group.keyframe_list ?? []) as Json[]).map((point) => ({ atUs: Number(point.time_offset), value: Number(point.values?.[0]) })),
        })),
      }
      const isMain = trackIndex === mainTrack
      // the main video under everything; the rest by render index, then by track
      const order = isMain ? -1 : Number(segment.render_index ?? 0) + trackIndex / 1000

      if (track.type === "audio") {
        const file = local(m.path ?? "")
        if (file) sounds.push({ file, startUs: base.startUs, durationUs: base.durationUs, sourceUs: base.sourceStartUs, volume: segment.volume ?? 1 })
        else skipped.push(`เสียง ${basename(m.path ?? "")} (ไม่พบไฟล์)`)
        continue
      }
      if (kind === "videos") {
        const file = local(m.path ?? "")
        if (!file) {
          skipped.push(`วิดีโอ ${basename(m.path ?? "")} @${at} (ไม่พบไฟล์)`)
          continue
        }
        if (isMain && m.type !== "photo") sounds.push({ file, startUs: base.startUs, durationUs: base.durationUs, sourceUs: base.sourceStartUs, volume: segment.volume ?? 1 })
        const native = { width: Number(m.width) || canvas.width, height: Number(m.height) || canvas.height }
        placed.push({ ...base, order, layer: (sourceUs, look) => ({ kind: "video", file, photo: m.type === "photo", sourceUs, native, look, overlay: !isMain }) })
      } else if (kind === "texts") {
        const { lines, size, font } = linesOf(m)
        if (lines.length === 0) continue
        const subtitle = m.type === "subtitle"
        const sizePx = size * (subtitle ? SUBTITLE_PX_PER_SIZE : TEXT_PX_PER_SIZE) * textScale
        placed.push({ ...base, order, layer: (_, look) => ({ kind: "text", lines, sizePx, font, subtitle, look }) })
      } else if (kind === "shapes" || m.type === "shape") {
        const [width, height] = (m.shape_size as [number, number] | undefined) ?? [0, 0]
        const solid = m.fill_render_style?.color?.solid
        const color = cssOf(rgbOfHex(String(solid?.color ?? "#000000")), Number(solid?.alpha ?? 1))
        placed.push({ ...base, order, layer: (_, look) => ({ kind: "shape", width: width * SHAPE_SCALE, height: height * SHAPE_SCALE, color, roundness: Number(m.roundness?.[0] ?? 0), look }) })
      } else {
        skipped.push(`${kind} @${at} (ไม่ได้วาด)`)
      }
    }
  })
  placed.sort((a, b) => a.order - b.order)
  return { canvas, durationUs: info.duration, placed, sounds, skipped }
}

/** The layers a draft shows at a time on the timeline, bottom first. */
export function layersAt(draft: PreviewDraft, atUs: number): PreviewLayer[] {
  return draft.placed
    .filter((one) => atUs >= one.startUs && atUs < one.startUs + one.durationUs)
    .map((one) => {
      const sourceUs = one.sourceStartUs + (atUs - one.startUs) * one.speed
      const look: PreviewLook = {
        scale: valueAt(one.keyframes, "KFTypeScaleX", sourceUs) ?? one.clip.scale,
        x: valueAt(one.keyframes, "KFTypePositionX", sourceUs) ?? one.clip.x,
        y: valueAt(one.keyframes, "KFTypePositionY", sourceUs) ?? one.clip.y,
        rot: valueAt(one.keyframes, "KFTypeRotation", sourceUs) ?? one.clip.rot,
        alpha: one.clip.alpha,
      }
      return one.layer(Math.round(sourceUs), look)
    })
}

/**
 * The moments a look shows of a span: one every `stepUs` from its start (half a step in, so a moment is not on a cut),
 * spread wider when there would be more than `most`, and never past the clip.
 */
export function momentsOf(span: { startUs: number; endUs: number }, durationUs: number, most = 40, stepUs = 500_000): number[] {
  const start = Math.max(0, Math.min(span.startUs, durationUs))
  const end = Math.max(start, Math.min(span.endUs, durationUs))
  if (end <= start) return []
  const step = Math.max(stepUs, Math.ceil((end - start) / most))
  const moments: number[] = []
  for (let t = start + step / 2; t < end && moments.length < most; t += step) moments.push(Math.round(t))
  return moments.length > 0 ? moments : [Math.round((start + end) / 2)]
}
