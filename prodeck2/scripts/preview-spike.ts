/**
 * Agent editor phase 0, spike B: a low-resolution preview of a whole CapCut draft, composed outside CapCut, for
 * Claude to look at its own work. Not shipped; it measures how close such a preview gets to CapCut's export.
 *
 *   node scripts/preview-spike.ts <draft folder> <out folder> [--media <folder>] [--map <name>=<file>]... [--fps 10] [--width 540]
 *
 * Media are found by file name in --media (or mapped one by one with --map, e.g. --map IMG_9861.MOV=small.mov); a
 * file that cannot be found is left out and listed. Needs ffmpeg (FFMPEG or on PATH) and Playwright (PLAYWRIGHT, a
 * module path, or the `playwright` package).
 *
 * Plan: docs/plans/2026-10-03-agent-phase0-spike.md
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

type Json = Record<string, any>

// ---------- arguments ----------
const argv = process.argv.slice(2)
const [draftFolder, outFolder] = argv
if (!draftFolder || !outFolder) {
  console.log("usage: node scripts/preview-spike.ts <draft folder> <out folder> [--media <folder>] [--map <name>=<file>] [--fps 10] [--width 540]")
  process.exit(1)
}
const option = (name: string) => {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] : undefined
}
const maps = new Map<string, string>()
argv.forEach((arg, i) => {
  if (arg === "--map") {
    const [name, file] = argv[i + 1]!.split("=") as [string, string]
    maps.set(name, resolve(file))
  }
})
const mediaFolder = option("--media")
const FPS = Number(option("--fps") ?? 10)
const WIDTH = Number(option("--width") ?? 540)
const FFMPEG = process.env.FFMPEG ?? "ffmpeg"
const out = resolve(outFolder)
mkdirSync(join(out, "frames"), { recursive: true })
mkdirSync(join(out, "layers"), { recursive: true })

const mediaFiles = mediaFolder ? readdirSync(mediaFolder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)) : []
const missing = new Set<string>()
function localOf(path: string): string | null {
  const name = basename(path)
  const found = maps.get(name) ?? mediaFiles.find((file) => basename(file) === name) ?? (existsSync(path) ? path : undefined)
  if (!found) missing.add(name)
  return found ?? null
}

// ---------- the draft ----------
const info = JSON.parse(readFileSync(join(draftFolder, "draft_info.json"), "utf8")) as Json
const canvas = { width: info.canvas_config.width as number, height: info.canvas_config.height as number }
const HEIGHT = Math.round((WIDTH * canvas.height) / canvas.width / 2) * 2
const durationUs = info.duration as number
const frameCount = Math.ceil((durationUs / 1_000_000) * FPS)
const materials = new Map<string, { kind: string; m: Json }>()
for (const [kind, list] of Object.entries(info.materials as Json)) if (Array.isArray(list)) for (const m of list) if (m?.id) materials.set(m.id, { kind, m })

interface Kf {
  property: string
  points: { atUs: number; value: number }[]
}
interface Layer {
  kind: "video" | "text" | "sticker"
  order: number
  startUs: number
  durationUs: number
  sourceStartUs: number
  speed: number
  clip: { scale: number; x: number; y: number; rot: number; alpha: number }
  keyframes: Kf[]
  /** video: a folder of frames, one per output frame index from the segment's start */
  frames?: string
  frameExt?: string
  native?: { width: number; height: number }
  text?: { words: string; size: number; color: number[]; stroke: { width: number; color: number[] } | null; font: string; subtitle: boolean }
  label: string
}
interface Sound {
  file: string
  startUs: number
  durationUs: number
  sourceStartUs: number
  volume: number
}

const layers: Layer[] = []
const sounds: Sound[] = []
const mainAudio: { file: string; startUs: number; durationUs: number; sourceStartUs: number; volume: number }[] = []
const skipped: string[] = []

