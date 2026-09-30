// Draws the placeholder app icon until the product has a name and artwork.
//   swift build/make-icon.swift && iconutil -c icns build/icon.iconset -o build/icon.icns
import AppKit

let sizes: [(String, Int)] = [
  ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
  ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
  ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
let dir = URL(fileURLWithPath: "build/icon.iconset")
try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

for (name, pixels) in sizes {
  let s = CGFloat(pixels)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  // macOS icon grid: the tile is about 80% of the canvas
  let inset = s * 0.1
  let tile = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
  let path = NSBezierPath(roundedRect: tile, xRadius: tile.width * 0.225, yRadius: tile.width * 0.225)
  NSGradient(starting: NSColor(red: 0.16, green: 0.45, blue: 1.0, alpha: 1), ending: NSColor(red: 0.45, green: 0.2, blue: 0.9, alpha: 1))!
    .draw(in: path, angle: -60)
  // timeline clips on two tracks, cut by a playhead
  NSColor.white.withAlphaComponent(0.92).setFill()
  let unit = tile.width / 10
  let clips: [(CGFloat, CGFloat, CGFloat)] = [(1.5, 5.6, 3.6), (5.9, 8.5, 3.6), (1.5, 3.9, 5.6), (4.2, 7.2, 5.6)]
  for (from, to, row) in clips {
    let rect = NSRect(x: tile.minX + from * unit, y: tile.minY + row * unit - unit * 0.7, width: (to - from) * unit, height: unit * 1.4)
    NSBezierPath(roundedRect: rect, xRadius: unit * 0.3, yRadius: unit * 0.3).fill()
  }
  NSColor(red: 1.0, green: 0.82, blue: 0.25, alpha: 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: tile.minX + 4.95 * unit, y: tile.minY + 2.2 * unit, width: unit * 0.35, height: unit * 5.2), xRadius: unit * 0.17, yRadius: unit * 0.17).fill()
  NSGraphicsContext.restoreGraphicsState()
  try rep.representation(using: .png, properties: [:])!.write(to: dir.appendingPathComponent("\(name).png"))
}
