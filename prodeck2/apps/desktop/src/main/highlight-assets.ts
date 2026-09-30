import { copyFile, mkdir, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { HIGHLIGHT_FONTS, type HighlightFontId } from "@boxblack/core/highlights/styles"

/** Where highlight text gets its font file and animation from, on this machine. */
export interface HighlightAssets {
  /** the font's path where CapCut may read it */
  fontPath(font: HighlightFontId): Promise<string>
  /** the animation's folder in CapCut's effect cache, or "" when CapCut has not downloaded it yet */
  animationPath(resourceId: string): Promise<string>
}

const sizeOf = (path: string) => stat(path).then((info) => info.size, () => -1)

/**
 * CapCut is sandboxed: it reads fonts only inside ~/Movies, so the fonts shipped in the app are
 * copied there (`fontDir`) before a draft refers to them.
 */
export function createHighlightAssets(deps: { sourceDir: string; fontDir: string; effectCache: string }): HighlightAssets {
  return {
    async fontPath(font) {
      const file = HIGHLIGHT_FONTS[font]
      const source = join(deps.sourceDir, file)
      const target = join(deps.fontDir, file)
      const shipped = await sizeOf(source)
      if (shipped < 0) throw new Error(`the font ${file} is missing from the app`)
      if ((await sizeOf(target)) !== shipped) {
        await mkdir(deps.fontDir, { recursive: true })
        await copyFile(source, target)
      }
      return target
    },

    async animationPath(resourceId) {
      if (!/^\d+$/.test(resourceId)) return ""
      const dir = join(deps.effectCache, resourceId)
      try {
        const folder = (await readdir(dir, { withFileTypes: true })).find((entry) => entry.isDirectory())
        return folder ? join(dir, folder.name) : ""
      } catch {
        return ""
      }
    },
  }
}
