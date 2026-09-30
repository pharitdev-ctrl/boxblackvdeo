import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { useState } from "react"
import { Button } from "./Button.tsx"
import { Empty } from "./Empty.tsx"
import { Field } from "./Field.tsx"
import { Popover } from "./Popover.tsx"
import { Progress } from "./Progress.tsx"
import { Segmented } from "./Segmented.tsx"
import { Select } from "./Select.tsx"
import { Sheet } from "./Sheet.tsx"
import { Switch } from "./Switch.tsx"
import { TabPanel, Tabs } from "./Tabs.tsx"
import { Toast } from "./Toast.tsx"

afterEach(cleanup)

const checked = (name: string) => (screen.getByRole("radio", { name }) as HTMLInputElement).checked

/* Button */

test("a button says what it is and reports clicks; a disabled one does not", async () => {
  const clicks: string[] = []
  render(
    <>
      <Button onClick={() => clicks.push("plain")}>เขียน</Button>
      <Button variant="primary" disabled onClick={() => clicks.push("off")}>
        ปิดอยู่
      </Button>
    </>,
  )
  await userEvent.click(screen.getByRole("button", { name: "เขียน" }))
  await userEvent.click(screen.getByRole("button", { name: "ปิดอยู่" }))
  expect(clicks).toEqual(["plain"])
})

/* Segmented */

const LEVELS = [
  { value: "light", label: "น้อย" },
  { value: "medium", label: "กลาง" },
  { value: "heavy", label: "จัดเต็ม" },
]

function LevelPicker({ start = "medium", disabled = false }: { start?: string; disabled?: boolean }) {
  const [value, setValue] = useState(start)
  return <Segmented label="ระดับ" value={value} options={LEVELS} onChange={setValue} disabled={disabled} />
}

test("a segmented control shows the chosen option and changes on click", async () => {
  render(<LevelPicker />)
  const group = screen.getByRole("radiogroup", { name: "ระดับ" })
  expect(checked("กลาง")).toBe(true)
  await userEvent.click(screen.getByRole("radio", { name: "จัดเต็ม" }))
  expect(checked("จัดเต็ม")).toBe(true)
  expect(within(group).getAllByRole("radio")).toHaveLength(3)
})

test("arrow keys move through a segmented control, and a disabled one stays put", async () => {
  render(<LevelPicker start="light" />)
  await userEvent.click(screen.getByRole("radio", { name: "น้อย" }))
  await userEvent.keyboard("{ArrowRight}")
  expect(checked("กลาง")).toBe(true)

  cleanup()
  render(<LevelPicker disabled />)
  await userEvent.click(screen.getByRole("radio", { name: "จัดเต็ม" }))
  expect(checked("กลาง")).toBe(true)
})

/* Switch */

test("a switch is a switch, toggles, and a disabled one does nothing", async () => {
  const changes: boolean[] = []
  render(
    <>
      <Switch label="ตัดคำฟุ่มเฟือย" checked={false} onChange={(next) => changes.push(next)} hint="เช่น เอ่อ อืม" />
      <Switch label="ตัดเทคซ้ำ" checked disabled onChange={(next) => changes.push(next)} />
    </>,
  )
  await userEvent.click(screen.getByRole("switch", { name: /ตัดคำฟุ่มเฟือย/ }))
  await userEvent.click(screen.getByRole("switch", { name: "ตัดเทคซ้ำ" }))
  expect(changes).toEqual([true])
  expect(screen.getByText("เช่น เอ่อ อืม")).toBeTruthy()
})

/* Select */

test("a select offers its options and reports the chosen value", async () => {
  const chosen: string[] = []
  render(
    <Select label="เสียงประกอบ" value="s1" onChange={(v) => chosen.push(v)}>
      <option value="s1">ปัง</option>
      <option value="s2">ฟิ้ว</option>
    </Select>,
  )
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "เสียงประกอบ" }), "s2")
  expect(chosen).toEqual(["s2"])
})

/* Field */

