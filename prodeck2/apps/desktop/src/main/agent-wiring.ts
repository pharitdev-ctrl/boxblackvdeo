import { randomUUID } from "node:crypto"
import { basename } from "node:path"
import type { AgentFootage } from "@boxblack/core/agent"
import { binVideos, loadDraft } from "@boxblack/core/capcut"
import { binIdOf, graphicBinItem, soundBinItem } from "@boxblack/core/capcut/bin"
import type { CutRules } from "@boxblack/core/cut"
import { zoomCap } from "@boxblack/core/flair/moves"
import { stageBox } from "@boxblack/core/graphics/framing"
import { MOTION_VERSION, type MotionSpec } from "@boxblack/core/graphics/plan"
import { HIGHLIGHT_FONTS, styleFor } from "@boxblack/core/highlights/styles"
import { lintCompose } from "@boxblack/core/sound/lint"
import type { LlmTransport } from "@boxblack/core/llm/types"
import { codeOf, composeSound, soundBrief, soundRepairBrief } from "@boxblack/core/sound/write"
import type { AgentTimeline } from "@boxblack/core/timeline"
import type { AgentRequest } from "../shared/api.ts"
import type { AgentClip, AgentMakers } from "./agent-actions.ts"
import { FONT_FAMILY } from "./graphics-cues.ts"
import type { GraphicsRenderer } from "./graphics-render.ts"
import type { HighlightAssets } from "./highlight-assets.ts"
import { styleInForce, timelineOf } from "./highlight-state.ts"
import { writePiece } from "./motion-write.ts"
import { writeChecked } from "./piece-write.ts"
import type { OutlineStore } from "./planner.ts"
import type { SettingsStore } from "./settings.ts"
import type { SoundLibrary } from "./sound-library.ts"
import type { SoundRenderer } from "./sound-render.ts"
import { spokenSentences, wordsIn } from "./spoken.ts"
import { wordsOnCutAt } from "./composed-cues.ts"
import type { TimelineService } from "./timeline.ts"

export interface AgentWiringDeps {
  timeline: Pick<TimelineService, "compiled" | "dryAssemble">
  outlines: Pick<OutlineStore, "get">
  settings: Pick<SettingsStore, "read">
  highlightAssets?: HighlightAssets
  sounds?: Pick<SoundLibrary, "list">
  graphics?: Pick<GraphicsRenderer, "wait" | "rendered">
  soundRenderer?: Pick<SoundRenderer, "check" | "ensure" | "statusOf" | "fileOf">
  /** the editing Claude, for writing graphics and composing sounds */
  llm: () => Promise<{ transport: LlmTransport; model: string }>
  now?: () => number
}

/** A word lasts until the next one starts, at most this long. */
const WORD_US = 600_000
const toMs = (s: number) => Math.round(s * 1000) / 1000

/**
 * What the agent service needs about a project, built from the app's own services: the footage Claude reads, the clip
 * the actions check against, the makers of graphics and sounds, and the timeline a session starts from. Each project's
 * request (rules, subtitles, highlight options) is the one the tab opened it with.
 */
