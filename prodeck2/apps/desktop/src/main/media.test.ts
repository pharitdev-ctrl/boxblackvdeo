import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ProjectDetail } from "../shared/api.ts"
import { mediaUrl, parseMediaUrl, previewMediaUrl } from "../shared/media-url.ts"
import { createMediaHandler, createThumbnailer, fileResponse, resolveMediaPath } from "./media.ts"

const project: ProjectDetail = {
  name: "โปรเจค ทดสอบ",
  folder: "/Users/me/Movies/CapCut/User Data/Projects/com.lveditor.draft/โปรเจค ทดสอบ",
  capcutVersion: "9.4.0",
  versionTested: true,
  fps: 30,
  canvas: { width: 1080, height: 1920 },
  timelineSegmentCount: 0,
  videos: [
    { id: "v-1", path: "/Users/me/clips/talk.mov", name: "talk.mov", durationUs: 1, width: 1, height: 1, exists: true },
    { id: "v-gone", path: "/Users/me/clips/gone.mov", name: "gone.mov", durationUs: 1, width: 1, height: 1, exists: false },
  ],
}

const inspect = async (folder: string) => {
  if (folder !== project.folder) throw new Error(`${folder} is not a CapCut project`)
  return project
}

test("a media URL carries the project folder and video id, whatever characters they contain", () => {
  const url = mediaUrl(project.folder, "v-1")
  expect(url.startsWith("boxblack-media://video/")).toBe(true)
  expect(parseMediaUrl(url)).toEqual({ folder: project.folder, videoId: "v-1" })
})

test("URLs that are not video URLs of this scheme are rejected", () => {
  expect(parseMediaUrl("boxblack-media://other/a/b")).toBeNull()
  expect(parseMediaUrl("file:///etc/passwd")).toBeNull()
  expect(parseMediaUrl("boxblack-media://video/only-one-part")).toBeNull()
})

test("a media URL resolves to the file of a video in a registered project", async () => {
  expect(await resolveMediaPath(mediaUrl(project.folder, "v-1"), inspect)).toBe("/Users/me/clips/talk.mov")
})

test("a media URL for any other file resolves to nothing", async () => {
  expect(await resolveMediaPath(mediaUrl("/etc", "v-1"), inspect)).toBeNull()
  expect(await resolveMediaPath(mediaUrl(project.folder, "v-2"), inspect)).toBeNull()
  expect(await resolveMediaPath(mediaUrl(project.folder, "v-gone"), inspect)).toBeNull()
  expect(await resolveMediaPath("boxblack-media://video/..%2F..%2Fetc/passwd", inspect)).toBeNull()
})

test("a thumbnail is a JPEG data URL of the frame at that moment, made once", async () => {
  const extracted: [string, number][] = []
  const thumbnail = createThumbnailer({
    inspect,
    extract: async (input, atUs) => {
      extracted.push([input, atUs])
      return Buffer.from([0xff, 0xd8, 0xff])
    },
  })
  expect(await thumbnail(project.folder, "v-1", 4_000_000)).toBe("data:image/jpeg;base64,/9j/")
  await thumbnail(project.folder, "v-1", 4_000_000)
  expect(extracted).toEqual([["/Users/me/clips/talk.mov", 4_000_000]])
})

test("no thumbnail for unknown videos or when the frame cannot be extracted", async () => {
  const thumbnail = createThumbnailer({
    inspect,
    extract: async () => {
      throw new Error("ffmpeg failed")
    },
  })
  expect(await thumbnail("/etc", "v-1", 0)).toBeNull()
  expect(await thumbnail(project.folder, "v-1", 0)).toBeNull()
})

/** A 100-byte file whose byte n has the value n. */
async function numberedFile(name = "clip.mov"): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "boxblack-range-")), name)
  await writeFile(path, Buffer.from(Array.from({ length: 100 }, (_, n) => n)))
  return path
}

const bytesOf = async (response: Response) => [...new Uint8Array(await response.arrayBuffer())]
const numbers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, n) => from + n)

