import { test } from "vitest"
import assert from "node:assert/strict"
import { join } from "node:path"
import { makeDraftRoot } from "../../test/fixture-root.ts"
import { binVideos, loadDraft } from "./read.ts"

test("loadDraft reads the timeline, meta and main timeline id", async () => {
  const root = await makeDraftRoot()
  const draft = await loadDraft(join(root, "0917"))
  assert.equal(draft.root, root)
  assert.equal(draft.mainTimelineId, "FEC0BFBC-F5C5-47FF-850E-F09C78320D0E")
  assert.equal(draft.info.fps, 30)
  assert.deepEqual(draft.info.tracks, [])
  assert.equal(draft.meta.draft_name, "0917")
})

test("loadDraft reports the CapCut version that last saved the draft", async () => {
  const root = await makeDraftRoot()
  const draft = await loadDraft(join(root, "0917"))
  assert.equal(draft.capcutVersion, "9.4.0")
})

test("binVideos lists only video files from the media bin", async () => {
  const root = await makeDraftRoot()
  const draft = await loadDraft(join(root, "0917"))
  // the bin also holds a pathless "none" item that CapCut creates on its own
  assert.deepEqual(binVideos(draft.meta), [
    {
      id: "8efd5c3a-62ad-4e1b-9ea9-7b603c267884",
      path: "/fixture/media/IMG_9646.MOV",
      name: "IMG_9646.MOV",
      durationUs: 31_106_000,
      width: 1080,
      height: 1920,
    },
  ])
})
