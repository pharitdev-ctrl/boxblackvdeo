// Prototype: final-masks.py (guided filter r 12 / eps 1e-3 on luma at 1080x1920, then 1-2-3-2-1 over ±2 frames)
// in Swift with Accelerate only, to see whether a helper could do it without Python.
// usage: guided <work dir> <out dir>   (reads <work>/frames/NNNN.jpg and <work>/masks/NNNN-accurate.png)
import Accelerate
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let W = 1080, H = 1920, R = 12
let eps: Float = 1e-3
let work = CommandLine.arguments[1], outDir = CommandLine.arguments[2]

/// A picture as 0…1 floats, W×H, drawn through a grey bitmap (CoreGraphics does the scaling and the colour → grey).
func planar(_ path: String) -> [Float] {
  let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil)!
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
  var bytes = [UInt8](repeating: 0, count: W * H)
  bytes.withUnsafeMutableBytes { raw in
    let ctx = CGContext(data: raw.baseAddress, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: W, height: H))
  }
  var out = [Float](repeating: 0, count: W * H)
  vDSP.convertElements(of: bytes, to: &out)
  vDSP.divide(out, 255, result: &out)
  return out
}

let kernel = [Float](repeating: 1 / Float(2 * R + 1), count: 2 * R + 1)
func box(_ x: [Float]) -> [Float] {
  var out = [Float](repeating: 0, count: W * H)
  var input = x
  input.withUnsafeMutableBufferPointer { inp in
    out.withUnsafeMutableBufferPointer { o in
      var src = vImage_Buffer(data: inp.baseAddress, height: vImagePixelCount(H), width: vImagePixelCount(W), rowBytes: W * 4)
      var dst = vImage_Buffer(data: o.baseAddress, height: vImagePixelCount(H), width: vImagePixelCount(W), rowBytes: W * 4)
      let err = vImageSepConvolve_PlanarF(&src, &dst, nil, 0, 0, kernel, UInt32(kernel.count), kernel, UInt32(kernel.count), 0, 0, vImage_Flags(kvImageEdgeExtend))
      precondition(err == kvImageNoError, "convolve \(err)")
    }
  }
  return out
}

func guided(_ i: [Float], _ p: [Float]) -> [Float] {
  let meanI = box(i), meanP = box(p)
  let corrIP = box(vDSP.multiply(i, p)), corrII = box(vDSP.multiply(i, i))
  let covIP = vDSP.subtract(corrIP, vDSP.multiply(meanI, meanP))
  let varI = vDSP.subtract(corrII, vDSP.multiply(meanI, meanI))
  let a = vDSP.divide(covIP, vDSP.add(eps, varI))
  let b = vDSP.subtract(meanP, vDSP.multiply(a, meanI))
  let q = vDSP.add(vDSP.multiply(box(a), i), box(b))
  return vDSP.clip(q, to: 0...1)
}

func writePNG(_ x: [Float], _ path: String) {
  var bytes = [UInt8](repeating: 0, count: W * H)
  let scaled = vDSP.add(0.5, vDSP.multiply(255, x))
  vDSP.convertElements(of: scaled, to: &bytes, rounding: .towardZero)
  let provider = CGDataProvider(data: Data(bytes) as CFData)!
  let image = CGImage(width: W, height: H, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: W, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  CGImageDestinationFinalize(dest)
}

let n = try FileManager.default.contentsOfDirectory(atPath: "\(work)/frames").filter { $0.hasSuffix(".jpg") }.count
var tLoad = 0.0, tGuided = 0.0, tTime = 0.0, tWrite = 0.0
var snapped: [[Float]] = []
for k in 1...n {
  let name = String(format: "%04d", k)
  var t = Date()
  let luma = planar("\(work)/frames/\(name).jpg"), mask = planar("\(work)/masks/\(name)-accurate.png")
  tLoad += Date().timeIntervalSince(t); t = Date()
  snapped.append(guided(luma, mask))
  tGuided += Date().timeIntervalSince(t)
}
let weights: [Float] = [1, 2, 3, 2, 1]
for i in 0..<n {
  var t = Date()
  var sum = [Float](repeating: 0, count: W * H)
  for (w, d) in zip(weights, -2...2) {
    let j = min(max(i + d, 0), n - 1)
    sum = vDSP.add(multiplication: (snapped[j], w / 9), sum)
  }
  tTime += Date().timeIntervalSince(t); t = Date()
  writePNG(sum, String(format: "%@/%04d.png", outDir, i + 1))
  tWrite += Date().timeIntervalSince(t)
}
print(String(format: "%d frames: load %.1f ms/frame, guided %.1f ms/frame, temporal %.1f ms/frame, png write %.1f ms/frame", n, tLoad * 1000 / Double(n), tGuided * 1000 / Double(n), tTime * 1000 / Double(n), tWrite * 1000 / Double(n)))
