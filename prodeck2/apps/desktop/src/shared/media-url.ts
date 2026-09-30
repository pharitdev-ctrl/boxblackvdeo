/** Custom scheme the renderer uses to play a project's videos; the main process decides what it may open. */
export const MEDIA_SCHEME = "boxblack-media"

/**
 * How the main process registers the scheme, before the app is ready. Without `standard`, a <video>
 * fails with MEDIA_ERR_SRC_NOT_SUPPORTED on any clip beyond a couple of MB (Electron 44), while
 * small test clips still play; media-playback.test.ts plays a full-size one.
 */
export const MEDIA_SCHEME_PRIVILEGES = { standard: true, stream: true, supportFetchAPI: true } as const

export function mediaUrl(folder: string, videoId: string): string {
  return `${MEDIA_SCHEME}://video/${encodeURIComponent(folder)}/${encodeURIComponent(videoId)}`
}

export function parseMediaUrl(url: string): { folder: string; videoId: string } | null {
  const prefix = `${MEDIA_SCHEME}://video/`
  if (!url.startsWith(prefix)) return null
  const parts = url.slice(prefix.length).split(/[?#]/)[0]!.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    return { folder: decodeURIComponent(parts[0]), videoId: decodeURIComponent(parts[1]) }
  } catch {
    return null
  }
}