export function createAgentWiring(deps: AgentWiringDeps) {
  const requests = new Map<string, AgentRequest>()
  const now = deps.now ?? Date.now
  const requestOf = (folder: string) => {
    const request = requests.get(folder)
    if (!request) throw new Error("open the conversation from the post-production page first")
    return request
  }

  async function project(folder: string) {
    const { rules } = requestOf(folder)
    const compiled = await deps.timeline.compiled(folder, rules)
    const { stored, plan, clips } = compiled
    const beatNames = new Map(stored.outline.beats.map((beat) => [beat.id, beat.name]))
    const sentences = spokenSentences({ plan, wordsOf: wordsIn(clips), beatNames, at: timelineOf(plan) })
    const timed = wordsOnCutAt(sentences)
    const words = timed.map((word, i) => ({ text: word.text, atUs: word.atUs, endUs: Math.min(timed[i + 1]?.atUs ?? word.atUs + WORD_US, word.atUs + WORD_US) }))
    return { ...compiled, words }
  }

  return {
    /** Remembers the request a project's tab opened with, and answers the timeline a new session starts from. */
    remember(folder: string, request: AgentRequest): () => Promise<AgentTimeline> {
      requests.set(folder, request)
      return () => deps.timeline.dryAssemble(folder, request.rules, request.subtitles, request.highlights)
    },

    async footage(folder: string): Promise<AgentFootage> {
      const { stored, plan, words } = await project(folder)
      const at = timelineOf(plan)
      let cut = 0
      const beats = plan.beats.flatMap((beat) => {
        const first = beat.pieces[0]
        const index = cut
        cut += beat.pieces.length
        const outline = stored.outline.beats.find((b) => b.id === beat.beatId)
        return first ? [{ name: outline?.name ?? beat.beatId, purpose: outline?.purpose ?? "", startUs: at(index, first.startUs) }] : []
      })
      const sounds = deps.sounds ? (await deps.sounds.list()).map((sound) => (sound.use ? `${sound.name} (${sound.use})` : sound.name)) : []
      return {
        title: stored.outline.title,
        summary: [stored.outline.summary, stored.outline.direction ? `แนวทางตกแต่ง: ${stored.outline.direction}` : ""].filter(Boolean).join(" · "),
        beats,
        words: words.map(({ text, atUs }) => ({ text, atUs })),
        sounds,
        brief: { videoType: stored.brief.videoType, instructions: stored.brief.instructions },
      }
    },

    async clip(folder: string): Promise<AgentClip> {
      const { stored, plan, canvas, words } = await project(folder)
      if (!canvas) throw new Error("the rough cut is empty")
      const draft = await loadDraft(folder)
      const videos = new Map(binVideos(draft.meta).map((video) => [video.id, video]))
      let at = 0
      const cuts = plan.cuts.map((cut) => {
        const startUs = at
        at += cut.sourceDurationUs
        const video = videos.get(cut.binId)
        // faces are not known here yet: the move checks then keep only the zoom cap and the edges (phase 4 adds them)
        return { startUs, durationUs: cut.sourceDurationUs, cap: video ? zoomCap(video, canvas) : 1, faces: null, shown: [] }
      })
      const settings = await deps.settings.read()
      const style = styleFor(styleInForce(stored.highlights), settings.highlights.custom)
      const request = requestOf(folder)
      const highlight = deps.highlightAssets
        ? {
            font: style.font,
            subtitlesOn: request.subtitles !== null,
            look: {
              fontPath: await deps.highlightAssets.fontPath(style.font),
              strokeWidth: style.strokeWidth,
              barRoundness: style.barRoundness,
              palette: style.palette,
              animation: { ...style.animation, path: await deps.highlightAssets.animationPath(style.animation.resourceId) },
            },
          }
        : null
      return { canvas, durationUs: plan.durationUs, words, cuts, highlight }
    },

    makers(folder: string): AgentMakers {
      return {
        async graphic({ atUs, durationUs, box, idea, words, signal }) {
          if (!deps.graphics) return { ok: false, why: "ยังไม่ได้ติดตั้งตัวเรนเดอร์กราฟิก (ตั้งค่า)" }
          const { stored, canvas, fps } = await deps.timeline.compiled(folder, requestOf(folder).rules)
          if (!canvas) return { ok: false, why: "the rough cut is empty" }
          const settings = await deps.settings.read()
          const style = styleFor(styleInForce(stored.highlights), settings.highlights.custom)
          const shareBox = { x0: box[0], y0: box[1], x1: box[2], y1: box[3] }
          const { width, height } = stageBox(shareBox, canvas)
          const seconds = Math.floor(durationUs / 1_000) / 1_000
          const llm = await deps.llm()
          const written = await writePiece(
            { stage: { width, height }, seconds, words, idea, about: [stored.outline.title, stored.outline.summary].filter(Boolean).join(": "), ...(stored.outline.direction ? { direction: stored.outline.direction } : {}) },
            // rendered once below; a render that fails comes back to Claude, which can ask again
            { ...llm, render: async () => [], signal },
          )
          if (!("html" in written)) return { ok: false, why: written.failed }
          const spec: MotionSpec = { kind: "motion", version: MOTION_VERSION, box: shareBox, seconds, why: "", idea, words, html: written.html }
          const job = { spec, canvas, fps, font: { family: FONT_FAMILY[style.font], file: HIGHLIGHT_FONTS[style.font] }, palette: style.palette, times: words.map((word) => word.atS) }
          await deps.graphics.wait([job], folder)
          const file = await deps.graphics.rendered(job)
          if (!file) return { ok: false, why: "เรนเดอร์ไม่สำเร็จ" }
          const draft = await loadDraft(folder)
          const binId = binIdOf(draft.meta, file.path) ?? randomUUID()
          return {
            ok: true,
            graphic: { atUs, durationUs, binId, path: file.path, name: basename(file.path), width: file.width, height: file.height, durationOfFileUs: file.durationUs, place: file.place },
            binItem: graphicBinItem({ id: binId, path: file.path, width: file.width, height: file.height, durationUs: file.durationUs, nowMs: now() }),
          }
        },

        async composeSound({ atUs, seconds, role, loudness, signal }) {
          const renderer = deps.soundRenderer
          if (!renderer) return { ok: false, why: "แต่งเสียงในเครื่องนี้ไม่ได้" }
          const { stored } = await deps.timeline.compiled(folder, requestOf(folder).rules)
          const { words } = await project(folder)
          const said = words.filter((w) => w.atUs >= atUs && w.atUs < atUs + seconds * 1_000_000).map((w) => ({ text: w.text, atS: toMs((w.atUs - atUs) / 1_000_000) }))
          const llm = await deps.llm()
          const brief = soundBrief({ palette: stored.flair?.palette ?? "", about: stored.outline.title, role, seconds, words: said, loudness })
          const written = await writeChecked({
            first: brief,
            call: (request) => composeSound({ ...llm, brief: request, signal }),
            lint: lintCompose,
            check: (code) => renderer.check({ code, seconds, words: said, loudness }),
            repair: ({ brief: first, text, problems }) => soundRepairBrief({ brief: first, code: text, problems }),
            signal,
          })
          if (!("text" in written)) return { ok: false, why: written.failed }
          const job = { code: codeOf(written.text), seconds, words: said, loudness }
          await renderer.ensure([job])
          if ((await renderer.statusOf(job)) !== "ready") return { ok: false, why: "เรนเดอร์เสียงไม่สำเร็จ" }
          const path = renderer.fileOf(job)
          const draft = await loadDraft(folder)
          const binId = binIdOf(draft.meta, path) ?? randomUUID()
          const durationUs = Math.round(seconds * 1_000_000)
          return { ok: true, sound: { atUs, durationUs, path, binId }, binItem: soundBinItem({ id: binId, path, durationUs, nowMs: now() }) }
        },

        librarySound(name, atUs) {
          // the library is read when the footage is, so this answers from what the request listed
          const found = librarySounds.get(folder)?.find((sound) => sound.name === name || name.startsWith(`${sound.name} (`))
          return found ? { ok: true, cue: { atUs, effectId: found.effectId, name: found.name, path: found.path, durationUs: found.durationUs } } : { ok: false, why: `ไม่มีเสียง "${name}" ในคลัง` }
        },
      }
    },

    /** Reads the sound library for a project, so `librarySound` can answer at once. */
    async loadSounds(folder: string): Promise<void> {
      librarySounds.set(folder, deps.sounds ? await deps.sounds.list() : [])
    },
  }
}

const librarySounds = new Map<string, Awaited<ReturnType<SoundLibrary["list"]>>>()

export type AgentWiring = ReturnType<typeof createAgentWiring>
