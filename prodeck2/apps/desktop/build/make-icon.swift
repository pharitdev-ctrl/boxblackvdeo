// Draws the app icon from the mascot (build/mascot-wave.png, cut out of its background with Vision):
// the puppy's head and waving paw on a dark tile, the way BOXBLACK is black.
//   swift build/make-icon.swift && iconutil -c icns build/icon.iconset -o build/icon.icns
import AppKit

let sizes: [(String, Int)] = [
  ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
  ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
  ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
let dir = URL(fileURLWithPath: "build/icon.iconset")
try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
let mascot = NSImage(contentsOf: URL(fileURLWithPath: "build/mascot-wave.png"))!
let full = mascot.representations.first!
let (w, h) = (CGFloat(full.pixelsWide), CGFloat(full.pixelsHigh))
// the head, the paw and the collar: the top 62 % of the cut-out
let crop = NSRect(x: 0, y: h * 0.38, width: w, height: h * 0.62)

for (name, pixels) in sizes {
  let s = CGFloat(pixels)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current!.imageInterpolation = .high
  // macOS icon grid: the tile is about 80% of the canvas
  let inset = s * 0.1
  let tile = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
  let path = NSBezierPath(roundedRect: tile, xRadius: tile.width * 0.225, yRadius: tile.width * 0.225)
  NSGradient(starting: NSColor(white: 0.24, alpha: 1), ending: NSColor(white: 0.06, alpha: 1))!.draw(in: path, angle: -90)
  // the puppy fills the tile's width and stands on its bottom edge, clipped to the tile
  path.addClip()
  let scale = tile.width * 1.02 / crop.width
  let drawn = NSRect(x: tile.midX - crop.width * scale / 2, y: tile.minY, width: crop.width * scale, height: crop.height * scale)
  mascot.draw(in: drawn, from: crop, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  try rep.representation(using: .png, properties: [:])!.write(to: dir.appendingPathComponent("\(name).png"))
}
