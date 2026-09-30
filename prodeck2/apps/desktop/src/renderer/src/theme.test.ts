import { expect, test } from "vitest"
import { applyAppearance } from "./theme.ts"

const root = () => document.createElement("html")

test("a pinned appearance is written on the root, and the system one leaves nothing behind", () => {
  const element = root()
  applyAppearance("dark", element)
  expect(element.dataset.theme).toBe("dark")
  applyAppearance("light", element)
  expect(element.dataset.theme).toBe("light")
  applyAppearance("system", element)
  expect(element.hasAttribute("data-theme")).toBe(false)
})
