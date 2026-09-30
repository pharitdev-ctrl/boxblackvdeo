// Person segmentation with Apple's Vision framework, for the cutout spike (no CapCut Pro).
// Same as segment.swift, but all frames go through one VNSequenceRequestHandler.
// usage: segment-seq <fast|balanced|accurate> <out dir> <frame.png>...
// Writes one grey mask PNG per frame (Vision's own size) and prints the time per frame after the first,
// which also loads the model.
import CoreImage
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count > 3 else {
  print("usage: segment <fast|balanced|accurate> <out dir> <frame.png>...")
  exit(2)
}
let quality = args[1]
let outDir = URL(fileURLWithPath: args[2])
let inputs = Array(args.dropFirst(3))
let sequence = VNSequenceRequestHandler()
let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = quality == "fast" ? .fast : quality == "balanced" ? .balanced : .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
let context = CIContext()
var times: [Double] = []
for path in inputs {
  let url = URL(fileURLWithPath: path)
  let start = Date()
  // one handler for the whole run, so the request can carry state from frame to frame
  try sequence.perform([request], onImageURL: url)
  times.append(Date().timeIntervalSince(start))
  guard let mask = request.results?.first?.pixelBuffer else {
    print("no mask for \(path)")
    continue
  }
  let out = outDir.appendingPathComponent(url.deletingPathExtension().lastPathComponent + "-\(quality).png")
  try context.writePNGRepresentation(of: CIImage(cvPixelBuffer: mask), to: out, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
  print("\(out.lastPathComponent) \(CVPixelBufferGetWidth(mask))x\(CVPixelBufferGetHeight(mask)) \(String(format: "%.0f", times.last! * 1000)) ms")
}
let warm = times.dropFirst()
if !warm.isEmpty {
  print(String(format: "%@: first %.0f ms (with model load), then %.1f ms per frame", quality, times[0] * 1000, warm.reduce(0, +) * 1000 / Double(warm.count)))
}
