import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runProcess } from "@boxblack/core/media"
import { layersAt, type DrawTile, type PreviewDraft, type PreviewLayer } from "@boxblack/core/preview"
import type { AgentTimeline } from "@boxblack/core/timeline"
import type { DrawPage } from "./preview-window.ts"

/** The user's preview: 540 wide, 15 frames a second (plan phase 4, decision 7). */
export const VIDEO_WIDTH = 540
export const VIDEO_FPS = 15
const FALLBACK_FONT = "Thonburi"

export interface PreviewVideo {
  /** names the preview's folder: the hash of the project and the timeline it shows */
  id: string
  durationUs: number
  /** how many frames, at VIDEO_FPS, named 00001.jpg and on */
  frames: number
  fps: number
  /** whether it has a sound (audio.wav): a clip with no sound at all has none */
  audio: boolean
  /** what could not be drawn, one line each */
  skipped: string[]
}

export interface PreviewVideoDeps {
  ffmpeg: string
  /** where the finished previews are kept (the media scheme serves them from here) */
  dir: string
  page: Pick<DrawPage, "draw">
  draftOf: (folder: string, timeline: AgentTimeline) => Promise<PreviewDraft>
  run?: (command: string, args: string[], options: { signal?: AbortSignal }) => Promise<unknown>
  exists?: (path: string) => boolean
}

type VideoLayer = Extract<PreviewLayer, { kind: "video" }>

/** A preview's file name stem: hex only, so the media scheme can tell one from any other path. */
export const isPreviewId = (id: string) => /^[0-9a-f]{24}$/.test(id)

/**
 * Makes the user's preview of a timeline: every frame at VIDEO_FPS drawn the way Claude's looks are (the same draft,
 * the same page) and kept as JPEGs, and the main video's sound with every sound mixed under it as a WAV, which the tab
 * plays together. Not an MP4: the ffmpeg the app ships is LGPL and encodes no H.264 or AAC (scripts/build-ffmpeg.sh).
 * The frames of each video segment are pulled in one ffmpeg run. One preview of the same project and timeline is made
 * once and kept; a new timeline makes a new one. One is made at a time.
 */
