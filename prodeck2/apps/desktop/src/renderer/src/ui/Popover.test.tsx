import { afterEach, expect, test } from "vitest"
import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { Button } from "./Button.tsx"
import { Popover } from "./Popover.tsx"

afterEach(cleanup)

function Menu() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="anchor">
        <Button aria-expanded={open} onClick={() => setOpen(!open)}>
          เมนู
        </Button>
        <Popover open={open} label="เมนู" onClose={() => setOpen(false)}>
          <p>ข้างใน</p>
        </Popover>
      </div>
      <p>ข้างนอก</p>
    </div>
  )
}

test("the button that opened a popover closes it again", async () => {
  render(<Menu />)
  const button = screen.getByRole("button", { name: "เมนู" })
  await userEvent.click(button)
  expect(screen.queryByRole("group", { name: "เมนู" })).toBeTruthy()
  await userEvent.click(button)
  expect(screen.queryByRole("group", { name: "เมนู" })).toBeNull()
})

test("a click anywhere else, or Escape, closes it; a click inside does not", async () => {
  render(<Menu />)
  await userEvent.click(screen.getByRole("button", { name: "เมนู" }))
  await userEvent.click(screen.getByText("ข้างใน"))
  expect(screen.queryByRole("group", { name: "เมนู" })).toBeTruthy()
  await userEvent.click(screen.getByText("ข้างนอก"))
  expect(screen.queryByRole("group", { name: "เมนู" })).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: "เมนู" }))
  await userEvent.keyboard("{Escape}")
  expect(screen.queryByRole("group", { name: "เมนู" })).toBeNull()
})
