/**
 * Which lane each item goes on, newest on top: in start order, an item takes the lane just above the
 * highest lane still playing when it starts (its end frame after the item's start frame), or lane 0
 * when none is. Frames, so two items that only touch share a lane. Pure.
 *
 * Newest on top rather than the first free lane: CapCut draws a higher track over a lower one, so an
 * item put on a free lane below one still playing would come on underneath it and be hidden. So the
 * number of lanes follows the longest chain of items that each start while the one before still
 * plays, not the most that play at once: (0, 20), (15, 35), (30, 50), (45, 65) take lanes 0, 1, 2
 * and 3, though no more than two ever play together. An item goes at most one lane above the
 * highest in use, so the lanes come out 0 to n with none skipped; the writers (addOverlayTracks)
 * make lane n their n-th new track and rely on that. The answer is in the order the items were
 * given; items that start on the same frame keep that order.
 */
export function laneOf(items: { startFrame: number; endFrame: number }[]): number[] {
  const order = items.map((_, index) => index).sort((a, b) => items[a]!.startFrame - items[b]!.startFrame)
  const lanes = new Array<number>(items.length).fill(0)
  // the frame each lane plays until; a lane is free from that frame on
  const busyUntil: number[] = []
  for (const index of order) {
    const { startFrame, endFrame } = items[index]!
    // every lane above the highest busy one is free, so the one just above it is
    const lane = busyUntil.findLastIndex((until) => until > startFrame) + 1
    busyUntil[lane] = endFrame
    lanes[index] = lane
  }
  return lanes
}