export function createPreviewVideo(deps: PreviewVideoDeps) {
  const run = deps.run ?? ((command, args, options) => runProcess(command, args, options))
  const exists = deps.exists ?? existsSync
  let turns: Promise<unknown> = Promise.resolve()

  async function makeNow(folder: string, timeline: AgentTimeline, signal?: AbortSignal): Promise<PreviewVideo> {
    const id = createHash("sha1").update(`${folder}\n${JSON.stringify(timeline)}`).digest("hex").slice(0, 24)
    const out = join(deps.dir, id)
    const draft = await deps.draftOf(folder, timeline)
    const manifest = join(out, "preview.json")
    if (exists(manifest)) return { ...(JSON.parse(await readFile(manifest, "utf8")) as PreviewVideo), skipped: draft.skipped }
    const work = join(deps.dir, `${id}.work`)
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true })
    try {
      const height = Math.round((VIDEO_WIDTH * draft.canvas.height) / draft.canvas.width / 2) * 2
      const count = Math.max(1, Math.ceil((draft.durationUs / 1_000_000) * VIDEO_FPS))
      const moments = Array.from({ length: count }, (_, n) => Math.round((n * 1_000_000) / VIDEO_FPS))
      const shown = moments.map((atUs) => layersAt(draft, atUs))

      // the frames of each video segment, pulled in one run from the first moment it shows
      const frameOf = new Map<string, string>()
      const bySegment = new Map<string, { layer: VideoLayer; key: string }[]>()
      shown.forEach((layers, n) =>
        layers.forEach((layer, i) => {
          if (layer.kind !== "video") return
          const list = bySegment.get(layer.segmentId) ?? []
          list.push({ layer, key: `${n}:${i}` })
          bySegment.set(layer.segmentId, list)
        }),
      )
      let segmentIndex = 0
      for (const [, list] of bySegment) {
        if (signal?.aborted) throw signal.reason ?? new Error("stopped")
        const first = list[0]!.layer
        const folderOf = join(work, `s${segmentIndex++}`)
        await mkdir(folderOf)
        const ext = first.overlay ? "png" : "jpg"
        const frames = first.photo ? 1 : list.length
        const args = [
          "-nostdin", "-v", "error", "-y",
          ...(!first.photo && first.sourceUs > 0 ? ["-ss", (first.sourceUs / 1_000_000).toFixed(3)] : []),
          "-i", first.file,
          "-frames:v", String(frames),
          "-vf", `${first.photo ? "" : `fps=${VIDEO_FPS / first.speed},`}scale='min(${VIDEO_WIDTH},iw)':-2`,
          ...(first.overlay ? ["-pix_fmt", "rgba"] : ["-q:v", "4"]),
          join(folderOf, `%05d.${ext}`),
        ]
        try {
          await run(deps.ffmpeg, args, { signal })
        } catch (error) {
          if (signal?.aborted) throw error
          continue
        }
        const files = (await readdir(folderOf)).sort()
        list.forEach(({ key }, k) => {
          const file = files[Math.min(first.photo ? 0 : k, files.length - 1)]
          if (file) frameOf.set(key, join(folderOf, file))
        })
      }

      // drawn a frame at a time, in the app's own fonts where the draft names them
      const fonts = [...new Set(shown.flatMap((layers) => layers.flatMap((layer) => (layer.kind === "text" && layer.fontFile && exists(layer.fontFile) ? [layer.fontFile] : []))))]
      const framesDir = join(work, "frames")
      await mkdir(framesDir)
      for (const [n, layers] of shown.entries()) {
        if (signal?.aborted) throw signal.reason ?? new Error("stopped")
        const tile: DrawTile = {
          label: "",
          layers: await Promise.all(
            layers.map(async (layer, i) => {
              if (layer.kind !== "video") return layer
              const file = frameOf.get(`${n}:${i}`)
              const src = file ? `data:image/${layer.overlay ? "png" : "jpeg"};base64,${(await readFile(file)).toString("base64")}` : null
              return { ...layer, src }
            }),
          ),
        }
        const jpeg = await deps.page.draw([tile], { canvas: draft.canvas, tile: { width: VIDEO_WIDTH, height }, columns: 1, fallbackFont: FALLBACK_FONT }, fonts)
        await writeFile(join(framesDir, `${String(n + 1).padStart(5, "0")}.jpg`), jpeg)
      }

      // the sound: every part trimmed, set at its place and mixed (spike B)
      const inputs: string[] = []
      const filters: string[] = []
      draft.sounds.forEach((sound, i) => {
        inputs.push("-i", sound.file)
        filters.push(`[${i}:a]atrim=start=${sound.sourceUs / 1e6}:duration=${sound.durationUs / 1e6},asetpts=PTS-STARTPTS,volume=${sound.volume},adelay=${Math.round(sound.startUs / 1000)}:all=1[a${i}]`)
      })
      const audio =
        draft.sounds.length > 0
          ? [...inputs, "-filter_complex", `${filters.join(";")};${draft.sounds.map((_, i) => `[a${i}]`).join("")}amix=inputs=${draft.sounds.length}:normalize=0:duration=longest[aout]`, "-map", "[aout]"]
          : []
      if (audio.length > 0) await run(deps.ffmpeg, ["-nostdin", "-v", "error", "-y", ...audio, "-c:a", "pcm_s16le", "-ar", "44100", "-t", String(draft.durationUs / 1e6), join(framesDir, "audio.wav")], { signal })
      const made: PreviewVideo = { id, durationUs: draft.durationUs, frames: count, fps: VIDEO_FPS, audio: audio.length > 0, skipped: draft.skipped }
      await writeFile(join(framesDir, "preview.json"), JSON.stringify(made))
      await rm(out, { recursive: true, force: true })
      await rename(framesDir, out)
      return made
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  return {
    /** The preview of a timeline, made now unless it was made before; one at a time. */
    make(folder: string, timeline: AgentTimeline, signal?: AbortSignal): Promise<PreviewVideo> {
      const mine = turns.then(() => makeNow(folder, timeline, signal))
      turns = mine.catch(() => undefined)
      return mine
    },
    /** A file of a preview (a frame, its sound), or null for anything that is not one. */
    fileOf(id: string, name: string): string | null {
      return isPreviewId(id) && /^(\d{5}\.jpg|audio\.wav)$/.test(name) ? join(deps.dir, id, name) : null
    },
  }
}

export type PreviewVideoMaker = ReturnType<typeof createPreviewVideo>
