import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname } from "node:path"
import { Readable } from "node:stream"
import type { ProjectDetail } from "../shared/api.ts"
import { parseMediaUrl } from "../shared/media-url.ts"

type Inspect = (folder: string) => Promise<ProjectDetail>

async function videoPath(inspect: Inspect, folder: string, videoId: string): Promise<string | null> {
  try {
    const project = await inspect(folder)
    return project.videos.find((video) => video.id === videoId && video.exists)?.path ?? null
  } catch {
    return null
  }
}

/**
 * The file behind a media URL — only ever a video in the media bin of a project CapCut
 * registered, so the renderer cannot use the scheme to read anything else on disk.
 */
export async function resolveMediaPath(url: string, inspect: Inspect): Promise<string | null> {
  const parsed = parseMediaUrl(url)
  return parsed ? videoPath(inspect, parsed.folder, parsed.videoId) : null
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
}

/** The one byte range a Range header asks for, clamped to the file; null for anything else, which gets the whole file. */
function byteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const length = Math.min(Number(match[2]), size)
    return length > 0 ? { start: size - length, end: size - 1 } : "unsatisfiable"
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size) return "unsatisfiable"
  return start <= end ? { start, end } : null
}

/**
 * A file with byte-range support. net.fetch on a file URL ignores the Range header and answers
 * 200 without a length, which leaves a <video> unable to seek: it stays at the start of the clip.
 */
export async function fileResponse(path: string, rangeHeader: string | null): Promise<Response> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return new Response("not found", { status: 404 })
  }
  const headers = { "accept-ranges": "bytes", "content-type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream" }
  const range = byteRange(rangeHeader, size)
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } })
  const { start, end } = range ?? { start: 0, end: size - 1 }
  const body = size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>)
  return new Response(body, {
    status: range ? 206 : 200,
    headers: { ...headers, "content-length": String(end - start + 1), ...(range && { "content-range": `bytes ${start}-${end}/${size}` }) },
  })
}

/** Answers the renderer's media requests: registered videos only, in byte ranges. */
export function createMediaHandler(inspect: Inspect) {
  return async (request: Request): Promise<Response> => {
    const path = await resolveMediaPath(request.url, inspect)
    return path ? fileResponse(path, request.headers.get("range")) : new Response("not found", { status: 404 })
  }
}

/** Frame previews for outline beats, kept in memory once made. */
export function createThumbnailer(deps: { inspect: Inspect; extract: (input: string, atUs: number) => Promise<Buffer> }) {
  const made = new Map<string, Promise<string | null>>()
  return (folder: string, videoId: string, atUs: number): Promise<string | null> => {
    const key = JSON.stringify([folder, videoId, atUs])
    let thumbnail = made.get(key)
    if (!thumbnail) {
      thumbnail = (async () => {
        const path = await videoPath(deps.inspect, folder, videoId)
        if (!path) return null
        try {
          return `data:image/jpeg;base64,${(await deps.extract(path, atUs)).toString("base64")}`
        } catch {
          return null
        }
      })()
      made.set(key, thumbnail)
    }
    return thumbnail
  }
}
