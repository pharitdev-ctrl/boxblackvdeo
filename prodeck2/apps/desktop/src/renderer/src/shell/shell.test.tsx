import { afterEach, expect, test } from "vitest"
import { useContext } from "react"
import { createPortal } from "react-dom"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { backupInfo, fakeApi } from "../../test/fake-api.ts"
import { formatDate } from "../format.ts"
import { t } from "../i18n.ts"
import { AlertBar, type Alert } from "./AlertBar.tsx"
import { AppShell, ToolbarSlot } from "./AppShell.tsx"
import { BackupMenu } from "./BackupMenu.tsx"
import { StageChips } from "./StageChips.tsx"

afterEach(cleanup)

/* StageChips */

const chip = (name: string) => screen.getByRole("button", { name: new RegExp(name) })

test("the chips say which stage the user is on and which ones are behind", () => {
  render(<StageChips stage="outline" reachable={{ prepare: true, outline: true, post: false }} onStage={() => {}} />)
  expect(chip(t("stage.outline")).getAttribute("aria-current")).toBe("step")
  expect(chip(t("stage.prepare")).getAttribute("aria-current")).toBeNull()
  expect(chip(t("stage.prepare"))).toHaveProperty("disabled", false)
  expect(chip(t("stage.post"))).toHaveProperty("disabled", true)
})

test("there are three stages, เตรียม · โครงเรื่อง · โพสต์โปรดักชัน in that order, and no chip is for writing", () => {
  render(<StageChips stage="post" reachable={{ prepare: true, outline: true, post: true }} onStage={() => {}} />)
  const chips = screen.getAllByRole("button")
  // the words themselves, so a key renamed under a chip cannot hide it
  expect(chips.map((button) => button.querySelector(".stage-name")!.textContent)).toEqual(["เตรียม", "โครงเรื่อง", "โพสต์โปรดักชัน"])
  expect(chips.map((button) => button.textContent)).toEqual(["✓เตรียม", "✓โครงเรื่อง", "3โพสต์โปรดักชัน"])
  expect(chips.map((button) => button.getAttribute("aria-current"))).toEqual([null, null, "step"])
  // the write button is on the post-production page's bar: no stage is named for it
  expect(screen.queryByRole("button", { name: /เขียนลง CapCut/ })).toBeNull()
})

test("a chip the user has been through goes back there, and one ahead cannot be clicked", async () => {
  const went: string[] = []
  render(<StageChips stage="post" reachable={{ prepare: true, outline: true, post: true }} onStage={(stage) => went.push(stage)} />)
  await userEvent.click(chip(t("stage.prepare")))
  await userEvent.click(chip(t("stage.outline")))
  await userEvent.click(chip(t("stage.post")))
  expect(went).toEqual(["prepare", "outline", "post"])

  cleanup()
  went.length = 0
  render(<StageChips stage="prepare" reachable={{ prepare: true, outline: false, post: false }} onStage={(stage) => went.push(stage)} />)
  await userEvent.click(chip(t("stage.outline")))
  await userEvent.click(chip(t("stage.post")))
  expect(went).toEqual([])
})

test("with no stage — the project list — the chips are not there at all", () => {
  render(<StageChips stage={null} reachable={{ prepare: false, outline: false, post: false }} onStage={() => {}} />)
  expect(screen.queryByRole("button")).toBeNull()
})

/* AppShell */

