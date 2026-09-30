import type { Tone } from "../flair/plan.ts"
import { hexOf, onSurface, strokeFor, type Rgb } from "../highlights/colour.ts"
import { accentOnBar, type Palette } from "../highlights/styles.ts"
import { barMaterial, barSegment } from "./shapes.ts"
import { captionMaterial, captionSegment } from "./subtitle-templates.ts"
import { newId } from "./templates.ts"
import { frameToUs, usToFrame } from "./time.ts"
import type { DraftInfo, Segment, TimeRange, Track } from "./types.ts"

/** One line of highlight text, placed by the layout. */
export interface TimelineHighlightLine {
  startUs: number
  text: string
  y: number
  scale: number
  /** how far from the centre, in CapCut's transform units; 0 unless the pattern staggers the lines */
  x?: number
  /** the bar behind the line, as shares of the canvas width */
  bar?: { width: number; height: number } | null
  /** the word to colour differently, counted in code points */
  accent?: { from: number; to: number } | null
  /** which of the palette's colours the line reads in; base unless its group says otherwise */
  tone?: Tone
}

/** A group of highlight text on the output timeline, in µs, with each line placed by the layout. */
export interface TimelineHighlightGroup {
  endUs: number
  lines: TimelineHighlightLine[]
  /** an "out" animation for every line of the group, named by resource id */
  exit?: { resourceId: string; name: string } | null
}

export interface HighlightLook {
  /** absolute path of a .ttf CapCut may read (under ~/Movies, inside its sandbox) */
  fontPath: string
  /** CapCut's stroke width; the stroke's colour is black or white, whichever each range reads against */
  strokeWidth: number
  /** how round the ends of a bar are, in per cent of its height */
  barRoundness: number
  /** the four colours; everything drawn is one of them or black or white chosen against one of them */
  palette: Palette
  /** an "in" animation named by resource id; `path` is its folder in CapCut's effect cache, or "" to let CapCut fetch it */
  animation: { resourceId: string; name: string; path: string } | null
}

/** CapCut's text size the layout's scale is measured against. */
const FONT_SIZE = 15
const ANIMATION_US = 500_000
/** Text leaves faster than it arrives, so the next line is not kept waiting. */
const EXIT_US = 300_000
/**
 * CapCut draws a `shapes` rect 1.5 times the size its `shape_size` and `custom_points` say, on a
 * portrait 1080-wide canvas (measured on 0917, 2026-09-18: 200 px drew 304, 400 drew 603, 100 drew
 * 148). Wide canvases scale by something else, so the bar pattern is portrait-only for now.
 */
const SHAPE_SCALE = 1.5

const hex = hexOf

/** What a line reads in and what its accented word reads in: by its tone, or on a bar by the bar. */
function coloursOf(palette: Palette, tone: Tone, onBar: boolean): { base: Rgb; accent: Rgb } {
  if (onBar) return { base: onSurface(palette.bar), accent: accentOnBar(palette) }
  const base = tone === "base" ? palette.text : palette[tone]
  // the accented word is a palette colour the line is not already in
  return { base, accent: tone === "accent" ? palette.alt : palette.accent }
}

/**
 * Plain text in a chosen font, as CapCut 9.4 accepted it (spikes on draft 0917, 2026-09-17 and
 * 2026-09-18): the caption material with `type: "text"`, the font path and colours in
 * `content.styles` and in the matching material fields. `range` counts code points — a Thai mark
 * takes an index of its own — and the styles must cover every character of the line, because
 * CapCut draws anything they leave out at its own default size.
 */
function textMaterial(id: string, text: string, look: HighlightLook, line: TimelineHighlightLine) {
  const chars = [...text]
  const onBar = !!line.bar
  const { base, accent: accentColour } = coloursOf(look.palette, line.tone ?? "base", onBar)
  const accent = line.accent && line.accent.from < line.accent.to ? line.accent : null
  const ranges: { from: number; to: number; color: Rgb }[] = accent
    ? [
        { from: 0, to: accent.from, color: base },
        { from: accent.from, to: Math.min(accent.to, chars.length), color: accentColour },
        { from: accent.to, to: chars.length, color: base },
      ]
    : [{ from: 0, to: chars.length, color: base }]
  const styles = ranges
    .filter((range) => range.from < range.to)
    .map((range) => ({
      fill: { content: { solid: { color: range.color }, render_type: "solid" } },
      range: [range.from, range.to],
      // a bar already separates the text from the picture, so text on one carries no stroke; elsewhere each range
      // gets the stroke it reads against, so an accented word never sits in a stroke of its own colour
      ...(onBar ? {} : { strokes: [{ width: look.strokeWidth, mode: 0, content: { solid: { color: strokeFor(range.color) }, render_type: "solid" } }] }),
      size: FONT_SIZE,
      font: { path: look.fontPath, id: "" },
      useLetterColor: true,
    }))
  return {
    ...captionMaterial({ id, text, groupId: "" }),
    type: "text",
    add_type: 0,
    content: JSON.stringify({ styles, text }),
    // the material's own colour is what CapCut's panel shows; a line that is all accent is all accent
    text_color: hex(styles[0]?.fill.content.solid.color ?? base),
    border_color: onBar ? "" : hex(strokeFor(styles[0]?.fill.content.solid.color ?? base)),
    border_width: onBar ? 0 : look.strokeWidth,
    font_size: FONT_SIZE,
    font_path: look.fontPath,
  }
}