test("a field labels what is inside it and shows its hint", () => {
  render(
    <Field label="ความยาวเป้าหมาย" hint="ไม่บังคับ">
      <input />
    </Field>,
  )
  expect(screen.getByLabelText("ความยาวเป้าหมาย")).toBeTruthy()
  expect(screen.getByText("ไม่บังคับ")).toBeTruthy()
})

/* Tabs */

const TABS = [
  { id: "speech", label: "คำพูด" },
  { id: "text", label: "ข้อความเด่น", count: 2 },
  { id: "subtitles", label: "ซับ", disabled: true },
]

function TabStrip({ start = "speech" }: { start?: string }) {
  const [value, setValue] = useState(start)
  return (
    <>
      <Tabs label="ส่วนของบีต" value={value} tabs={TABS} onChange={setValue} />
      <p>{value}</p>
    </>
  )
}

test("tabs show a count, change on click, and move with the arrow keys", async () => {
  render(<TabStrip />)
  expect(screen.getByRole("tab", { name: /ข้อความเด่น/ }).textContent).toContain("2")
  await userEvent.click(screen.getByRole("tab", { name: /ข้อความเด่น/ }))
  expect(screen.getByText("text")).toBeTruthy()
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"])
  await userEvent.keyboard("{ArrowLeft}")
  expect(screen.getByText("speech")).toBeTruthy()
})

test("a tab that is switched off can still be chosen, and says it is off", async () => {
  render(<TabStrip />)
  const off = screen.getByRole("tab", { name: /ซับ/ })
  expect(off.getAttribute("aria-disabled")).toBe("true")
  await userEvent.click(off)
  expect(screen.getByText("subtitles")).toBeTruthy()
})

test("a tab can carry a flag that says something in it needs attention", () => {
  render(<Tabs label="หมวด" value="a" tabs={[{ id: "a", label: "ทั่วไป" }, { id: "b", label: "ถอดเสียง", flag: "มีเรื่องต้องแก้" }]} onChange={() => {}} />)
  expect(screen.getByRole("tab", { name: /ถอดเสียง/ }).textContent).toContain("ถอดเสียง")
  expect(within(screen.getByRole("tab", { name: /ถอดเสียง/ })).getByLabelText("มีเรื่องต้องแก้")).toBeTruthy()
  expect(within(screen.getByRole("tab", { name: /ทั่วไป/ })).queryByLabelText("มีเรื่องต้องแก้")).toBeNull()
})

test("a tab whose work is running says so with a spinner, and one that is not says nothing", () => {
  render(<Tabs label="หมวด" value="a" tabs={[{ id: "a", label: "ทั่วไป" }, { id: "b", label: "เสียง", busy: "กำลังทำ" }]} onChange={() => {}} />)
  expect(within(screen.getByRole("tab", { name: /เสียง/ })).getByRole("img", { name: "กำลังทำ" })).toBeTruthy()
  expect(within(screen.getByRole("tab", { name: /ทั่วไป/ })).queryByRole("img")).toBeNull()
})

test("the tabs say which panel they show, and the panel is named by the tab open", () => {
  render(
    <>
      <Tabs label="หมวด" value="b" panelId="panel" tabs={[{ id: "a", label: "ทั่วไป" }, { id: "b", label: "เสียง" }]} onChange={() => {}} />
      <TabPanel id="panel" value="b">
        เนื้อหา
      </TabPanel>
    </>,
  )
  const panel = screen.getByRole("tabpanel", { name: "เสียง" })
  expect(panel.textContent).toBe("เนื้อหา")
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-controls"))).toEqual(["panel", "panel"])
})

/* Sheet */

