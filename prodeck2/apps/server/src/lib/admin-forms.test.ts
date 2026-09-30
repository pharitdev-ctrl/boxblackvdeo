import { expect, test } from "vitest"
import { CUT_PRESETS } from "@boxblack/core/cut/rules"
import { DEFAULT_REMOTE_CONFIG } from "@boxblack/core/license/protocol"
import { configFormValues, dateInputValue, endOfDay, extendExpiry, parseConfigForm, parseLicenseForm } from "./admin-forms.ts"

const form = (entries: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

// 17 Sep 2026, 17:00 in Bangkok
const NOW = Date.parse("2026-09-17T10:00:00Z")

test("expiry dates are the end of that day in Thailand", () => {
  expect(new Date(endOfDay("2026-10-17")).toISOString()).toBe("2026-10-17T16:59:59.000Z")
  expect(dateInputValue(endOfDay("2026-10-17"))).toBe("2026-10-17")
  expect(() => endOfDay("17/10/2026")).toThrow(/date/)
})

test("a new license without a date runs one month or one year from today", () => {
  const monthly = parseLicenseForm(form({ customer: " ร้านเล็บ ", email: "a@b.co", plan: "monthly", maxDevices: "2", expiresOn: "", note: "" }), NOW)
  expect(monthly).toEqual({ customer: "ร้านเล็บ", email: "a@b.co", plan: "monthly", maxDevices: 2, expiresAt: endOfDay("2026-10-17"), note: "" })
  const yearly = parseLicenseForm(form({ customer: "x", email: "", plan: "yearly", maxDevices: "3", expiresOn: "", note: "" }), NOW)
  expect(yearly.expiresAt).toBe(endOfDay("2027-09-17"))
  const dated = parseLicenseForm(form({ customer: "x", email: "", plan: "yearly", maxDevices: "1", expiresOn: "2026-12-31", note: "โอนแล้ว" }), NOW)
  expect(dated).toMatchObject({ expiresAt: endOfDay("2026-12-31"), maxDevices: 1, note: "โอนแล้ว" })
})

test("renewing adds to whichever is later, today or the current expiry, and a month never spills into the next", () => {
  expect(extendExpiry(endOfDay("2026-12-01"), NOW, "month")).toBe(endOfDay("2027-01-01"))
  expect(extendExpiry(endOfDay("2026-01-01"), NOW, "month")).toBe(endOfDay("2026-10-17"))
  expect(extendExpiry(endOfDay("2027-01-31"), NOW, "month")).toBe(endOfDay("2027-02-28"))
  expect(extendExpiry(endOfDay("2028-02-29"), NOW, "year")).toBe(endOfDay("2029-02-28"))
})

test("the config form round-trips the config in seconds and lines", () => {
  const values = configFormValues(DEFAULT_REMOTE_CONFIG)
  expect(values).toMatchObject({ capcutVersions: "9.4.0", "tight.maxPause": "0.3", "tight.padding": "0.08", visionPrompt: "", plannerPrompt: "" })
  expect(parseConfigForm(form(values))).toEqual(DEFAULT_REMOTE_CONFIG)

  const edited = parseConfigForm(form({ ...values, capcutVersions: "9.4.0\n 9.5.0 \n\n", "loose.maxPause": "1.2", plannerPrompt: "  ตัดให้สั้น  " }))
  expect(edited).toEqual({
    capcutVersions: ["9.4.0", "9.5.0"],
    cutPresets: { ...CUT_PRESETS, loose: { maxPauseUs: 1_200_000, paddingUs: 250_000 } },
    prompts: { vision: null, planner: "ตัดให้สั้น" },
  })
  expect(() => parseConfigForm(form({ ...values, "normal.maxPause": "abc" }))).toThrow()
})