test("a whole file is served with its length and an offer of byte ranges", async () => {
  const response = await fileResponse(await numberedFile(), null)
  expect(response.status).toBe(200)
  expect(response.headers.get("content-length")).toBe("100")
  expect(response.headers.get("accept-ranges")).toBe("bytes")
  expect(response.headers.get("content-type")).toBe("video/quicktime")
  expect(await bytesOf(response)).toEqual(numbers(0, 99))
})

test("a byte range is served as partial content, so <video> can seek", async () => {
  const path = await numberedFile()
  const middle = await fileResponse(path, "bytes=10-19")
  expect(middle.status).toBe(206)
  expect(middle.headers.get("content-range")).toBe("bytes 10-19/100")
  expect(middle.headers.get("content-length")).toBe("10")
  expect(await bytesOf(middle)).toEqual(numbers(10, 19))

  const rest = await fileResponse(path, "bytes=90-")
  expect(rest.headers.get("content-range")).toBe("bytes 90-99/100")
  expect(await bytesOf(rest)).toEqual(numbers(90, 99))

  const pastTheEnd = await fileResponse(path, "bytes=95-500")
  expect(pastTheEnd.headers.get("content-range")).toBe("bytes 95-99/100")

  const lastFive = await fileResponse(path, "bytes=-5")
  expect(lastFive.headers.get("content-range")).toBe("bytes 95-99/100")
  expect(await bytesOf(lastFive)).toEqual(numbers(95, 99))
})

test("a range starting past the end cannot be served", async () => {
  const response = await fileResponse(await numberedFile(), "bytes=100-")
  expect(response.status).toBe(416)
  expect(response.headers.get("content-range")).toBe("bytes */100")
})

test("a Range header it does not understand gets the whole file", async () => {
  const path = await numberedFile()
  for (const header of ["bytes=20-10", "bytes=0-1,5-6", "items=0-5", "bytes=abc"]) {
    const response = await fileResponse(path, header)
    expect(response.status, header).toBe(200)
    expect(await bytesOf(response)).toHaveLength(100)
  }
})

test("the content type follows the file extension", async () => {
  expect((await fileResponse(await numberedFile("a.MP4"), null)).headers.get("content-type")).toBe("video/mp4")
  expect((await fileResponse(await numberedFile("a.webm"), null)).headers.get("content-type")).toBe("video/webm")
  expect((await fileResponse(await numberedFile("a.xyz"), null)).headers.get("content-type")).toBe("application/octet-stream")
})

test("a file that has gone is not found", async () => {
  expect((await fileResponse("/nowhere/clip.mov", null)).status).toBe(404)
})

test("the media handler serves ranges of registered videos only", async () => {
  const path = await numberedFile()
  const handler = createMediaHandler(async (folder) => ({
    ...(await inspect(folder)),
    videos: [{ ...project.videos[0]!, path }],
  }))
  const partial = await handler(new Request(mediaUrl(project.folder, "v-1"), { headers: { range: "bytes=50-51" } }))
  expect(partial.status).toBe(206)
  expect(await bytesOf(partial)).toEqual([50, 51])
  expect((await handler(new Request(mediaUrl(project.folder, "v-2")))).status).toBe(404)
  expect((await handler(new Request(mediaUrl("/etc", "v-1")))).status).toBe(404)
})

test("the media handler serves a preview's frames and sound only as the preview maker names them", async () => {
  const path = await numberedFile()
  const named: [string, string][] = []
  const handler = createMediaHandler(inspect, (id, name) => (named.push([id, name]), id === "0123456789abcdef01234567" && name === "00001.jpg" ? path : null))
  const frame = await handler(new Request(previewMediaUrl("0123456789abcdef01234567", "00001.jpg")))
  expect(frame.status).toBe(200)
  expect((await handler(new Request(previewMediaUrl("0123456789abcdef01234567", "../../etc/passwd")))).status).toBe(404)
  expect(named.at(-1)).toEqual(["0123456789abcdef01234567", "../../etc/passwd"])
  // without a preview maker no preview is served
  expect((await createMediaHandler(inspect)(new Request(previewMediaUrl("0123456789abcdef01234567", "00001.jpg")))).status).toBe(404)
})
