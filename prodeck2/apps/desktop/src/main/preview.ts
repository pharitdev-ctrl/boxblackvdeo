import { existsSync } from "node:fs"
import { binVideos, loadDraft, type Draft } from "@boxblack/core/capcut"
import { layersAt, momentsOf, readPreviewDraft, type DrawTile, type PreviewDraft } from "@boxblack/core/preview"
import { writeTimeline, type AgentTimeline } from "@boxblack/core/timeline"
import type { FrameAsk, PreviewFrames } from "./preview-frames.ts"
import type { DrawPage } from "./preview-window.ts"

/** A tile of the sheets Claude looks at: 288 px wide, so a sheet of 4 × 2 tiles of a portrait clip stays under the size the API shrinks. */
export const TILE_WIDTH = 288
export const SHEET_COLUMNS = 4
export const SHEET_ROWS = 2
/** Frames are pulled a half wider than the tile, so a push in does not blur at once. */
const FRAME_WIDTH = Math.round(TILE_WIDTH * 1.5)
/** What CapCut's own font is drawn in when its file is not on this machine. */
const FALLBACK_FONT = "Thonburi"

export interface Look {
  /** the moments shown, on the rough cut, in order */
  moments: number[]
  /** JPEG sheets, SHEET_COLUMNS × SHEET_ROWS moments each, the time written on every one */
  sheets: Buffer[]
  /** what could not be drawn, one line each */
  skipped: string[]
}

export interface PreviewDeps {
  frames: Pick<PreviewFrames, "frames">
  page: Pick<DrawPage, "draw">
  load?: (folder: string) => Promise<Draft>
  exists?: (path: string) => boolean
}

/**
 * Looks at a timeline as CapCut would show it: written in memory over the project's draft by the same writer the tab's
 * write uses (nothing reaches the disk), read for what each moment shows, the frames pulled and drawn on sheets with
 * the time on each (docs/plans/2026-10-05-agent-phase4-preview.md, decisions 1–3).
 */
export function createPreview(deps: PreviewDeps) {
  const load = deps.load ?? loadDraft
  const exists = deps.exists ?? existsSync

  async function draftOf(folder: string, timeline: AgentTimeline): Promise<PreviewDraft> {
    const draft = await load(folder)
    const written = writeTimeline(draft.info, binVideos(draft.meta), timeline, { subtitleGroupId: "boxblack_preview", prune: null })
    return readPreviewDraft(written.info, (path) => (path && exists(path) ? path : null))
  }

  return {
    draftOf,

    /** Sheets of a span of the timeline (the whole clip when it is null), at most `most` moments. */
    async look(folder: string, timeline: AgentTimeline, span: { startUs: number; endUs: number } | null, signal?: AbortSignal, most = 40): Promise<Look> {
      const draft = await draftOf(folder, timeline)
      const moments = momentsOf(span ?? { startUs: 0, endUs: draft.durationUs }, draft.durationUs, most)
      const shown = moments.map((atUs) => layersAt(draft, atUs))
      const asks: FrameAsk[] = shown.flatMap((layers) => layers.flatMap((layer) => (layer.kind === "video" ? [{ file: layer.file, sourceUs: layer.sourceUs, photo: layer.photo, alpha: layer.overlay, width: FRAME_WIDTH }] : [])))
      const pulled = await deps.frames.frames(asks, signal)
      let next = 0
      const tiles: DrawTile[] = shown.map((layers, i) => ({
        label: `${(moments[i]! / 1_000_000).toFixed(2)}s`,
        layers: layers.map((layer) => (layer.kind === "video" ? { ...layer, src: pulled[next++] ?? null } : layer)),
      }))
      const fonts = [...new Set(shown.flatMap((layers) => layers.flatMap((layer) => (layer.kind === "text" && layer.fontFile && exists(layer.fontFile) ? [layer.fontFile] : []))))]
      const tile = { width: TILE_WIDTH, height: Math.round((TILE_WIDTH * draft.canvas.height) / draft.canvas.width / 2) * 2 }
      const perSheet = SHEET_COLUMNS * SHEET_ROWS
      const sheets: Buffer[] = []
      for (let i = 0; i < tiles.length; i += perSheet) {
        if (signal?.aborted) throw signal.reason ?? new Error("stopped")
        sheets.push(await deps.page.draw(tiles.slice(i, i + perSheet), { canvas: draft.canvas, tile, columns: SHEET_COLUMNS, fallbackFont: FALLBACK_FONT }, fonts))
      }
      return { moments, sheets, skipped: draft.skipped }
    },
  }
}

export type Preview = ReturnType<typeof createPreview>