info.tracks.forEach((track: Json, trackIndex: number) => {
  for (const segment of track.segments as Json[]) {
    const found = materials.get(segment.material_id)
    const target = segment.target_timerange
    const source = segment.source_timerange
    const clip = segment.clip ?? {}
    const base = {
      order: trackIndex * 1000 + (segment.render_index ?? 0) / 1000,
      startUs: target.start,
      durationUs: target.duration,
      sourceStartUs: source?.start ?? 0,
      speed: segment.speed ?? 1,
      clip: { scale: clip.scale?.x ?? 1, x: clip.transform?.x ?? 0, y: clip.transform?.y ?? 0, rot: clip.rotation ?? 0, alpha: clip.alpha ?? 1 },
      keyframes: ((segment.common_keyframes ?? []) as Json[]).map((group) => ({
        property: group.property_type,
        points: (group.keyframe_list as Json[]).map((point) => ({ atUs: point.time_offset, value: point.values[0] })),
      })),
    }
    if (!found) {
      skipped.push(`${track.type} segment with no material at ${target.start / 1e6}s`)
      continue
    }
    const { kind, m } = found
    if (track.type === "audio") {
      const file = localOf(m.path ?? "")
      if (file) sounds.push({ file, startUs: target.start, durationUs: target.duration, sourceStartUs: source?.start ?? 0, volume: segment.volume ?? 1 })
      continue
    }
    if (kind === "videos") {
      const file = localOf(m.path ?? "")
      const label = `video ${basename(m.path ?? "")} @${(target.start / 1e6).toFixed(2)}s`
      if (!file) {
        skipped.push(`${label} (file not found)`)
        continue
      }
      const isMain = trackIndex === 0
      if (isMain) mainAudio.push({ file, startUs: target.start, durationUs: target.duration, sourceStartUs: source?.start ?? 0, volume: segment.volume ?? 1 })
      layers.push({ ...base, kind: "video", native: { width: m.width, height: m.height }, frames: file, label })
    } else if (kind === "texts") {
      let words = ""
      let style: Json = {}
      try {
        const content = JSON.parse(m.content)
        words = content.text
        style = content.styles?.[0] ?? {}
      } catch {
        words = String(m.content ?? "")
      }
      const stroke = style.strokes?.[0]
      layers.push({
        ...base,
        kind: "text",
        label: `text “${words}” @${(target.start / 1e6).toFixed(2)}s`,
        text: {
          words,
          size: style.size ?? m.font_size ?? 15,
          color: style.fill?.content?.solid?.color ?? [1, 1, 1],
          stroke: stroke ? { width: stroke.width, color: stroke.content?.solid?.color ?? [0, 0, 0] } : null,
          font: basename(style.font?.path ?? m.font_path ?? "").replace(/\.(ttf|otf)$/i, ""),
          subtitle: m.type === "subtitle",
        },
      })
    } else {
      skipped.push(`${kind} at ${(target.start / 1e6).toFixed(2)}s (not drawn)`)
    }
  }
})

// ---------- frames of every video layer, at the output's rate ----------
const started = Date.now()
layers.forEach((layer, index) => {
  if (layer.kind !== "video") return
  const folder = join(out, "layers", String(index).padStart(3, "0"))
  mkdirSync(folder, { recursive: true })
  // every track above the main one may be see-through
  const overlay = layer.order >= 1000
  const ext = overlay ? "png" : "jpg"
  // a layer is drawn at most canvas size in the preview; extract no larger than that
  const scale = `scale='min(${WIDTH},iw)':-2`
  const seconds = (layer.durationUs / 1e6) * layer.speed
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", String(layer.sourceStartUs / 1e6), "-t", String(seconds + 0.2), "-i", layer.frames!, "-vf", `fps=${FPS / layer.speed},${scale}`, ...(overlay ? ["-pix_fmt", "rgba"] : ["-q:v", "3"]), join(folder, `%04d.${ext}`)])
  layer.frames = folder
  layer.frameExt = ext
})
const extractedS = (Date.now() - started) / 1000

// ---------- what each frame shows ----------
function valueAt(kfs: Kf[], property: string, sourceUs: number): number | null {
  const kf = kfs.find((one) => one.property === property)
  if (!kf || kf.points.length === 0) return null
  const pts = kf.points
  if (sourceUs <= pts[0]!.atUs) return pts[0]!.value
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    if (sourceUs <= b.atUs) return a.value + ((b.value - a.value) * (sourceUs - a.atUs)) / Math.max(1, b.atUs - a.atUs)
  }
  return pts.at(-1)!.value
}

