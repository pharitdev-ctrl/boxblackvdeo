import { expect, test } from "vitest"
import { MESSAGE_KEYS, t } from "./i18n.ts"

test("t fills named placeholders", () => {
  expect(t("detail.selectedSummary", { selected: 2, total: 3, duration: "1:05" })).toBe("เลือก 2 จาก 3 วิดีโอ · รวม 1:05")
})

test("no text names the tab of graphics and techniques, which 0.7.0 split in two", () => {
  expect(MESSAGE_KEYS.filter((key) => t(key).includes("กราฟิกและเทคนิค"))).toEqual([])
})

test("the texts that send the user to a tab name the one that now holds the thing: highlight text and cutaways the techniques tab, graphics their own", () => {
  expect(t("inserts.pickHint")).toContain("คิดใหม่: ข้อความและเทคนิค")
  expect(t("flair.lost")).toContain("คิดใหม่: ข้อความและเทคนิค")
  expect(t("write.doneGraphicsSkipped")).toMatch(/ดูได้ในแท็บกราฟิก$/)
  expect(t("write.doneGraphicsAllSkipped")).toMatch(/ดูได้ในแท็บกราฟิก$/)
  expect(t("graphics.none")).toBe("ยังไม่มีกราฟิกในช่วงนี้ กดคิดใหม่: กราฟิก ในเมนู AI")
})
