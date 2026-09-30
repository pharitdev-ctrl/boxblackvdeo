// The looks the app has seen CapCut 9.4 draw. Kept free of runtime dependencies so the renderer can import it.

/** How much of the emphasis gets effects: light the key points, medium the key and secondary ones, heavy every point (see LEVEL_IMPORTANCE). */
export const FLAIR_LEVELS = ["light", "medium", "heavy"] as const
export type FlairLevel = (typeof FLAIR_LEVELS)[number]

/** What the user sets for the whole project. */
export interface FlairOptions {
  /** @deprecated since M25 nothing reads it: each work has its own switch; kept so settings files and requests still carry it */
  enabled: boolean
  level: FlairLevel
  /** how the highlight text looks */
  text: boolean
  /** sound effects on the rough cut */
  sound: boolean
  /** the picture moving: punch-ins and drifts */
  zoom: boolean
  /** cutting away to the project's own photos and clips */
  insert: boolean
  /** motion graphics rendered over the picture; off until the user turns it on, since it needs the renderer pack */
  graphic: boolean
}
/** Every work on at the middle level, but the graphics, which need the renderer pack (spec §2). */
export const DEFAULT_FLAIR_OPTIONS: FlairOptions = { enabled: true, level: "medium", text: true, sound: true, zoom: true, insert: true, graphic: false }

export const TEXT_PATTERNS = ["stack", "punch", "bar", "stair"] as const
export type TextPattern = (typeof TEXT_PATTERNS)[number]

export interface PatternEntry {
  id: TextPattern
  /** shown to the user */
  name: string
  /** what it suits, for Claude to choose by */
  mood: string
  /** how many lines a group must have for it */
  lines: { min: number; max: number }
  /** only on portrait and square output: CapCut draws its shapes to another scale on wide canvases */
  portraitOnly?: boolean
}

export const TEXT_PATTERNS_BY_ID: Record<TextPattern, PatternEntry> = {
  stack: { id: "stack", name: "ซ้อนกลาง", mood: "แบบมาตรฐาน ซ้อนบรรทัดตามที่พูด ใช้ได้กับทุกชุด", lines: { min: 1, max: 3 } },
  punch: { id: "punch", name: "คำเดียวเต็มจอ", mood: "คำสั้นคำเดียวตัวใหญ่เต็มความกว้าง ใช้ตอนต้องการกระแทกตา", lines: { min: 1, max: 1 } },
  bar: { id: "bar", name: "แถบสีหลังข้อความ", mood: "มีแถบสีรองข้อความ อ่านง่ายบนภาพรก เหมาะกับราคาหรือข้อเสนอ", lines: { min: 1, max: 3 }, portraitOnly: true },
  stair: { id: "stair", name: "บันไดสลับซ้ายขวา", mood: "บรรทัดเยื้องสลับข้าง ดูมีจังหวะ เหมาะกับประโยคที่พูดต่อกันเร็ว", lines: { min: 2, max: 3 } },
}

/**
 * CapCut "out" text animations, named by resource id like the "in" ones in highlights/styles.ts.
 * Read out of a draft CapCut 9.4 wrote itself after the animations were chosen in its panel
 * (0917, 2026-09-18). An id CapCut does not know is ignored, so the worst case is no animation.
 *
 * Each id must be one no other CapCut animation answers to. เลือนหาย (6724919382104871427) is also
 * the old id of another animation in CapCut's catalogue; on 2026-09-23 CapCut resolved it to that
 * one, dropped its file and showed the text's animation as lost. The fades are now จางหายหลอน ๆ,
 * จางหายหม่นหมอง and อัลเทอร์เนตเฟด, each downloaded by id on 0917 the same day. Every exit needs CapCut
 * Pro (see `pro`), so Claude picks one per group only for a user who has it; without Pro none is offered,
 * shown or written (one stored stays stored).
 */
export interface ExitAnimation {
  id: string
  /** shown to the user */
  name: string
  /** what CapCut downloads it by */
  resourceId: string
  /**
   * needs CapCut Pro to export, and all five do. หมุนหายไป by CapCut's own cached panel data (paid_type
   * "subscribe", its export needs the Pro package; read 2026-09-29). อัลเทอร์เนตเฟด by CapCut 9.5's export
   * dialog, which on 2026-09-29 listed it as Pro content and would not export it without Pro, although its
   * cached entry said free: the export dialog decides, not the cache. จางหายหลอน ๆ, จางหายหม่นหมอง and
   * แตกกระจาย were never seen free, so they count as Pro. A resource whose status is not known counts as Pro
   * (the user's decision, 2026-09-29; where to look: spec 0.4.2 §1.2, CapCut's `ressdk_db/<id>/rp.db`,
   * `get_panel_info`, and above all the export dialog).
   */
  pro: boolean
}
export const EXIT_ANIMATIONS: ExitAnimation[] = [
  { id: "fade-out", name: "จางหายหลอน ๆ", resourceId: "7644574121141062913", pro: true },
  { id: "fade-dim", name: "จางหายหม่นหมอง", resourceId: "7648937969314843924", pro: true },
  { id: "fade-alt", name: "อัลเทอร์เนตเฟด", resourceId: "7646374090143567112", pro: true },
  { id: "spin-out", name: "หมุนหายไป", resourceId: "7664531039884152084", pro: true },
  { id: "burst-out", name: "แตกกระจาย", resourceId: "7667414562756562183", pro: true },
]

export const exitById = (id: string): ExitAnimation | undefined => EXIT_ANIMATIONS.find((animation) => animation.id === id)

/** The exits a user may have: every one with CapCut Pro, the free ones without. Since 0.4.3 none is free, so without Pro the list is empty. */
export const exitsFor = (pro: boolean): ExitAnimation[] => EXIT_ANIMATIONS.filter((animation) => pro || !animation.pro)

/** An exit as it may be written: known, and free unless the user has CapCut Pro; null otherwise. */
export const usableExit = (id: string | null, pro: boolean): string | null => {
  const animation = id === null ? undefined : exitById(id)
  return animation !== undefined && (pro || !animation.pro) ? animation.id : null
}

/** The patterns this shape of video can draw, in catalogue order: every one at every level, but those only portrait output draws on a wide one. */
export const patternsFor = (landscape = false): PatternEntry[] => TEXT_PATTERNS.map((id) => TEXT_PATTERNS_BY_ID[id]).filter((entry) => !(landscape && entry.portraitOnly))