const plan = Array.from({ length: frameCount }, (_, n) => {
  const tUs = (n / FPS) * 1_000_000
  return layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => tUs >= layer.startUs && tUs < layer.startUs + layer.durationUs)
    .sort((a, b) => a.layer.order - b.layer.order)
    .map(({ layer, index }) => {
      const sourceUs = layer.sourceStartUs + (tUs - layer.startUs) * layer.speed
      const look = {
        scale: valueAt(layer.keyframes, "KFTypeScaleX", sourceUs) ?? layer.clip.scale,
        x: valueAt(layer.keyframes, "KFTypePositionX", sourceUs) ?? layer.clip.x,
        y: valueAt(layer.keyframes, "KFTypePositionY", sourceUs) ?? layer.clip.y,
        rot: valueAt(layer.keyframes, "KFTypeRotation", sourceUs) ?? layer.clip.rot,
        alpha: layer.clip.alpha,
      }
      if (layer.kind === "video") {
        const k = Math.min(Math.floor(((tUs - layer.startUs) / 1e6) * FPS) + 1, readdirSync(layer.frames!).length)
        return { kind: "video", look, src: pathToFileURL(join(layer.frames!, `${String(Math.max(1, k)).padStart(4, "0")}.${layer.frameExt}`)).href, native: layer.native }
      }
      return { kind: "text", look, text: layer.text, index }
    })
})

// ---------- compose in a browser ----------
const playwright = await import(process.env.PLAYWRIGHT ?? "playwright")
const browser = await playwright.chromium.launch()
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
const fontDir = resolve(new URL("../apps/desktop/resources/fonts", import.meta.url).pathname)
const fontFaces = existsSync(fontDir)
  ? readdirSync(fontDir)
      .filter((file) => file.endsWith(".ttf"))
      .map((file) => `@font-face{font-family:"${file.replace(/\.ttf$/, "")}";src:url("${pathToFileURL(join(fontDir, file)).href}")}`)
      .join("")
  : ""
const bundledFonts = existsSync(fontDir) ? readdirSync(fontDir).filter((file) => file.endsWith(".ttf")).map((file) => file.replace(/\.ttf$/, "")) : []
const html = `<html><head><style>${fontFaces} html,body{margin:0;background:#000}</style></head><body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas></body></html>`
writeFileSync(join(out, "compose.html"), html)
await page.goto(pathToFileURL(join(out, "compose.html")).href)
await page.evaluate(() => document.fonts.ready)

