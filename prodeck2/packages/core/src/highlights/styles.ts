// Kept free of runtime dependencies so the renderer can import it.

import { onSurface, readableAccent, rgbOf, type Rgb } from "./colour.ts"

export type { Rgb } from "./colour.ts"

export const HIGHLIGHT_POSITIONS = ["auto", "top", "middle", "bottom"] as const
export type HighlightPosition = (typeof HIGHLIGHT_POSITIONS)[number]
/** Where the user can pin the text; "auto" is worked out per group from the picture. */
export type FixedPosition = Exclude<HighlightPosition, "auto">

/**
 * The four colours a style draws with. Everything else — the stroke of each range, the text on a
 * bar, the accent on a bar — is worked out from these by the rules in colour.ts, so no palette can
 * put a colour on top of itself.
 */
export interface Palette {
  /** the text of an ordinary group */
  text: Rgb
  /** the accented word, and the whole text of a group in the accent tone */
  accent: Rgb
  /** the second colour: the whole text of a group in the alt tone, and the accent inside an accent-tone group */
  alt: Rgb
  /** the bar behind a line in the bar pattern */
  bar: Rgb
}

export interface HighlightOptions {
  enabled: boolean
  /** where the stacked lines sit on the frame; "auto" dodges what the picture must keep clear, "bottom" stays above the subtitles */
  position: HighlightPosition
  /** leave the words shown as highlight text out of the subtitles */
  hideSubtitles: boolean
  /** the palette of the "custom" style, the user's own four colours */
  custom: Palette
}

/**
 * Fonts shipped in apps/desktop/resources/fonts (SIL OFL). Only fonts whose Thai CapCut 9.4 draws
 * correctly: Prompt, Pridi and Sriracha split "ำ" from its consonant there.
 */
export const HIGHLIGHT_FONTS = {
  kanit: "Kanit-ExtraBold.ttf",
  mali: "Mali-Bold.ttf",
  chonburi: "Chonburi-Regular.ttf",
} as const
export type HighlightFontId = keyof typeof HIGHLIGHT_FONTS

/** A CapCut "in" text animation, named by its resource id; CapCut downloads it when its cache lacks it. */
export interface HighlightAnimation {
  resourceId: string
  name: string
  /**
   * needs CapCut Pro to export: none of the styles' animations does. CapCut's cached panel data said so, and CapCut
   * 9.5's export dialog, which decides, confirmed it on 2026-09-29: a draft with รวมแบบป๊อปอัป, ร่วงเร็ว and
   * ดึงม่านขึ้น went through it with no Pro prompt
   */
  pro: boolean
}

/** Animations CapCut 9.4 played from an id alone. Older ids ("สปริง" 7179946712943825410) did not. */
const POP_UP: HighlightAnimation = { resourceId: "7664531520492686613", name: "รวมแบบป๊อปอัป", pro: false }
const DROP_IN: HighlightAnimation = { resourceId: "7664533258335440148", name: "ร่วงเร็ว", pro: false }
const CURTAIN_UP: HighlightAnimation = { resourceId: "7643711191419833618", name: "ดึงม่านขึ้น", pro: false }

/** The styles Claude may choose between. */
export const PICKABLE_STYLE_IDS = ["bold-white", "bold-black", "sale-yellow", "cute-pink", "headline"] as const
export type PickableStyleId = (typeof PICKABLE_STYLE_IDS)[number]
/** Every style the user may choose, including their own colours. */
export const HIGHLIGHT_STYLE_IDS = [...PICKABLE_STYLE_IDS, "custom"] as const
export type HighlightStyleId = (typeof HIGHLIGHT_STYLE_IDS)[number]

export interface HighlightStyle {
  id: HighlightStyleId
  /** shown to the user */
  name: string
  /** what the style suits, for Claude to choose by */
  mood: string
  font: HighlightFontId
  /** CapCut's stroke width; the stroke's colour is worked out per range from the palette */
  strokeWidth: number
  /** how round the ends of a bar are, in per cent of its height; 50 is a pill */
  barRoundness: number
  palette: Palette
  animation: HighlightAnimation
}

/** How round the ends of a bar are, in per cent of its height; 50 is a pill. */
const PILL = 50
const SOFT = 20

