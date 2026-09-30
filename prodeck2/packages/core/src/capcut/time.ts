/**
 * CapCut stores every time value as integer microseconds. Values that land on a
 * frame are floored (23 frames @30fps = 766,666.67 µs is stored as 766666), so we
 * round to the nearest frame first and floor the µs value second.
 */
export function snapToFrame(us: number, fps: number): number {
  return frameToUs(usToFrame(us, fps), fps)
}

export function usToFrame(us: number, fps: number): number {
  return Math.round((us * fps) / 1_000_000)
}

export function frameToUs(frame: number, fps: number): number {
  return Math.floor((frame * 1_000_000) / fps)
}
