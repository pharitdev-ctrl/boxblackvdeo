import { expect, test } from "vitest"
import { t } from "./i18n.ts"

test("t fills named placeholders", () => {
  expect(t("detail.selectedSummary", { selected: 2, total: 3, duration: "1:05" })).toBe("เลือก 2 จาก 3 วิดีโอ · รวม 1:05")
})