test("a stage puts its own buttons on the bar through the toolbar slot: after the stage chips, before the backups and the settings button", async () => {
  const api = fakeApi({ listBackups: async () => [backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })] })
  // a stage renders in the frame's screen, and reaches the bar the way the post-production page does
  function Stage() {
    const slot = useContext(ToolbarSlot)
    return slot && createPortal(<button type="button">ปุ่มของขั้นนี้</button>, slot)
  }
  render(
    <AppShell
      title="0917"
      stage="post"
      reachable={{ prepare: true, outline: true, post: true }}
      onStage={() => {}}
      alerts={[]}
      backups={{ api, folder: "/drafts/0917", capcutRunning: false, refreshKey: 0, onRestored: () => {} }}
      onSettings={() => {}}
    >
      <Stage />
    </AppShell>,
  )
  const bar = document.querySelector<HTMLElement>("header.topbar")!
  const own = await within(bar).findByRole("button", { name: "ปุ่มของขั้นนี้" })
  const backups = await within(bar).findByRole("button", { name: t("shell.backupsCount", { count: 1 }) })
  const settings = within(bar).getByRole("button", { name: t("nav.settings") })
  const stages = within(bar).getByRole("navigation", { name: t("stages.label") })
  expect(bar.contains(own)).toBe(true)
  const follows = (before: Node, after: Node) => Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(follows(stages, own)).toBe(true)
  expect(follows(own, backups)).toBe(true)
  expect(follows(backups, settings)).toBe(true)
  // the button is in the bar, not in the screen below it
  expect(within(screen.getByRole("main")).queryByRole("button", { name: "ปุ่มของขั้นนี้" })).toBeNull()
})

/* AlertBar */

const alerts: Alert[] = [
  { id: "license", tone: "warn", text: "license หมดอายุพรุ่งนี้" },
  { id: "capcut", tone: "warn", text: "CapCut เปิดอยู่", detail: "ปิดก่อนจึงจะเขียนได้" },
  { id: "update", tone: "info", text: "อัปเดตพร้อมติดตั้ง" },
]

test("only the first thing to worry about shows, and the rest fold out behind a count", async () => {
  render(<AlertBar alerts={alerts} />)
  expect(screen.getByText("license หมดอายุพรุ่งนี้")).toBeTruthy()
  expect(screen.queryByText("CapCut เปิดอยู่")).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: t("alerts.showAll", { count: 2 }) }))
  expect(screen.getByText("CapCut เปิดอยู่")).toBeTruthy()
  expect(screen.getByText("ปิดก่อนจึงจะเขียนได้")).toBeTruthy()
  expect(screen.getByText("อัปเดตพร้อมติดตั้ง")).toBeTruthy()

  await userEvent.click(screen.getByRole("button", { name: t("alerts.hide") }))
  expect(screen.queryByText("CapCut เปิดอยู่")).toBeNull()
})

test("one alert needs no fold, and none shows nothing", () => {
  const { rerender } = render(<AlertBar alerts={[alerts[0]!]} />)
  expect(screen.queryByRole("button")).toBeNull()
  rerender(<AlertBar alerts={[]} />)
  expect(screen.queryByText("license หมดอายุพรุ่งนี้")).toBeNull()
})

test("an alert can carry the button that deals with it", async () => {
  const done: number[] = []
  render(<AlertBar alerts={[{ id: "update", tone: "info", text: "อัปเดตพร้อมติดตั้ง", action: { label: "รีสตาร์ท", onClick: () => done.push(1) } }]} />)
  await userEvent.click(screen.getByRole("button", { name: "รีสตาร์ท" }))
  expect(done).toEqual([1])
})

/* BackupMenu */

const BACKUP = backupInfo("0917-older", "2026-09-17T08:00:00.000Z", { durationUs: 14_000_000, segmentCount: 3 })
const date = formatDate(Date.parse(BACKUP.createdAt) * 1000)

function renderMenu(overrides: Parameters<typeof fakeApi>[0] = {}, capcutRunning: boolean | null = false) {
  const restored: number[] = []
  const api = fakeApi({ listBackups: async () => [BACKUP], ...overrides })
  render(<BackupMenu api={api} folder="/drafts/0917" capcutRunning={capcutRunning} refreshKey={0} onRestored={() => restored.push(1)} />)
  return { api, restored }
}