const colour = (hex: string): Rgb => rgbOf(hex)!

/*
 * Palettes after what short-form creators actually use (2025–26 guides): white or warm yellow
 * text with a dark stroke, one accent colour saved for the word that matters, a second colour so
 * the groups of a clip are not all alike, and a bar the text and the accent both read on. Checked
 * by styles.test.ts against the rules in colour.ts.
 */
export const HIGHLIGHT_STYLES: Record<PickableStyleId, HighlightStyle> = {
  "bold-white": {
    id: "bold-white",
    name: "ขาวสะอาด",
    mood: "ใช้ได้กับทุกคลิป ขาวขอบดำอ่านง่ายบนทุกภาพ เน้นด้วยเหลือง",
    font: "kanit",
    strokeWidth: 0.08,
    barRoundness: SOFT,
    palette: { text: colour("#ffffff"), accent: colour("#f7c204"), alt: colour("#8fd3ff"), bar: colour("#1d4ed8") },
    animation: POP_UP,
  },
  "bold-black": {
    id: "bold-black",
    name: "ดำมินิมอล",
    mood: "มินิมอล จริงจัง แบบป้ายรีวิว เหมาะกับภาพพื้นสว่าง เน้นด้วยแดง",
    font: "kanit",
    strokeWidth: 0.06,
    barRoundness: SOFT,
    palette: { text: colour("#111111"), accent: colour("#e63946"), alt: colour("#2f6fed"), bar: colour("#ffffff") },
    animation: POP_UP,
  },
  "sale-yellow": {
    id: "sale-yellow",
    name: "เหลืองขายของ",
    mood: "ขายของ โปรโมชัน ราคา ตื่นเต้น เร่งให้ตัดสินใจ เหลืองอุ่นกับแดง",
    font: "kanit",
    strokeWidth: 0.08,
    barRoundness: SOFT,
    palette: { text: colour("#ffe45c"), accent: colour("#ff5a5f"), alt: colour("#ffffff"), bar: colour("#c1121f") },
    animation: DROP_IN,
  },
  "cute-pink": {
    id: "cute-pink",
    name: "พาสเทลชมพู",
    mood: "น่ารัก สดใส ความงาม แฟชั่น ขนม สัตว์เลี้ยง ขาวเน้นด้วยชมพู",
    font: "mali",
    strokeWidth: 0.08,
    barRoundness: PILL,
    palette: { text: colour("#ffffff"), accent: colour("#ff8fb1"), alt: colour("#ffd166"), bar: colour("#e75480") },
    animation: POP_UP,
  },
  headline: {
    id: "headline",
    name: "พาดหัวคลาสสิก",
    mood: "หรูหรา คลาสสิก ท่องเที่ยว อาหาร เล่าเรื่องสถานที่ ขาวเน้นด้วยทอง",
    font: "chonburi",
    strokeWidth: 0.05,
    barRoundness: 0,
    palette: { text: colour("#ffffff"), accent: colour("#f2c14e"), alt: colour("#7fb7be"), bar: colour("#111111") },
    animation: CURTAIN_UP,
  },
}

/** Highlight text is on unless the user turns it off (spec §2); subtitles stay off by their own default. */
export const DEFAULT_HIGHLIGHT_OPTIONS: HighlightOptions = { enabled: true, position: "auto", hideSubtitles: true, custom: HIGHLIGHT_STYLES["bold-white"].palette }

/** The style in force: a catalogue entry, or the user's own colours on bold-white's font and animation. */
export function styleFor(id: HighlightStyleId, custom: Palette): HighlightStyle {
  if (id !== "custom") return HIGHLIGHT_STYLES[id]
  return { ...HIGHLIGHT_STYLES["bold-white"], id: "custom", name: "กำหนดเอง", mood: "", palette: custom }
}

/** The colour of the accented word on a bar: the first of the palette's colours that reads on it and is not the bar's text colour. */
export function accentOnBar(palette: Palette): Rgb {
  const text = onSurface(palette.bar)
  return readableAccent([palette.accent, palette.alt, palette.text], palette.bar, text)
}

/** The longest line, in characters as the eye counts them, that stays large enough to read. */
export function maxHighlightChars(canvas: { width: number; height: number }): number {
  return canvas.width > canvas.height ? 18 : 12
}