function animationMaterial(id: string, look: HighlightLook, visibleUs: number, exit: { resourceId: string; name: string } | null) {
  // a line shown briefly still settles before it goes, and never spends more than half its time moving
  const half = Math.floor(visibleUs / 2)
  const entry = (animation: { resourceId: string; name: string; path?: string }, type: "in" | "out", start: number, duration: number) => ({
    id: animation.resourceId,
    type,
    start,
    duration,
    path: animation.path ?? "",
    platform: "all",
    resource_id: animation.resourceId,
    third_resource_id: "0",
    source_platform: 1,
    name: animation.name,
    category_id: type === "in" ? "ruchang" : "chuchang",
    category_name: type === "in" ? "เข้า" : "ออก",
    panel: "",
    material_type: "sticker",
    anim_adjust_params: null,
    request_id: "",
  })
  const animations = []
  if (look.animation) animations.push(entry(look.animation, "in", 0, Math.min(ANIMATION_US, half)))
  // CapCut writes an "out" animation with start 0 and plays it at the end of the segment itself
  if (exit) animations.push(entry(exit, "out", 0, Math.min(EXIT_US, half)))
  return { id, type: "sticker_animation", animations, multi_language_current: "none" }
}

/**
 * Adds highlight text on top of everything else. Pure. Line n of every group goes on the n-th new
 * text track, so a group's lines show together; a line with a bar puts the bar on a sticker track
 * under all the text tracks; edges land on frames and stay inside the timeline; blank lines and
 * lines with no whole frame left are left out.
 */
export function addHighlightTracks(info: DraftInfo, groups: TimelineHighlightGroup[], look: HighlightLook): DraftInfo {
  const fps = info.fps
  const lastFrame = usToFrame(info.duration, fps)
  const out = structuredClone(info)
  const texts: unknown[] = []
  const animations: unknown[] = []
  const shapes: unknown[] = []
  const slots: { segments: Segment[]; bars: { id: string; materialId: string; target: TimeRange; x: number; y: number }[]; endFrame: number }[] = []
  const canvasWidth = info.canvas_config.width

  const ordered = [...groups].sort((a, b) => (a.lines[0]?.startUs ?? 0) - (b.lines[0]?.startUs ?? 0))
  for (const group of ordered) {
    const endFrame = Math.min(usToFrame(group.endUs, fps), lastFrame)
    group.lines.forEach((line, index) => {
      const text = line.text.trim()
      const slot = (slots[index] ??= { segments: [], bars: [], endFrame: 0 })
      const startFrame = Math.max(usToFrame(line.startUs, fps), slot.endFrame)
      if (!text || endFrame - startFrame < 1) return
      slot.endFrame = endFrame

      const start = frameToUs(startFrame, fps)
      const duration = frameToUs(endFrame, fps) - start
      const materialId = newId()
      const animationId = newId()
      texts.push(textMaterial(materialId, text, look, line))
      animations.push(animationMaterial(animationId, look, duration, group.exit ?? null))
      const segment = captionSegment({ id: newId(), materialId, animationId, target: { start, duration } })
      const x = line.x ?? 0
      slot.segments.push({ ...segment, clip: { ...(segment.clip as object), scale: { x: line.scale, y: line.scale }, transform: { x, y: line.y } } })
      if (line.bar) {
        const barId = newId()
        shapes.push(
          barMaterial({
            id: barId,
            color: hex(look.palette.bar),
            alpha: 1,
            roundness: look.barRoundness,
            width: (line.bar.width * canvasWidth) / SHAPE_SCALE,
            height: (line.bar.height * canvasWidth) / SHAPE_SCALE,
          }),
        )
        slot.bars.push({ id: newId(), materialId: barId, target: { start, duration }, x, y: line.y })
      }
    })
  }

  const filled = slots.filter((slot) => slot?.segments.length > 0)
  if (filled.length === 0) return out

  // the bars first, so every line of text draws over every bar
  const base = out.tracks.length
  const barTracks: Track[] = filled
    .filter((slot) => slot.bars.length > 0)
    .map((slot, i) => ({
      id: newId(),
      type: "sticker",
      flag: 0,
      attribute: 0,
      name: "",
      is_default_name: true,
      segments: slot.bars.map((bar) => barSegment({ ...bar, renderIndex: 13000 + base + i, trackIndex: base + i })),
    }))
  const textTracks: Track[] = filled.map((slot, i) => {
    const trackIndex = base + barTracks.length + i
    return {
      id: newId(),
      type: "text",
      flag: 0,
      attribute: 0,
      name: "",
      is_default_name: true,
      segments: slot.segments.map((segment) => ({ ...segment, render_index: 14000 + trackIndex, track_render_index: trackIndex })),
    }
  })
  const existing = (key: string) => (Array.isArray(out.materials[key]) ? (out.materials[key] as unknown[]) : [])
  out.materials = {
    ...out.materials,
    texts: [...existing("texts"), ...texts],
    material_animations: [...existing("material_animations"), ...animations],
    ...(shapes.length > 0 ? { shapes: [...existing("shapes"), ...shapes] } : {}),
  }
  out.tracks = [...out.tracks, ...barTracks, ...textTracks]
  return out
}