test("the backup button counts what can be restored and opens the list", async () => {
  renderMenu()
  const button = await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) })
  await userEvent.click(button)
  expect(screen.getByText(t("backups.item", { date, duration: "0:14", count: 3 }))).toBeTruthy()
})

test("restoring asks first, then tells whoever is listening", async () => {
  const { api, restored } = renderMenu()
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  await userEvent.click(screen.getByRole("button", { name: t("backups.restore") }))
  expect(screen.getByText(t("backups.confirmRestore"))).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: t("backups.confirm") }))
  await waitFor(() => expect(api.calls).toContainEqual(["restoreBackup", "/drafts/0917", "0917-older"]))
  expect(restored).toEqual([1])
})

test("a write that starts while a restore waits to be confirmed shuts the confirm too", async () => {
  const api = fakeApi({ listBackups: async () => [BACKUP] })
  const menu = (writing: boolean) => <BackupMenu api={api} folder="/drafts/0917" capcutRunning={false} refreshKey={0} onRestored={() => {}} writing={writing} />
  const { rerender } = render(menu(false))
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  await userEvent.click(screen.getByRole("button", { name: t("backups.restore") }))
  expect(screen.getByRole("button", { name: t("backups.confirm") })).toHaveProperty("disabled", false)
  rerender(menu(true))
  expect(screen.getByRole("button", { name: t("backups.confirm") })).toHaveProperty("disabled", true)
  expect(screen.getByText(t("backups.writing"))).toBeTruthy()
})

test("a restore waiting to be confirmed is shut too once CapCut is no longer known to be closed", async () => {
  const api = fakeApi({ listBackups: async () => [BACKUP] })
  const menu = (capcutRunning: boolean | null) => <BackupMenu api={api} folder="/drafts/0917" capcutRunning={capcutRunning} refreshKey={0} onRestored={() => {}} />
  const { rerender } = render(menu(false))
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  await userEvent.click(screen.getByRole("button", { name: t("backups.restore") }))
  expect(screen.getByRole("button", { name: t("backups.confirm") })).toHaveProperty("disabled", false)
  rerender(menu(true))
  expect(screen.getByRole("button", { name: t("backups.confirm") })).toHaveProperty("disabled", true)
  // not looked for yet is not closed either
  rerender(menu(null))
  expect(screen.getByRole("button", { name: t("backups.confirm") })).toHaveProperty("disabled", true)
})

test("restoring waits for CapCut to be closed", async () => {
  renderMenu({}, true)
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  expect(screen.getByRole("button", { name: t("backups.restore") })).toHaveProperty("disabled", true)
})

test("a project never written to says so", async () => {
  renderMenu({ listBackups: async () => [] })
  const button = await screen.findByRole("button", { name: t("shell.backups") })
  await userEvent.click(button)
  expect(screen.getByText(t("backups.empty"))).toBeTruthy()
})

test("the list is read again when the key changes", async () => {
  const api = fakeApi({ listBackups: async () => [BACKUP] })
  const { rerender } = render(<BackupMenu api={api} folder="/drafts/0917" capcutRunning={false} refreshKey={0} onRestored={() => {}} />)
  await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) })
  rerender(<BackupMenu api={api} folder="/drafts/0917" capcutRunning={false} refreshKey={1} onRestored={() => {}} />)
  await waitFor(() => expect(api.calls.filter(([name]) => name === "listBackups")).toHaveLength(2))
})

test("a backup of an empty timeline says that instead of a length", async () => {
  renderMenu({ listBackups: async () => [backupInfo("0917-empty", "2026-09-17T09:00:00.000Z")] })
  await userEvent.click(await screen.findByRole("button", { name: t("shell.backupsCount", { count: 1 }) }))
  const row = screen.getByRole("listitem")
  expect(within(row).getByText(t("backups.itemEmpty", { date: formatDate(Date.parse("2026-09-17T09:00:00.000Z") * 1000) }))).toBeTruthy()
})
