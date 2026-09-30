import { CUT_PRESET_IDS } from "@boxblack/core/cut/rules"
import { RemoteConfigSchema, type RemoteConfig } from "@boxblack/core/license/protocol"
import type { LicenseInput, Plan } from "./licenses.ts"

/** The admin works in Thai time; an expiry date means the end of that day there. */
const BANGKOK_OFFSET_MS = 7 * 3_600_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function endOfDayParts(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day, 23, 59, 59) - BANGKOK_OFFSET_MS
}

export function endOfDay(date: string): number {
  const match = DATE.exec(date)
  if (!match) throw new Error(`"${date}" is not a date`)
  return endOfDayParts(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** YYYY-MM-DD in Thai time, for <input type="date">. */
export function dateInputValue(ms: number): string {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)
}

/** Adds a month or a year to a calendar date, keeping the day within the target month (31 Jan + 1 month = 28 Feb). */
function addToDate(ms: number, by: "month" | "year"): number {
  const local = new Date(ms + BANGKOK_OFFSET_MS)
  const year = local.getUTCFullYear() + (by === "year" ? 1 : 0)
  const month = local.getUTCMonth() + (by === "month" ? 1 : 0)
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return endOfDayParts(year, month, Math.min(local.getUTCDate(), daysInMonth))
}

/** Renewal counts from the current expiry, or from today when the license has already lapsed. */
export function extendExpiry(currentExpiresAt: number, now: number, by: "month" | "year"): number {
  return addToDate(Math.max(currentExpiresAt, now), by)
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "")

export function parseLicenseForm(form: FormData, now: number): LicenseInput {
  const plan = text(form, "plan") as Plan
  const expiresOn = text(form, "expiresOn")
  return {
    customer: text(form, "customer").trim(),
    email: text(form, "email").trim(),
    plan,
    maxDevices: Number(text(form, "maxDevices") || "2"),
    expiresAt: expiresOn ? endOfDay(expiresOn) : addToDate(now, plan === "yearly" ? "year" : "month"),
    note: text(form, "note"),
  }
}

const seconds = (us: number) => String(us / 1_000_000)

function microseconds(form: FormData, name: string): number {
  const value = Number(text(form, name))
  if (text(form, name).trim() === "" || !Number.isFinite(value)) throw new Error(`${name} is not a number`)
  return Math.round(value * 1_000_000)
}

/** Field values for the config form: versions one per line, preset times in seconds, empty prompt = built in. */
export function configFormValues(config: RemoteConfig): Record<string, string> {
  return {
    capcutVersions: config.capcutVersions.join("\n"),
    ...Object.fromEntries(
      CUT_PRESET_IDS.flatMap((id) => [
        [`${id}.maxPause`, seconds(config.cutPresets[id].maxPauseUs)],
        [`${id}.padding`, seconds(config.cutPresets[id].paddingUs)],
      ]),
    ),
    visionPrompt: config.prompts.vision ?? "",
    plannerPrompt: config.prompts.planner ?? "",
  }
}

export function parseConfigForm(form: FormData): RemoteConfig {
  const prompt = (name: string) => text(form, name).trim() || null
  return RemoteConfigSchema.parse({
    capcutVersions: text(form, "capcutVersions")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    cutPresets: Object.fromEntries(
      CUT_PRESET_IDS.map((id) => [id, { maxPauseUs: microseconds(form, `${id}.maxPause`), paddingUs: microseconds(form, `${id}.padding`) }]),
    ),
    prompts: { vision: prompt("visionPrompt"), planner: prompt("plannerPrompt") },
  })
}

export function formatThaiDate(ms: number): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(ms)
}

export function formatThaiDateTime(ms: number): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(ms)
}
