import { afterEach, expect, test } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { t } from "../i18n.ts"
import { ScenePlayer } from "./ScenePlayer.tsx"

afterEach(cleanup)

type FrameCallback = (now: number, metadata: { mediaTime: number }) => void

/** jsdom has no media playback: record what the player asks the <video> to do. */
function renderPlayer() {
  render(<ScenePlayer src="boxblack-media://video/p/a" startUs={1_900_000} endUs={7_000_000} />)
  const video = document.querySelector("video")!
  const calls: string[] = []
  const frameCallbacks: FrameCallback[] = []
  video.play = async () => {
    calls.push(`play@${video.currentTime}`)
  }
  video.pause = () => void calls.push(`pause@${video.currentTime}`)
  Object.assign(video, {
    requestVideoFrameCallback: (callback: FrameCallback) => frameCallbacks.push(callback),
    cancelVideoFrameCallback: () => {},
  })
  const at = (seconds: number, event: string) => {
    video.currentTime = seconds
    fireEvent(video, new Event(event))
  }
  return { video, calls, frameCallbacks, at }
}

const slider = () => screen.getByRole("slider", { name: t("preview.position") })

test("the video has no controls of its own and starts playing at the start of the scene", () => {
  const { video, calls, at } = renderPlayer()
  expect(video.getAttribute("src")).toBe("boxblack-media://video/p/a")
  expect(video.controls).toBe(false)

  fireEvent(video, new Event("loadedmetadata"))
  expect(video.currentTime).toBe(1.9)
  at(1.9, "seeked")
  expect(calls).toEqual(["play@1.9"])
})

test("the bar and the clock cover the scene only, counted from its start", () => {
  const { at } = renderPlayer()
  expect(slider().getAttribute("min")).toBe("0")
  expect(slider().getAttribute("max")).toBe("5.1")
  expect(screen.getByText("0:00.0 / 0:05.1")).toBeTruthy()

  at(4.4, "timeupdate")
  expect((slider() as HTMLInputElement).value).toBe("2.5")
  expect(screen.getByText("0:02.5 / 0:05.1")).toBeTruthy()
})

test("dragging the bar moves inside the scene", () => {
  const { video } = renderPlayer()
  fireEvent.change(slider(), { target: { value: "1" } })
  expect(video.currentTime).toBe(2.9)
})

// the frame at 7.0 s already belongs to whatever follows the scene, maybe another shot
const expectOnLastFrameOfScene = (video: HTMLVideoElement) => {
  expect(video.currentTime).toBeLessThan(7)
  expect(video.currentTime).toBeGreaterThan(7 - 1 / 60)
}

test("playback stops on the last frame of the scene, before a frame past its end is shown", () => {
  const { video, calls, frameCallbacks, at } = renderPlayer()
  at(6.9, "play")
  expect(frameCallbacks).toHaveLength(1)

  // 30 fps: the frame after 6.967 s would be the one at 7.0 s
  frameCallbacks[0]!(0, { mediaTime: 6.9 })
  frameCallbacks[1]!(0, { mediaTime: 6.9333 })
  expect(calls).toEqual([])
  expect(frameCallbacks).toHaveLength(3)

  frameCallbacks[2]!(0, { mediaTime: 6.9667 })
  expect(calls).toEqual(["pause@6.9"])
  expectOnLastFrameOfScene(video)

  // the seek back onto the last frame still reads as the end of the scene
  fireEvent(video, new Event("seeked"))
  expect(screen.getByText("0:05.1 / 0:05.1")).toBeTruthy()
})

test("a frame past the end stops playback even before the frame rate is known", () => {
  const { video, calls, frameCallbacks, at } = renderPlayer()
  at(6.9, "play")
  frameCallbacks[0]!(0, { mediaTime: 7.0 })
  expect(calls).toEqual(["pause@6.9"])
  expectOnLastFrameOfScene(video)
})

test("playback also stops at the end when frame callbacks are not available", () => {
  const { video, calls, at } = renderPlayer()
  Object.assign(video, { requestVideoFrameCallback: undefined })
  at(6.9, "play")
  at(7.2, "timeupdate")
  expect(calls).toEqual(["pause@7.2"])
  expectOnLastFrameOfScene(video)
})

test("the play button plays and pauses, and starts the scene over once it has ended", async () => {
  const { video, calls, at } = renderPlayer()
  at(7, "pause")
  await userEvent.click(screen.getByRole("button", { name: t("preview.play") }))
  expect(calls).toEqual(["play@1.9"])

  at(1.9, "play")
  await userEvent.click(screen.getByRole("button", { name: t("preview.pause") }))
  expect(calls).toEqual(["play@1.9", "pause@1.9"])
  expect(video.currentTime).toBe(1.9)
})

test("a video that cannot be opened says so", () => {
  const { video } = renderPlayer()
  fireEvent(video, new Event("error"))
  expect(screen.getByText(t("preview.error"))).toBeTruthy()
})
