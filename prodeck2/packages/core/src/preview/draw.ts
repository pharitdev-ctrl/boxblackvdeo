import type { PreviewLayer } from "./layers.ts"

/** A layer as the drawing page gets it: a video's frame as a picture the page can load (a data URL), or null when it could not be pulled. */
export type DrawLayer = Exclude<PreviewLayer, { kind: "video" }> | (Extract<PreviewLayer, { kind: "video" }> & { src: string | null })

/** One picture of the sheet: its layers, bottom first, and the line written on it (its time). */
export interface DrawTile {
  label: string
  layers: DrawLayer[]
}

export interface DrawOptions {
  /** the draft's canvas, which every layer's pixels are in */
  canvas: { width: number; height: number }
  /** one tile's size in the sheet */
  tile: { width: number; height: number }
  columns: number
  /** the font families the page has loaded, by file name without extension */
  fonts: string[]
  /** what CapCut's own font (subtitles) is drawn in */
  fallbackFont: string
}

/**
 * Draws tiles into a canvas, `columns` across, each the draft's canvas shrunk to the tile with its label in a corner.
 * Runs in the drawing page, handed over as its source text: it must use nothing from outside itself. Answers once
 * every picture has loaded and been drawn.
 */
export async function drawTiles(canvas: HTMLCanvasElement, tiles: DrawTile[], options: DrawOptions): Promise<void> {
  const { tile, columns } = options
  const rows = Math.max(1, Math.ceil(tiles.length / columns))
  canvas.width = tile.width * Math.min(columns, Math.max(1, tiles.length))
  canvas.height = tile.height * rows
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const px = tile.width / options.canvas.width
  const cache = new Map<string, Promise<HTMLImageElement | null>>()
  const load = (src: string) => {
    let found = cache.get(src)
    if (!found) {
      found = new Promise<HTMLImageElement | null>((done) => {
        const img = new Image()
        img.onload = () => done(img)
        img.onerror = () => done(null)
        img.src = src
      })
      cache.set(src, found)
    }
    return found
  }
  const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`

  for (const [index, one] of tiles.entries()) {
    const ox = (index % columns) * tile.width
    const oy = Math.floor(index / columns) * tile.height
    ctx.save()
    ctx.beginPath()
    ctx.rect(ox, oy, tile.width, tile.height)
    ctx.clip()
    for (const layer of one.layers) {
      const { look } = layer
      ctx.save()
      // position in halves of the canvas from its centre, x right and y up; rotation clockwise in degrees
      ctx.translate(ox + (tile.width / 2) * (1 + look.x), oy + (tile.height / 2) * (1 - look.y))
      ctx.rotate((look.rot * Math.PI) / 180)
      ctx.globalAlpha = look.alpha
      if (layer.kind === "video") {
        const img = layer.src ? await load(layer.src) : null
        // scale 1 fits the material inside the canvas
        const fit = Math.min(tile.width / layer.native.width, tile.height / layer.native.height)
        const w = layer.native.width * fit * look.scale
        const h = layer.native.height * fit * look.scale
        if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h)
        else {
          ctx.fillStyle = "#333"
          ctx.fillRect(-w / 2, -h / 2, w, h)
        }
      } else if (layer.kind === "shape") {
        const w = layer.width * px * look.scale
        const h = layer.height * px * look.scale
        const r = Math.min(h / 2, ((layer.roundness / 100) * h) / 2)
        ctx.fillStyle = layer.color
        ctx.beginPath()
        ctx.moveTo(-w / 2 + r, -h / 2)
        ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r)
        ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r)
        ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r)
        ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r)
        ctx.closePath()
        ctx.fill()
      } else {
        const size = layer.sizePx * px * look.scale
        ctx.font = options.fonts.includes(layer.font) ? `${size}px "${layer.font}"` : `bold ${size}px "${options.fallbackFont}", sans-serif`
        ctx.textBaseline = "middle"
        ctx.textAlign = "left"
        ctx.lineJoin = "round"
        const lineHeight = size * 1.2
        const top = (-(layer.lines.length - 1) * lineHeight) / 2
        layer.lines.forEach((runs, i) => {
          const widths = runs.map((run) => ctx.measureText(run.text).width)
          let x = -widths.reduce((sum, w) => sum + w, 0) / 2
          const y = top + i * lineHeight
          // every outline first, so one run's outline never covers the letters beside it
          runs.forEach((run, j) => {
            if (run.stroke) {
              ctx.lineWidth = run.stroke.width * size * 2
              ctx.strokeStyle = rgb(run.stroke.color)
              ctx.strokeText(run.text, x + widths.slice(0, j).reduce((sum, w) => sum + w, 0), y)
            }
          })
          for (const [j, run] of runs.entries()) {
            ctx.fillStyle = rgb(run.color)
            ctx.fillText(run.text, x, y)
            x += widths[j]!
          }
        })
      }
      ctx.restore()
    }
    // the moment's time, small, in the top-left corner, where Claude reads it
    if (one.label) {
      const size = Math.max(12, Math.round(tile.width / 14))
      ctx.font = `bold ${size}px sans-serif`
      ctx.textBaseline = "top"
      ctx.textAlign = "left"
      const w = ctx.measureText(one.label).width
      ctx.globalAlpha = 1
      ctx.fillStyle = "rgba(0,0,0,0.7)"
      ctx.fillRect(ox, oy, w + size * 0.6, size * 1.4)
      ctx.fillStyle = "#ffeb3b"
      ctx.fillText(one.label, ox + size * 0.3, oy + size * 0.2)
    }
    // a thin line between tiles
    ctx.strokeStyle = "#000"
    ctx.lineWidth = 2
    ctx.strokeRect(ox, oy, tile.width, tile.height)
    ctx.restore()
  }
}
