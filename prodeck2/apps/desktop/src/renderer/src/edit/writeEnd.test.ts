import { expect, test } from "vitest"
import type { WriteResult } from "../../../shared/api.ts"
import { backupInfo } from "../../test/fake-api.ts"
import { t } from "../i18n.ts"
import { DROPPED_NAMES, doneMessage, doneNotes, toldIsLong, toldMessage } from "./writeEnd.tsx"

/** A write that put everything in and left nothing out; a test changes what it is about. */
const written = (extra: Partial<WriteResult> = {}): WriteResult => ({
  backup: backupInfo("0917-2026-09-17T09-00-00-000Z", "2026-09-17T09:00:00.000Z"),
  durationUs: 12_100_000,
  segmentCount: 5,
  captionCount: 3,
  highlightCount: 4,
  soundCount: 2,
  zoomCount: 1,
  insertCount: 1,
  graphicCount: 0,
  dropped: { sounds: 0, zooms: 0, inserts: 0, graphics: 0 },
  zoomsLost: 0,
  graphicsSkipped: 0,
  emphasisCount: 6,
  proLeftOut: { exits: 0, sounds: 0 },
  ...extra,
})

/** Every kind the writers drop by at zero, as a result has them: a kind added to a result is in every test below. */
const NONE_DROPPED = written().dropped

test("DROPPED_NAMES names every kind a result drops by", () => {
  expect(Object.keys(DROPPED_NAMES).sort()).toEqual(Object.keys(written().dropped).sort())
})

/* doneNotes */

test("a write that left nothing out has no notes", () => {
  expect(doneNotes(written())).toEqual([])
})

test.each([
  ["sounds", "flair.sound"],
  ["zooms", "flair.zoom"],
  ["inserts", "flair.insert"],
  ["graphics", "flair.graphic"],
] as const)("dropped %s have one note, named %s as the switches name them", (kind, name) => {
  expect(doneNotes(written({ dropped: { ...NONE_DROPPED, [kind]: 3 } }))).toEqual([t("write.resultDropped", { what: t(name), count: 3 })])
})

test("every kind above zero has its own note, in the order sounds, zooms, inserts, graphics, and a kind at zero has none", () => {
  expect(doneNotes(written({ dropped: { sounds: 1, zooms: 0, inserts: 3, graphics: 4 } }))).toEqual([
    t("write.resultDropped", { what: t("flair.sound"), count: 1 }),
    t("write.resultDropped", { what: t("flair.insert"), count: 3 }),
    t("write.resultDropped", { what: t("flair.graphic"), count: 4 }),
  ])
})

test("zooms lost are a note of their own", () => {
  expect(doneNotes(written({ zoomsLost: 2 }))).toEqual([t("write.zoomsLost", { count: 2 })])
})

test("what was left out for want of CapCut Pro is a note whether it is only exits, only sounds or both", () => {
  expect(doneNotes(written({ proLeftOut: { exits: 1, sounds: 0 } }))).toEqual([t("write.proLeftOut", { exits: 1, sounds: 0 })])
  expect(doneNotes(written({ proLeftOut: { exits: 0, sounds: 2 } }))).toEqual([t("write.proLeftOut", { exits: 0, sounds: 2 })])
  // the two counts are told apart, each in its place
  expect(doneNotes(written({ proLeftOut: { exits: 3, sounds: 2 } }))).toEqual([t("write.proLeftOut", { exits: 3, sounds: 2 })])
})

test("the notes come in the order dropped kinds, zooms lost, then Pro left out", () => {
  const all = written({ dropped: { sounds: 1, zooms: 0, inserts: 0, graphics: 2 }, zoomsLost: 3, proLeftOut: { exits: 1, sounds: 1 } })
  expect(doneNotes(all)).toEqual([
    t("write.resultDropped", { what: t("flair.sound"), count: 1 }),
    t("write.resultDropped", { what: t("flair.graphic"), count: 2 }),
    t("write.zoomsLost", { count: 3 }),
    t("write.proLeftOut", { exits: 1, sounds: 1 }),
  ])
})

test("graphics left out for a failed render are said by the message itself, not again as a note", () => {
  const skipped = written({ graphicCount: 2, graphicsSkipped: 1 })
  expect(doneNotes(skipped)).toEqual([])
  expect(toldMessage(skipped)).toBe(doneMessage(skipped))
})

test("graphics left out are told with every reason one may be: not written yet, to be done again, or a render that failed, and where to look", () => {
  expect(doneMessage(written({ graphicCount: 2, graphicsSkipped: 1 }))).toBe(
    "เขียนแล้ว · 5 ชิ้น 0:12 · กราฟิก 2 ชิ้น · กราฟิกอีก 1 ชิ้นไม่ได้ใส่ (ยังไม่ได้เขียน ต้องทำใหม่ หรือเรนเดอร์ไม่สำเร็จ) ดูได้ในแท็บกราฟิกและเทคนิค",
  )
  // none placed: the count of graphics written is left out
  expect(doneMessage(written({ graphicsSkipped: 3 }))).toBe("เขียนแล้ว · 5 ชิ้น 0:12 · กราฟิก 3 ชิ้นไม่ได้ใส่ (ยังไม่ได้เขียน ต้องทำใหม่ หรือเรนเดอร์ไม่สำเร็จ) ดูได้ในแท็บกราฟิกและเทคนิค")
})

/* toldMessage */

test("the toast for a clean write is the message alone, with no separator after it", () => {
  expect(toldMessage(written())).toBe(doneMessage(written()))
})

test("the toast for a write with notes is the message and then each note, joined by ' · '", () => {
  const noted = written({ dropped: { ...NONE_DROPPED, sounds: 1 }, zoomsLost: 2, proLeftOut: { exits: 1, sounds: 0 } })
  expect(toldMessage(noted)).toBe(
    `${doneMessage(noted)} · ${t("write.resultDropped", { what: t("flair.sound"), count: 1 })} · ${t("write.zoomsLost", { count: 2 })} · ${t("write.proLeftOut", { exits: 1, sounds: 0 })}`,
  )
})

/* toldIsLong */

test("a clean write is told for the usual time, even with graphics in it", () => {
  expect(toldIsLong(written())).toBe(false)
  expect(toldIsLong(written({ graphicCount: 2 }))).toBe(false)
})

test("graphics left out for a failed render keep the toast long", () => {
  expect(toldIsLong(written({ graphicCount: 2, graphicsSkipped: 1 }))).toBe(true)
  expect(toldIsLong(written({ graphicsSkipped: 3 }))).toBe(true)
})

test("any note keeps the toast long: something dropped, zooms lost, or Pro left out (only exits, or only sounds)", () => {
  expect(toldIsLong(written({ dropped: { ...NONE_DROPPED, zooms: 1 } }))).toBe(true)
  expect(toldIsLong(written({ zoomsLost: 1 }))).toBe(true)
  expect(toldIsLong(written({ proLeftOut: { exits: 1, sounds: 0 } }))).toBe(true)
  expect(toldIsLong(written({ proLeftOut: { exits: 0, sounds: 1 } }))).toBe(true)
})