const composeStarted = Date.now()
for (let n = 0; n < frameCount; n++) {
  await page.evaluate(
    async ({ items, W, H, canvasW, pxPerSize, fonts, fallbackFont }: any) => {
      const c = document.getElementById("c") as HTMLCanvasElement
      const ctx = c.getContext("2d")!
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, W, H)
      const px = W / canvasW
      const load = (src: string) =>
        new Promise<HTMLImageElement>((done, fail) => {
          const img = new Image()
          img.onload = () => done(img)
          img.onerror = fail
          img.src = src
        })
      for (const item of items as any[]) {
        const { look } = item
        ctx.save()
        // CapCut: position in halves of the canvas from its centre, x right and y up; rotation clockwise in degrees
        ctx.translate((W / 2) * (1 + look.x), (H / 2) * (1 - look.y))
        ctx.rotate((look.rot * Math.PI) / 180)
        ctx.globalAlpha = look.alpha
        if (item.kind === "video") {
          const img = await load(item.src)
          // scale 1 fits the material inside the canvas
          const fit = Math.min(W / item.native.width, H / item.native.height)
          const w = item.native.width * fit * look.scale
          const h = item.native.height * fit * look.scale
          ctx.drawImage(img, -w / 2, -h / 2, w, h)
        } else {
          const t = item.text
          // CapCut's text size in pixels of a 1080-wide canvas, measured against its export; subtitles and texts differ
          const size = t.size * (t.subtitle ? pxPerSize.subtitle : pxPerSize.text) * px * look.scale
          // the text's own font when the app ships it, else a bold Thai system font
          ctx.font = (fonts as string[]).includes(t.font) ? `${size}px "${t.font}"` : `bold ${size}px "${fallbackFont}", sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`
          if (t.stroke && t.stroke.width > 0) {
            ctx.lineJoin = "round"
            ctx.lineWidth = t.stroke.width * size * 2
            ctx.strokeStyle = rgb(t.stroke.color)
            ctx.strokeText(t.words, 0, 0)
          }
          ctx.fillStyle = rgb(t.color)
          ctx.fillText(t.words, 0, 0)
        }
        ctx.restore()
      }
    },
    {
      items: plan[n],
      W: WIDTH,
      H: HEIGHT,
      canvasW: canvas.width,
      pxPerSize: { subtitle: Number(process.env.SUBTITLE_PX_PER_SIZE ?? 3.9), text: Number(process.env.TEXT_PX_PER_SIZE ?? 4.8) },
      fonts: bundledFonts,
      fallbackFont: process.env.TEXT_FONT ?? "Loma",
    },
  )
  // a screenshot, since a canvas that drew local files cannot be read back from the page
  await page.screenshot({ path: join(out, "frames", `${String(n + 1).padStart(4, "0")}.jpg`), type: "jpeg", quality: 85 })
}
await browser.close()
const composeS = (Date.now() - composeStarted) / 1000

// ---------- sound: the main track's own audio, then every sound at its place ----------
const inputs: string[] = []
const filters: string[] = []
const mixed: string[] = []
;[...mainAudio, ...sounds].forEach((part, i) => {
  inputs.push("-i", part.file)
  // input 0 is the frames
  filters.push(`[${i + 1}:a]atrim=start=${part.sourceStartUs / 1e6}:duration=${part.durationUs / 1e6},asetpts=PTS-STARTPTS,volume=${part.volume},adelay=${Math.round(part.startUs / 1000)}:all=1[a${i}]`)
  mixed.push(`[a${i}]`)
})
const audioArgs =
  mixed.length > 0
    ? [...inputs, "-filter_complex", `${filters.join(";")};${mixed.join("")}amix=inputs=${mixed.length}:normalize=0:duration=longest[aout]`, "-map", "[aout]"]
    : []
const encodeStarted = Date.now()
execFileSync(FFMPEG, [
  "-v", "error", "-y",
  "-framerate", String(FPS), "-i", join(out, "frames", "%04d.jpg"),
  ...audioArgs,
  ...(mixed.length > 0 ? ["-map", "0:v"] : []),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-t", String(durationUs / 1e6),
  join(out, "preview.mp4"),
])
// the contact sheet Claude is sent: two frames a second, six across
execFileSync(FFMPEG, ["-v", "error", "-y", "-i", join(out, "preview.mp4"), "-vf", "fps=2,scale=220:-2,tile=6x4", join(out, "sheet_%02d.jpg")])
const encodeS = (Date.now() - encodeStarted) / 1000

const report = [
  `draft ${basename(draftFolder)} · ${(durationUs / 1e6).toFixed(2)} s · canvas ${canvas.width}x${canvas.height} → preview ${WIDTH}x${HEIGHT} at ${FPS} fps (${frameCount} frames)`,
  `layers drawn: ${layers.filter((l) => l.kind === "video").length} video, ${layers.filter((l) => l.kind === "text").length} text · sounds mixed: ${sounds.length} + main track audio`,
  `time: extract ${extractedS.toFixed(1)} s · compose ${composeS.toFixed(1)} s · encode ${encodeS.toFixed(1)} s`,
  ...(missing.size ? [`files not found: ${[...missing].join(", ")}`] : []),
  ...(skipped.length ? ["left out:", ...skipped.map((line) => `  ${line}`)] : []),
]
writeFileSync(join(out, "report.txt"), report.join("\n") + "\n")
console.log(report.join("\n"))