test("a sheet closes on Escape and on the backdrop, but not from inside", async () => {
  const closes: number[] = []
  render(
    <Sheet open title="ตั้งค่าคลิป" onClose={() => closes.push(1)} footer={<Button>ปิด</Button>}>
      <p>เนื้อหา</p>
    </Sheet>,
  )
  const dialog = screen.getByRole("dialog", { name: "ตั้งค่าคลิป" })
  await userEvent.click(screen.getByText("เนื้อหา"))
  expect(closes).toHaveLength(0)
  await userEvent.keyboard("{Escape}")
  expect(closes).toHaveLength(1)
  await userEvent.click(dialog.parentElement!)
  expect(closes).toHaveLength(2)
})

test("a closed sheet shows nothing", () => {
  render(
    <Sheet open={false} title="ตั้งค่าคลิป" onClose={() => {}}>
      <p>เนื้อหา</p>
    </Sheet>,
  )
  expect(screen.queryByText("เนื้อหา")).toBeNull()
})

/* Popover */

test("a popover closes on Escape and on a click outside, but not on one inside", async () => {
  const closes: number[] = []
  render(
    <div>
      <button>ข้างนอก</button>
      <Popover open label="รูปลักษณ์" onClose={() => closes.push(1)}>
        <button>ข้างใน</button>
      </Popover>
    </div>,
  )
  await userEvent.click(screen.getByRole("button", { name: "ข้างใน" }))
  expect(closes).toHaveLength(0)
  await userEvent.keyboard("{Escape}")
  expect(closes).toHaveLength(1)
  await userEvent.click(screen.getByRole("button", { name: "ข้างนอก" }))
  expect(closes).toHaveLength(2)
})

test("a popover that has closed stops listening", async () => {
  const closes: number[] = []
  const { rerender } = render(
    <div>
      <button>ข้างนอก</button>
      <Popover open label="รูปลักษณ์" onClose={() => closes.push(1)}>
        <button>ข้างใน</button>
      </Popover>
    </div>,
  )
  rerender(
    <div>
      <button>ข้างนอก</button>
      <Popover open={false} label="รูปลักษณ์" onClose={() => closes.push(1)}>
        <button>ข้างใน</button>
      </Popover>
    </div>,
  )
  await userEvent.click(screen.getByRole("button", { name: "ข้างนอก" }))
  await userEvent.keyboard("{Escape}")
  expect(closes).toEqual([])
})

/* Toast */

test("a toast goes away by itself and can be acted on", async () => {
  vi.useFakeTimers()
  const done: number[] = []
  const acted: number[] = []
  render(<Toast message="เขียนแล้ว" action={{ label: "เขียนอีกครั้ง", onClick: () => acted.push(1) }} onDone={() => done.push(1)} ms={5000} />)
  expect(screen.getByRole("status").textContent).toContain("เขียนแล้ว")
  vi.advanceTimersByTime(4999)
  expect(done).toHaveLength(0)
  vi.advanceTimersByTime(1)
  expect(done).toHaveLength(1)
  vi.useRealTimers()

  await userEvent.click(screen.getByRole("button", { name: "เขียนอีกครั้ง" }))
  expect(acted).toEqual([1])
})

/* Progress */

test("a progress bar reports how far it is, and says so when it cannot", () => {
  const { rerender } = render(<Progress value={0.42} label="ถอดเสียง" />)
  const bar = screen.getByRole("progressbar", { name: "ถอดเสียง" })
  expect(bar.getAttribute("aria-valuenow")).toBe("42")
  rerender(<Progress value={null} label="ถอดเสียง" />)
  expect(screen.getByRole("progressbar", { name: "ถอดเสียง" }).hasAttribute("aria-valuenow")).toBe(false)
})

/* Empty */

test("an empty state explains itself and can offer a way out", () => {
  render(<Empty title="ยังไม่มีข้อความเด่น" hint="กด Aa เน้น ที่ประโยคไหนก็ได้" action={<Button>ให้ AI เลือก</Button>} />)
  expect(screen.getByText("ยังไม่มีข้อความเด่น")).toBeTruthy()
  expect(screen.getByText("กด Aa เน้น ที่ประโยคไหนก็ได้")).toBeTruthy()
  expect(screen.getByRole("button", { name: "ให้ AI เลือก" })).toBeTruthy()
})
