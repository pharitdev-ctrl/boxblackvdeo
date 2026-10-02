import { expect, test } from "vitest"
import { createCallLimit } from "./call-limit.ts"

/** Lets what is waiting on a settled promise run. */
const settled = () => new Promise((resolve) => setImmediate(resolve))

test("no more calls run at once than the limit; the others wait and start in the order they were asked, each as a slot is let go", async () => {
  const limit = createCallLimit(2)
  const started: string[] = []
  const ends = new Map<string, () => void>()
  const call = (name: string) =>
    limit.run(
      () =>
        new Promise<string>((resolve) => {
          started.push(name)
          ends.set(name, () => resolve(name))
        }),
    )
  const answers = ["a", "b", "c", "d"].map(call)
  await settled()
  expect(started).toEqual(["a", "b"])
  ends.get("b")!()
  await settled()
  expect(started).toEqual(["a", "b", "c"])
  ends.get("a")!()
  ends.get("c")!()
  await settled()
  expect(started).toEqual(["a", "b", "c", "d"])
  ends.get("d")!()
  expect(await Promise.all(answers)).toEqual(["a", "b", "c", "d"])
})

test("a call that fails lets its slot go and fails as it did; the next waiting call starts", async () => {
  const limit = createCallLimit(1)
  const broken = new Error("the call failed")
  const failing = limit.run(async () => {
    throw broken
  })
  const next = limit.run(async () => "next")
  await expect(failing).rejects.toBe(broken)
  expect(await next).toBe("next")
})

test("a slot handed on to a waiting call stays taken: a call asked after it waits until one of those running ends", async () => {
  const limit = createCallLimit(2)
  const started: string[] = []
  const ends = new Map<string, () => void>()
  const call = (name: string) =>
    limit.run(
      () =>
        new Promise<string>((resolve) => {
          started.push(name)
          ends.set(name, () => resolve(name))
        }),
    )
  const answers = [call("a"), call("b"), call("c")]
  await settled()
  ends.get("b")!()
  await settled()
  // c has b's slot: a and c run, and e asked now waits
  expect(started).toEqual(["a", "b", "c"])
  answers.push(call("e"))
  await settled()
  expect(started).toEqual(["a", "b", "c"])
  ends.get("c")!()
  await settled()
  expect(started).toEqual(["a", "b", "c", "e"])
  ends.get("a")!()
  ends.get("e")!()
  expect(await Promise.all(answers)).toEqual(["a", "b", "c", "e"])
})
