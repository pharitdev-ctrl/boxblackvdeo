import { useEffect, useState } from "react"
import { afterEach, expect, test } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import type { Brief } from "../../../shared/api.ts"
import { t } from "../i18n.ts"
import { BriefPanel } from "./BriefPanel.tsx"

afterEach(cleanup)

const EMPTY: Brief = { targetSeconds: null, videoType: null, instructions: "" }
const noop = () => {}

/** The panel inside a parent that keeps the brief, as the outline screen does, so a change comes back down as the next brief. */
function Host({ brief, planning, changes }: { brief: Brief; planning: boolean; changes: Brief[] }) {
  const [held, setHeld] = useState(brief)
  useEffect(() => setHeld(brief), [brief])
  const change = (next: Brief) => {
    changes.push(next)
    setHeld(next)
  }
  return <BriefPanel brief={held} onChange={change} hasOutline={false} planning={planning} onPlan={noop} onRevise={noop} onCancel={noop} />
}

function renderPanel(brief: Brief, planning = false) {
  const changes: Brief[] = []
  const view = render(<Host brief={brief} planning={planning} changes={changes} />)
  return { changes, rerender: (shown: Brief) => view.rerender(<Host brief={shown} planning={planning} changes={changes} />) }
}

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement
const field = () => screen.getByRole("textbox", { name: t("brief.targetCustom") }) as HTMLInputElement
const customOn = () => radio(t("brief.targetCustom"))

test("the target buttons are half a minute, a minute, a minute and a half, custom and none — three minutes is gone", () => {
  renderPanel(EMPTY)
  expect(screen.getAllByRole("radio").map((input) => (input as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
    t("brief.seconds", { seconds: 30 }),
    t("brief.minutes", { minutes: 1 }),
    t("brief.minutes", { minutes: 1.5 }),
    t("brief.targetCustom"),
    t("brief.targetNone"),
  ])
  expect(radio(t("brief.targetNone")).checked).toBe(true)
  expect(screen.queryByRole("textbox", { name: t("brief.targetCustom") })).toBeNull()
})

test("custom opens a field: a length typed as minutes:seconds or as seconds is used at once, and shown as minutes:seconds after", async () => {
  const { changes } = renderPanel(EMPTY)
  await userEvent.click(customOn())
  expect(customOn().checked).toBe(true)
  // nothing is typed yet, so nothing changes
  expect(changes).toEqual([])
  expect(field().placeholder).toBe(t("brief.targetPlaceholder"))
  await userEvent.type(field(), "2:30")
  expect(changes.at(-1)).toEqual({ ...EMPTY, targetSeconds: 150 })
  await userEvent.clear(field())
  await userEvent.type(field(), "240")
  expect(changes.at(-1)).toEqual({ ...EMPTY, targetSeconds: 240 })
  // leaving the field tidies what was typed into the form the clip's length is shown in
  await userEvent.tab()
  expect(field().value).toBe("4:00")
  expect(customOn().checked).toBe(true)
})

test("a length that cannot be read, or is under five seconds or over half an hour, leaves no target and shows the hint", async () => {
  const { changes } = renderPanel({ ...EMPTY, targetSeconds: 150 })
  expect(field().value).toBe("2:30")
  for (const text of ["abc", "0:04", "31:00"]) {
    await userEvent.clear(field())
    await userEvent.type(field(), text)
    expect(screen.getByText(t("brief.targetInvalid")), text).toBeTruthy()
    // a length passed through on the way ("31" of "31:00") is not left behind
    expect(changes.at(-1), text).toEqual({ ...EMPTY, targetSeconds: null })
    expect(customOn().checked, text).toBe(true)
  }
  // an emptied field is not wrong yet, just empty
  await userEvent.clear(field())
  expect(screen.queryByText(t("brief.targetInvalid"))).toBeNull()
  expect(changes.at(-1)).toEqual({ ...EMPTY, targetSeconds: null })
  // and a good length clears the hint
  await userEvent.type(field(), "1:45")
  expect(screen.queryByText(t("brief.targetInvalid"))).toBeNull()
  expect(changes.at(-1)).toEqual({ ...EMPTY, targetSeconds: 105 })
})

test("a stored length that is no button opens as custom with the field filled in; one that is a button opens on it with no field", () => {
  const { rerender } = renderPanel({ ...EMPTY, targetSeconds: 180 })
  expect(customOn().checked).toBe(true)
  expect(field().value).toBe("3:00")
  // another length from outside (an outline read back) shows as it is, not as what was there before
  rerender({ ...EMPTY, targetSeconds: 150 })
  expect(customOn().checked).toBe(true)
  expect(field().value).toBe("2:30")
  rerender({ ...EMPTY, targetSeconds: 60 })
  expect(radio(t("brief.minutes", { minutes: 1 })).checked).toBe(true)
  expect(screen.queryByRole("textbox", { name: t("brief.targetCustom") })).toBeNull()
})

test("choosing custom from a button keeps that length in the field until a new one is typed, and a button closes the field again", async () => {
  const { changes } = renderPanel({ ...EMPTY, targetSeconds: 60 })
  await userEvent.click(customOn())
  expect(customOn().checked).toBe(true)
  expect(radio(t("brief.minutes", { minutes: 1 })).checked).toBe(false)
  expect(field().value).toBe("1:00")
  expect(changes).toEqual([])
  await userEvent.click(radio(t("brief.minutes", { minutes: 1.5 })))
  expect(changes.at(-1)).toEqual({ ...EMPTY, targetSeconds: 90 })
  expect(screen.queryByRole("textbox", { name: t("brief.targetCustom") })).toBeNull()
})

test("the field is disabled while the outline is being planned, like the buttons", () => {
  renderPanel({ ...EMPTY, targetSeconds: 150 }, true)
  expect(field().disabled).toBe(true)
  expect(customOn().disabled).toBe(true)
})
