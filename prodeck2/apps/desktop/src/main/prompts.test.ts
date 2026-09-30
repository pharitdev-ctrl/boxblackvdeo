import { expect, test } from "vitest"
import { PLANNER_PROMPT } from "@boxblack/core/planner"
import { VISION_PROMPT } from "@boxblack/core/vision"
import { resolvePrompts } from "./prompts.ts"

test("with no prompts from the server, the built-in ones are used as they are", () => {
  expect(resolvePrompts({ vision: null, planner: null })).toEqual({ vision: VISION_PROMPT, planner: PLANNER_PROMPT })
})

test("a prompt from the server gets a version of its own, so results made with another prompt are not reused", () => {
  const one = resolvePrompts({ vision: "บรรยายภาพสั้นๆ", planner: null })
  const two = resolvePrompts({ vision: "บรรยายภาพละเอียด", planner: null })
  expect(one.vision.system).toBe("บรรยายภาพสั้นๆ")
  expect(one.vision.version).toMatch(new RegExp(`^${VISION_PROMPT.version}\\+server-[0-9a-f]{12}$`))
  expect(two.vision.version).not.toBe(one.vision.version)
  expect(resolvePrompts({ vision: "บรรยายภาพสั้นๆ", planner: null }).vision.version).toBe(one.vision.version)
  expect(one.planner).toEqual(PLANNER_PROMPT)
})
