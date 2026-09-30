import { expect, test } from "vitest"
import { createOutlineApi } from "./outline-api.ts"
import type { PlannerService } from "./planner.ts"

function setup() {
  const asked: [string, string, number][] = []
  const api = createOutlineApi({
    planner: {} as PlannerService,
    thumbnail: async (folder, videoId, atUs) => {
      asked.push([folder, videoId, atUs])
      return "data:image/jpeg;base64,/9j/"
    },
  })
  return { api, asked }
}

test("a thumbnail is asked for by a whole number of microseconds into the video", async () => {
  const { api, asked } = setup()
  expect(await api.beatThumbnail("/drafts/0917", "v-1", 4_000_000)).toBe("data:image/jpeg;base64,/9j/")
  expect(asked).toEqual([["/drafts/0917", "v-1", 4_000_000]])
})

test("a thumbnail time that is not a plain count of microseconds never reaches a file name", async () => {
  const { api, asked } = setup()
  for (const bad of ["x/../../photo", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4000000"]) {
    await expect(api.beatThumbnail("/drafts/0917", "v-1", bad as number)).rejects.toThrow("thumbnail")
  }
  expect(asked).toEqual([])
})
