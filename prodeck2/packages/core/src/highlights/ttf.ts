/** What text layout needs from a font: the line height CapCut sizes text by, and how wide characters are. */
export interface FontMetrics {
  /** OS/2 typo ascender minus typo descender, in em */
  lineHeight: number
  /** advance width in em, by character; characters the font lacks are left out */
  advances: Record<string, number>
}

/**
 * Reads line height and advance widths straight from a TrueType file (head, hhea, hmtx, OS/2 and
 * a format 4 cmap). Only single characters are measured: no shaping, so combining marks count
 * as the zero-width glyphs the font gives them.
 */
export function readFontMetrics(data: Uint8Array, chars: string[]): FontMetrics {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const refuse = () => new Error("not a TrueType font")
  if (data.byteLength < 12 || view.getUint32(0) !== 0x00010000) throw refuse()

  const tables = new Map<string, number>()
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    const tag = String.fromCharCode(...data.subarray(record, record + 4))
    tables.set(tag, view.getUint32(record + 8))
  }
  const table = (tag: string) => {
    const offset = tables.get(tag)
    if (offset === undefined) throw refuse()
    return offset
  }

  const unitsPerEm = view.getUint16(table("head") + 18)
  const numberOfHMetrics = view.getUint16(table("hhea") + 34)
  const hmtx = table("hmtx")
  const os2 = table("OS/2")
  const lineHeight = (view.getInt16(os2 + 68) - view.getInt16(os2 + 70)) / unitsPerEm

  const glyphOf = cmapFormat4(view, table("cmap"))
  const advances: Record<string, number> = {}
  for (const char of chars) {
    const glyph = glyphOf(char.codePointAt(0)!)
    if (glyph === 0) continue
    // glyphs past the last full metric share its advance
    const metric = Math.min(glyph, numberOfHMetrics - 1)
    advances[char] = view.getUint16(hmtx + metric * 4) / unitsPerEm
  }
  return { lineHeight, advances }
}

/** Glyph ids from the first Unicode BMP subtable (platform 0, or platform 3 encoding 1); 0 when missing. */
function cmapFormat4(view: DataView, cmap: number): (codePoint: number) => number {
  const count = view.getUint16(cmap + 2)
  let subtable = -1
  for (let i = 0; i < count && subtable < 0; i++) {
    const record = cmap + 4 + i * 8
    const platform = view.getUint16(record)
    const encoding = view.getUint16(record + 2)
    const offset = cmap + view.getUint32(record + 4)
    if (view.getUint16(offset) === 4 && (platform === 0 || (platform === 3 && encoding === 1))) subtable = offset
  }
  if (subtable < 0) throw new Error("not a TrueType font: no Unicode cmap")

  const segments = view.getUint16(subtable + 6) / 2
  const ends = subtable + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const rangeOffsets = deltas + segments * 2
  return (codePoint) => {
    if (codePoint > 0xffff) return 0
    for (let s = 0; s < segments; s++) {
      if (codePoint > view.getUint16(ends + s * 2)) continue
      const start = view.getUint16(starts + s * 2)
      if (codePoint < start) return 0
      const delta = view.getInt16(deltas + s * 2)
      const rangeOffset = view.getUint16(rangeOffsets + s * 2)
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff
      const glyph = view.getUint16(rangeOffsets + s * 2 + rangeOffset + (codePoint - start) * 2)
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff
    }
    return 0
  }
}

/** The characters measured for highlight text: printable ASCII and the Thai block. */
export const METRIC_CHARS: string[] = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCodePoint(0x20 + i)),
  ...Array.from({ length: 0x0e5b - 0x0e01 + 1 }, (_, i) => String.fromCodePoint(0x0e01 + i)),
]
