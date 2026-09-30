/** Pure sampling logic, kept free of Node imports so the renderer can estimate costs with it. */

function samplesPerShot(durationUs: number, sceneCutsUs: number[], intervalUs: number): number[] {
  const bounds = [...new Set([0, ...sceneCutsUs.filter((cut) => cut > 0 && cut < durationUs), durationUs])].sort((a, b) => a - b)
  const times: number[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i]!
    const end = bounds[i + 1]!
    const half = Math.floor((end - start) / 2)
    const last = end - Math.min(250_000, half)
    // half a second in skips transition frames; a shot shorter than a second is sampled in its middle
    for (let t = start + Math.min(500_000, half); t <= last; t += intervalUs) times.push(t)
  }
  return times
}

/**
 * Picks the moments to show the model: every shot at least once, then every `intervalUs`
 * inside it. Over `maxFrames`, the interval widens to fit; if the shots alone are too many,
 * an even subset of them is kept.
 */
export function sampleTimes(args: { durationUs: number; sceneCutsUs: number[]; intervalUs: number; maxFrames: number }): number[] {
  const { durationUs, sceneCutsUs, intervalUs, maxFrames } = args
  let times = samplesPerShot(durationUs, sceneCutsUs, intervalUs)
  if (times.length <= maxFrames) return times

  times = samplesPerShot(durationUs, sceneCutsUs, Math.max(intervalUs, Math.ceil(durationUs / maxFrames)))
  if (times.length <= maxFrames) return times

  const step = times.length / maxFrames
  return Array.from({ length: maxFrames }, (_, i) => times[Math.floor(i * step)]!)
}
