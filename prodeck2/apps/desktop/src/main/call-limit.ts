/*
 * How many of Claude's writing calls go at the same time: the graphics' writings and the sounds' composings take
 * their turns from one limit, so the two works running side by side never have more calls going between them than
 * one of them alone may.
 */

/** How many writings, of graphics and of sounds together, are under way at the same time at the most. */
export const CALLS_AT_ONCE = 6

/** A number of slots that calls take their turns in. */
export interface CallLimit {
  /**
   * Runs `call` once a slot is free, and holds that slot until it has settled; answers or fails as it did. Calls
   * waiting for a slot start in the order they were asked for, each as soon as one is let go.
   */
  run<T>(call: () => Promise<T>): Promise<T>
}

export function createCallLimit(most: number): CallLimit {
  let running = 0
  /** the calls waiting for a slot, the first asked first */
  const waiting: (() => void)[] = []
  return {
    async run<T>(call: () => Promise<T>): Promise<T> {
      if (running < most) running++
      // a slot let go is handed straight to the call that has waited longest, so none asked later gets in first
      else await new Promise<void>((resolve) => waiting.push(resolve))
      try {
        return await call()
      } finally {
        const next = waiting.shift()
        if (next) next()
        else running--
      }
    },
  }
}
