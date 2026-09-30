import type { SubjectBox } from "../flair/look-at.ts"

export interface Box {
  width: number
  height: number
}

/**
 * How an inserted picture is laid on the frame. CapCut draws a picture "fit" at scale 1 — one of
 * its sides exactly spans the canvas — and `transform` moves it in half-canvases, +1 being the top
 * or the right edge. Everything here is worked out from that.
 */
export interface Framing {
  scale: number
  /** in CapCut's transform units, +1 being half a canvas right and up */
  x: number
  y: number
  /** what the picture ends up covering on screen, in pixels */
  drawn: Box
}

/** How much bigger than "fit" the picture must be drawn to cover the whole frame. */
export function coverScale(media: Box, canvas: Box): number {
  if (media.width <= 0 || media.height <= 0) return 1
  const wide = canvas.width / media.width
  const tall = canvas.height / media.height
  return Math.max(wide, tall) / Math.min(wide, tall)
}

/** The picture's size on screen at scale 1: one side spans the canvas, the other is shorter. */
function fitted(media: Box, canvas: Box): Box {
  const fit = Math.min(canvas.width / media.width, canvas.height / media.height)
  return { width: media.width * fit, height: media.height * fit }
}

/** A picture whose subject is smaller than this share of the frame is not blown up any further. */
const MAX_COVER = 2.5
/** How wide a card is, as a share of the canvas. */
const CARD_WIDTH = 0.62
/** Where a card sits when the picture behind it says nothing about what must stay clear. */
const CARD_CENTRE = 0.675

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * The whole frame, filled by the subject rather than by the middle of the picture: the picture is
 * blown up until the subject's box spans the canvas and moved until that box is centred, so the
 * background around it falls outside the frame. Without a subject it is the plain cover of before.
 */
export function coverFraming(media: Box, canvas: Box, subject: SubjectBox | null): Framing {
  if (media.width <= 0 || media.height <= 0) return { scale: 1, x: 0, y: 0, drawn: { width: canvas.width, height: canvas.height } }
  const base = fitted(media, canvas)
  const cover = coverScale(media, canvas)
  if (!subject) {
    const drawn = { width: base.width * cover, height: base.height * cover }
    return { scale: cover, x: 0, y: 0, drawn }
  }
  const wide = canvas.width / (base.width * (subject.x1 - subject.x0))
  const tall = canvas.height / (base.height * (subject.y1 - subject.y0))
  // either side of the max is already at least the plain cover, so only the cap can bite
  const scale = Math.min(Math.max(wide, tall), cover * MAX_COVER)
  const drawn = { width: base.width * scale, height: base.height * scale }

  // bring the subject's middle to the middle of the frame, without letting an edge of the picture show
  const overflowX = Math.max(0, drawn.width / canvas.width - 1)
  const overflowY = Math.max(0, drawn.height / canvas.height - 1)
  const x = clamp((-((subject.x0 + subject.x1) / 2 - 0.5) * drawn.width) / (canvas.width / 2), -overflowX, overflowX)
  const y = clamp((((subject.y0 + subject.y1) / 2 - 0.5) * drawn.height) / (canvas.height / 2), -overflowY, overflowY)
  return { scale, x, y, drawn }
}

/**
 * A card over the video: the whole picture at 62 % of the canvas width, in the taller of the bands
 * the picture behind it leaves free, so the speaker's face — or whatever else must stay clear —
 * is still seen beside it.
 */
export function cardFraming(media: Box, canvas: Box, keepClear: { fromY: number; toY: number } | null): Framing {
  if (media.width <= 0 || media.height <= 0) return { scale: 1, x: 0, y: 0, drawn: { width: canvas.width, height: canvas.height } }
  const base = fitted(media, canvas)
  const scale = (CARD_WIDTH * canvas.width) / base.width
  const drawn = { width: base.width * scale, height: base.height * scale }
  const half = drawn.height / canvas.height / 2

  let centre = CARD_CENTRE
  if (keepClear) {
    const above = keepClear.fromY
    const below = 1 - keepClear.toY
    centre = above > below ? above / 2 : (keepClear.toY + 1) / 2
  }
  // inside the frame whatever the bands say; a card taller than its band overlaps it rather than hanging off
  centre = clamp(centre, half, 1 - half)
  return { scale, x: 0, y: 1 - 2 * centre, drawn }
}
