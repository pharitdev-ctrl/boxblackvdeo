# Write Button on the Post Page Implementation Plan (0.4.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The write stage goes away. The post-production page's top bar gets a "เขียนลง CapCut" button with a confirm sheet, as before M25. Release 0.4.4.

**Architecture:** Renderer only. A pure function says why the write is held. `edit/WriteButton.tsx` holds the button, the short reason, the confirm sheet (the old write page's summary) and a notice for failed reads. The post page portals the AI menu and the button into a toolbar slot that `AppShell` publishes through a context, so the button reads `ClipRoom`'s context. `ClipRoom` keeps the write state and tells every end by a toast. `App.tsx` and `StageChips` drop the "write" stage. Main and core do not change.

**Tech Stack:** React, TypeScript on Node 26, vitest with Testing Library.

**Spec:** `docs/specs/2026-09-27-post-production-design.md` §14 "0.4.4" (Thai; the user approved it on 2026-09-30).

---

## How to run this plan

- **No git.** "Commit" means `npm test` is green and `npm run typecheck` is clean, both run from the repo root. The controller snapshots the code before each task.
- **Nothing is deleted outright.** A file that goes is moved with `mv <file> ~/.Trash/<name>-0930`.
- **Tests first.** Every behaviour below gets a test that fails before the code and passes after.
- **Only the controller** runs mutation checks, builds the DMG and writes draft `0917`.

## Files

| Task | Create | Modify | Remove (to the Trash) |
|---|---|---|---|
| 1 | `renderer/src/edit/writeHold.ts`, `writeHold.test.ts`, `renderer/src/edit/WriteButton.tsx`, `WriteButton.test.tsx` | `renderer/src/edit/WriteBar.tsx`, `renderer/src/i18n.ts`, `renderer/src/styles/edit.css` | — |
| 2 | — | `shell/AppShell.tsx`, `styles/shell.css`, `screens/PostScreen.tsx`, `room/ClipRoom.tsx`, `App.tsx`, `shell/StageChips.tsx`, `test/room.tsx`, `i18n.ts`, `styles/edit.css`, the tests those touch | `screens/WriteScreen.tsx`, `screens/WriteScreen.test.tsx` |
| 3 | — | `apps/desktop/package.json`, `docs/specs/2026-09-17-capcut-timeline-manager-design.md` | — |

All renderer paths are under `apps/desktop/src/renderer/`.

---

### Task 1: The hold, the button and the confirm sheet

**Files:**
- Create: `apps/desktop/src/renderer/src/edit/writeHold.ts`, `apps/desktop/src/renderer/src/edit/writeHold.test.ts`
- Create: `apps/desktop/src/renderer/src/edit/WriteButton.tsx`, `apps/desktop/src/renderer/src/edit/WriteButton.test.tsx`
- Modify: `apps/desktop/src/renderer/src/edit/WriteBar.tsx` (add `doneNotes`, `toldMessage`, move `DROPPED_NAMES` here)
- Modify: `apps/desktop/src/renderer/src/i18n.ts` (add three keys)
- Modify: `apps/desktop/src/renderer/src/styles/edit.css` (styles for the reason and the sheet list)

`WriteScreen` stays untouched in this task, so every existing test stays green. Task 2 wires the button in and removes the page.

- [ ] **Step 1: Write the failing tests for `writeHold`**

`writeHold` takes the fields of `ClipRoomValue` it reads and answers the i18n key of the first hold, or null. One test per row, each starting from a room that can write and changing one field:

```ts
import { expect, test } from "vitest"
import { writeHold, type HoldInput } from "./writeHold.ts"

const ready = (): HoldInput => ({
  capcutRunning: false, writeKnown: true,
  failed: { settings: false, cut: false, preview: false, lines: false },
  rules: {} as HoldInput["rules"], highlights: {} as HoldInput["highlights"], flair: {} as HoldInput["flair"],
  plan: {} as HoldInput["plan"], empty: false, run: { running: false, states: {} },
  placing: false, preview: {} as HoldInput["preview"], subtitlesOn: false, lines: null,
})

test("a room with everything in holds nothing", () => expect(writeHold(ready())).toBe(null))
test("CapCut open holds first, before anything else", () =>
  expect(writeHold({ ...ready(), capcutRunning: true, writeKnown: false, plan: null })).toBe("write.check.capcutOpen"))
test("CapCut not known yet", () => expect(writeHold({ ...ready(), capcutRunning: null })).toBe("write.check.capcutUnknown"))
test("a write in the draft not known yet", () => expect(writeHold({ ...ready(), writeKnown: false })).toBe("write.check.writeKnown"))
test("settings that failed to read", () => expect(writeHold({ ...ready(), failed: { ...ready().failed, settings: true }, rules: null })).toBe("write.check.settingsFailed"))
test("settings not read yet wait as placing", () => expect(writeHold({ ...ready(), flair: null })).toBe("write.check.placing"))
test("a cut that failed", () => expect(writeHold({ ...ready(), failed: { ...ready().failed, cut: true } })).toBe("write.check.cutFailed"))
test("a cut still worked out", () => expect(writeHold({ ...ready(), plan: null })).toBe("write.check.cutting"))
test("a cut with nothing left", () => expect(writeHold({ ...ready(), empty: true })).toBe("write.check.cutEmpty"))
test("a plan run going", () => expect(writeHold({ ...ready(), run: { running: true, states: {} } })).toBe("write.check.planning"))
test("a placement that failed, even with no preview on screen", () =>
  expect(writeHold({ ...ready(), failed: { ...ready().failed, preview: true }, preview: null })).toBe("write.check.previewFailed"))
test("subtitle lines that failed", () => expect(writeHold({ ...ready(), failed: { ...ready().failed, lines: true } })).toBe("write.check.linesFailed"))
test("placing again", () => expect(writeHold({ ...ready(), placing: true })).toBe("write.check.placing"))
test("no preview yet", () => expect(writeHold({ ...ready(), preview: null })).toBe("write.check.placing"))
test("subtitles on and their lines not read yet", () => expect(writeHold({ ...ready(), subtitlesOn: true })).toBe("write.check.placing"))
test("subtitles off need no lines", () => expect(writeHold({ ...ready(), subtitlesOn: false, lines: null })).toBe(null))
```

Run: `npx vitest run apps/desktop/src/renderer/src/edit/writeHold.test.ts` from the repo root. Expected: FAIL, the module does not exist.

- [ ] **Step 2: Write `writeHold.ts`**

```ts
import type { MessageKey } from "../i18n.ts"
import type { ClipRoomValue } from "../room/ClipRoom.tsx"

/** What the hold reads of the room. */
export type HoldInput = Pick<
  ClipRoomValue,
  "capcutRunning" | "writeKnown" | "failed" | "rules" | "highlights" | "flair" | "plan" | "empty" | "run" | "placing" | "preview" | "subtitlesOn" | "lines"
>

/**
 * Why the write cannot start now: the first hold in the order spec §14 "0.4.4" lists, as the key of its
 * words, or null when it can. A write already running is not a hold here: the button says it is writing.
 */
export function writeHold(room: HoldInput): MessageKey | null {
  if (room.capcutRunning === true) return "write.check.capcutOpen"
  if (room.capcutRunning === null) return "write.check.capcutUnknown"
  if (!room.writeKnown) return "write.check.writeKnown"
  if (room.failed.settings) return "write.check.settingsFailed"
  if (room.failed.cut) return "write.check.cutFailed"
  if (room.plan === null) return "write.check.cutting"
  if (room.empty) return "write.check.cutEmpty"
  if (room.run.running) return "write.check.planning"
  if (room.failed.preview) return "write.check.previewFailed"
  if (room.failed.lines) return "write.check.linesFailed"
  const subtitlesReady = !room.subtitlesOn || room.lines !== null
  if (room.placing || room.preview === null || !subtitlesReady || room.rules === null || room.highlights === null || room.flair === null) return "write.check.placing"
  return null
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Write the failing tests for `WriteButton`**

Put them in `WriteButton.test.tsx`. Render with `renderRoom(overrides, { page: "post" })` from `test/room.tsx`, and render `<WriteButton />` beside the page, for example through a small host in the test that mounts it inside the same `ClipRoom`. (Task 2 puts it in the post page's toolbar; until then the test mounts it itself.) Port every behaviour of `screens/WriteScreen.test.tsx` that is still true, and add the new ones. The list below is the complete set; name each test after its line.

Button and reason:
1. With everything in, the button reads `t("timeline.write")`, is enabled and shows no reason.
2. With CapCut open, the button is disabled and the reason `t("write.check.capcutOpen")` shows next to it. The reason element has a `title` with the same full text.
3. Each other hold of `writeHold` shows its own words: cutting, cut empty, planning, placing. One test each, as the old write page tested its rows.
4. While a write runs (the room's own and one it follows from a `timeline-write` "started" event), the button reads `t("write.writing")`, is disabled and shows no reason.
5. After a write, the button reads `t("write.again")`.

Sheet:
6. Clicking the button opens a dialog named `t("write.title", { project: project.name })`. Nothing is written yet: no `writeTimeline` call.
7. The sheet lists the summary rows of the old write page, with the same words: video and target, emphasis at the level, highlight text (or "off"), graphics that play minus failed renders (or "off"), zooms, inserts, sounds (each or "off"), subtitles (or "off"), `write.zoomsLost` and `write.proLeftOut` when above zero.
8. It says `t("warn.timelineReplaced", { count })` when the timeline has pieces, else `t("write.fresh")`; and `t("warn.untestedVersion", …)` when the version is untested.
9. With graphics playing, it says `t("write.check.graphics", { done, total })`, adds `t("write.check.graphicsGoing")` while some are not finished, and `t("write.check.graphicsFailed", { count })` when renders failed.
10. It ends with `t("write.backup")`.
11. "ยกเลิก" (`t("write.cancel")`) and Escape close it with no write.
12. "เขียนเลย" (`t("write.confirm")`) writes once, with exactly the arguments the old write page sent (port that test's `writeTimeline` argument check: rules, timeline segment count, subtitles `{ length, texts }` or null, and `{ position, hideSubtitles, highlightsOn, groupCount, flair }`), and closes the sheet.
13. "เขียนเลย" is disabled when a hold appears while the sheet is open (CapCut opened meanwhile), and nothing is written.

Failed reads (`FailedReads`, exported from the same file):
14. Each failed read shows its words (`write.check.settingsFailed`, `cutFailed`, `previewFailed`, `linesFailed`) with a `t("write.check.retry")` button. The button is described by its words (`aria-describedby`), and clicking it calls `room.retry` for that read (port the old retry tests, which check the read happens again).
15. With nothing failed, it renders nothing.

Run: `npx vitest run apps/desktop/src/renderer/src/edit/WriteButton.test.tsx`. Expected: FAIL, the module does not exist.

- [ ] **Step 4: Add the i18n keys**

In `i18n.ts`, next to the `write.*` keys:

```ts
  "write.title": "เขียนลง “{project}”",
  "write.cancel": "ยกเลิก",
  "write.confirm": "เขียนเลย",
```

- [ ] **Step 5: Move `DROPPED_NAMES` and add the told message in `WriteBar.tsx`**

`DROPPED_NAMES` moves from `WriteScreen.tsx` to `WriteBar.tsx` and is exported. `WriteScreen.tsx` imports it from there until Task 2 removes the page. Add:

```ts
/** What the result says beyond the count, one phrase each: what was dropped by kind, zooms lost, Pro items left out. */
export function doneNotes(written: WriteResult): string[] {
  const notes: string[] = []
  for (const kind of Object.keys(DROPPED_NAMES) as (keyof WriteResult["dropped"])[]) {
    if (written.dropped[kind] > 0) notes.push(t("write.resultDropped", { what: t(DROPPED_NAMES[kind]), count: written.dropped[kind] }))
  }
  if (written.zoomsLost > 0) notes.push(t("write.zoomsLost", { count: written.zoomsLost }))
  if (written.proLeftOut.exits + written.proLeftOut.sounds > 0) notes.push(t("write.proLeftOut", { exits: written.proLeftOut.exits, sounds: written.proLeftOut.sounds }))
  return notes
}

/** The toast after a write in the room: what was written, then what it left out. */
export function toldMessage(written: WriteResult): string {
  return [doneMessage(written), ...doneNotes(written)].join(" · ")
}

/** A toast that says more than the count, or that graphics were left out, stays longer. */
export const toldIsLong = (written: WriteResult): boolean => written.graphicsSkipped > 0 || doneNotes(written).length > 0
```

Add tests for these three in a new `edit/WriteBar.test.ts`: no notes for a clean result; one note per dropped kind above zero; zooms lost; Pro left out with only exits and with only sounds; `toldMessage` joins with " · "; `toldIsLong` true for skipped graphics and for any note, false otherwise. Watch them fail, then pass.

- [ ] **Step 6: Write `WriteButton.tsx`**

```tsx
import { useId, useState, type ReactElement } from "react"
import type { FlairLevel } from "../../../shared/api.ts"
import { formatDuration } from "../format.ts"
import { t, type MessageKey } from "../i18n.ts"
import { useClipRoom, type RoomRead } from "../room/ClipRoom.tsx"
import { Button } from "../ui/Button.tsx"
import { Sheet } from "../ui/Sheet.tsx"
import { writeHold } from "./writeHold.ts"

const LEVEL_NAMES: Record<FlairLevel, MessageKey> = { light: "flair.level.light", medium: "flair.level.medium", heavy: "flair.level.heavy" }

/** The post page's write button, the reason it is off, and the sheet that asks before writing. */
export function WriteButton(): ReactElement {
  const room = useClipRoom()
  const { api, folder, project, stored, plan, preview, texts, rules, subtitles, highlights, flair, writing, write: state } = room
  const { highlightsOn, subtitlesOn, graphicsOn } = room
  const [asking, setAsking] = useState(false)
  const hold = writeHold(room)
  const canWrite = hold === null && !writing
  const reasonId = useId()

  const playing = graphicsOn ? (preview?.graphics.filter((graphic) => !graphic.off) ?? []) : []
  const rendered = playing.filter((graphic) => graphic.render === "ready").length
  const failedRenders = playing.filter((graphic) => graphic.render === "failed").length
  const finished = rendered + failedRenders
  const shownPoints = preview?.emphasis.points.filter((point) => point.shown).length ?? 0
  const levelName = flair ? t(LEVEL_NAMES[flair.level]) : ""
  const off = (what: MessageKey) => t("write.off", { what: t(what) })
  const targetUs = stored.brief.targetSeconds === null ? null : stored.brief.targetSeconds * 1_000_000

  const write = () => {
    if (!canWrite || !rules || !highlights || !flair || !preview) return
    setAsking(false)
    void room.runWrite(() =>
      api.writeTimeline(folder, rules, project.timelineSegmentCount, subtitlesOn && subtitles ? { length: subtitles.length, texts } : null, {
        position: highlights.position,
        hideSubtitles: highlights.hideSubtitles,
        highlightsOn,
        groupCount: preview.groups.length,
        flair,
      }),
    )
  }

  return (
    <>
      {hold && !writing && (
        <span id={reasonId} className="write-reason warn-text" title={t(hold)}>
          {t(hold)}
        </span>
      )}
      <Button variant="primary" disabled={!canWrite} aria-describedby={hold && !writing ? reasonId : undefined} onClick={() => setAsking(true)}>
        {writing ? t("write.writing") : state.kind === "written" ? t("write.again") : t("timeline.write")}
      </Button>
      <Sheet
        open={asking}
        title={t("write.title", { project: project.name })}
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>{t("write.cancel")}</Button>
            <Button variant="primary" disabled={!canWrite} onClick={write}>
              {t("write.confirm")}
            </Button>
          </>
        }
      >
        <ul className="write-list">
          <li>
            {t("write.video", { pieces: plan?.cuts.length ?? 0, duration: formatDuration(plan?.durationUs ?? 0) })}
            {targetUs !== null && ` · ${t("write.target", { target: formatDuration(targetUs) })}`}
          </li>
          <li>{t("write.emphasis", { count: shownPoints, level: levelName })}</li>
          <li>
            {highlightsOn
              ? t("write.text", { groups: preview?.groups.length ?? 0, lines: preview?.groups.reduce((sum, group) => sum + group.lines.length, 0) ?? 0 })
              : off("highlights.title")}
          </li>
          <li>{graphicsOn ? t("write.graphics", { count: playing.length - failedRenders }) : off("flair.graphic")}</li>
          <li>{flair?.zoom ? t("write.zooms", { count: preview?.zooms.length ?? 0 }) : off("flair.zoom")}</li>
          <li>{flair?.insert ? t("write.inserts", { count: preview?.inserts.length ?? 0 }) : off("flair.insert")}</li>
          <li>{flair?.sound ? t("write.sounds", { count: preview?.cues.length ?? 0 }) : off("flair.sound")}</li>
          <li>{subtitlesOn ? t("write.subtitles", { count: texts.filter((text) => text.trim()).length }) : off("subtitles.title")}</li>
          {(preview?.zoomsLost ?? 0) > 0 && <li className="warn-text">{t("write.zoomsLost", { count: preview!.zoomsLost })}</li>}
          {preview && preview.proLeftOut.exits + preview.proLeftOut.sounds > 0 && (
            <li className="warn-text">{t("write.proLeftOut", { exits: preview.proLeftOut.exits, sounds: preview.proLeftOut.sounds })}</li>
          )}
        </ul>
        <ul className="write-list write-notes">
          <li className={project.timelineSegmentCount > 0 ? "warn-text" : undefined}>
            {project.timelineSegmentCount > 0 ? t("warn.timelineReplaced", { count: project.timelineSegmentCount }) : t("write.fresh")}
          </li>
          {!project.versionTested && <li className="warn-text">{t("warn.untestedVersion", { version: project.capcutVersion })}</li>}
          {playing.length > 0 && (
            <li>
              {t("write.check.graphics", { done: finished, total: playing.length })}
              {finished < playing.length && ` · ${t("write.check.graphicsGoing")}`}
            </li>
          )}
          {failedRenders > 0 && <li className="warn-text">{t("write.check.graphicsFailed", { count: failedRenders })}</li>}
        </ul>
        <p className="hint">{t("write.backup")}</p>
      </Sheet>
    </>
  )
}

const FAILED_WORDS: Record<RoomRead, MessageKey> = {
  settings: "write.check.settingsFailed",
  cut: "write.check.cutFailed",
  preview: "write.check.previewFailed",
  lines: "write.check.linesFailed",
}

/** One notice per read that failed, each with the way to read it again. Nothing when none failed. */
export function FailedReads(): ReactElement | null {
  const { failed, retry } = useClipRoom()
  const reads = (Object.keys(FAILED_WORDS) as RoomRead[]).filter((read) => failed[read])
  if (reads.length === 0) return null
  return (
    <>
      {reads.map((read) => (
        <FailedRead key={read} text={t(FAILED_WORDS[read])} onRetry={() => retry(read)} />
      ))}
    </>
  )
}

function FailedRead({ text, onRetry }: { text: string; onRetry: () => void }) {
  const textId = useId()
  return (
    <p className="notice error read-failed">
      <span id={textId}>{text}</span>
      <Button size="sm" aria-describedby={textId} onClick={onRetry}>
        {t("write.check.retry")}
      </Button>
    </p>
  )
}
```

Check `ProjectDetail` field names against `shared/api.ts` (`name`, `timelineSegmentCount`, `versionTested`, `capcutVersion`) and `RoomRead` is exported from `room/ClipRoom.tsx`; both are as of 0.4.3.

- [ ] **Step 7: Styles**

In `styles/edit.css` add, keeping the bar on one line at a 900 px window:

```css
.write-reason { max-width: 18rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.85rem; }
.write-notes { margin-top: 0.75rem; }
.read-failed { display: flex; align-items: center; gap: 0.75rem; }
```

Reuse the existing `.write-list` rules; do not remove any write-page CSS in this task.

- [ ] **Step 8: Run the tests and the typecheck**

Run from the repo root: `npm test` and `npm run typecheck`. Expected: all green, typecheck clean.

---

### Task 2: Wire the button in and remove the write stage

**Why this task changed after Task 1:** the app's toolbar renders in `AppShell`'s `<header>`, outside `ClipRoom`'s provider. A button handed up through `onToolbar` cannot call `useClipRoom()`. So the bar gets a slot element, published through a context like `ToastStack`, and the post page portals its toolbar into it from inside the room. Portals keep their React context. The `toolbar` prop and `onToolbar` go away.

**Files:**
- Modify: `shell/AppShell.tsx`, `styles/shell.css`, `styles/base.css`, `screens/PostScreen.tsx`, `room/ClipRoom.tsx`, `App.tsx`, `shell/StageChips.tsx`, `test/room.tsx`, `i18n.ts`, `styles/edit.css`
- Modify tests: `shell/shell.test.tsx`, `screens/PostScreen.test.tsx`, `room/ClipRoom.test.tsx`, `edit/WriteButton.test.tsx`, and any App or i18n test the compiler or a run flags
- Move to the Trash: `screens/WriteScreen.tsx`, `screens/WriteScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

1. `shell.test.tsx`: the stage bar has three chips, named เตรียม · โครงเรื่อง · โพสต์โปรดักชัน in that order. No chip is named `เขียนลง CapCut`.
2. `shell.test.tsx`: a child of `AppShell` that portals a button into `useContext(ToolbarSlot)` shows that button inside `header.topbar`, after the stage chips and before the backup menu and the settings button.
3. `PostScreen.test.tsx`: inside `.topbar` the AI menu comes first, then the write button (`t("timeline.write")`). There is no `t("post.goWrite")` button anywhere. Clicking the toolbar's write button opens the sheet, and "เขียนเลย" writes (one end-to-end test through the real post page).
4. `PostScreen.test.tsx`: a failed read shows its notice with "ลองอีกครั้ง" at the top of the post page, and the retry reads it again (one test, for the cut).
5. `ClipRoom.test.tsx`: a write that ends is told by a toast with `toldMessage(result)`. A result with a dropped kind, lost zooms or Pro items left out shows those phrases, and the toast stays `ACTION_TOAST_MS` (fake timers: still there after 5 s, gone after 12 s).
6. `ClipRoom.test.tsx`: a write of the room's own that fails shows the toast `t("write.failed", { message })` for `ACTION_TOAST_MS`. The button is back to `t("timeline.write")`, and no notice on the page carries the message.
7. `ClipRoom.test.tsx`: a followed write (events only) that fails does the same as test 6.
8. Port the old write page's room tests that are still true: a write survives going to the outline and back (the room opened again follows it); the end is told once; a restore clears the "written" state, so the button reads `t("timeline.write")` again.

Run the touched test files. Expected: FAIL.

- [ ] **Step 2: The toolbar slot in `AppShell.tsx`**

```tsx
/**
 * Where a stage puts the buttons it owns, on the right of the bar. The stage portals them here from
 * inside its own providers, so they read the same context as the page they belong to.
 */
export const ToolbarSlot = createContext<HTMLElement | null>(null)
```

- In `AppShell`, add `const [slot, setSlot] = useState<HTMLDivElement | null>(null)`.
- Replace `{toolbar}` with `<div className="toolbar-slot" ref={setSlot} />`.
- Wrap everything inside `ToastStack.Provider` in `<ToolbarSlot.Provider value={slot}>`.
- Remove the `toolbar` prop and its doc comment.
- In `styles/shell.css` add `.toolbar-slot { display: contents; }`, so its children sit in the bar's flex row as `{toolbar}` did.
- In `styles/base.css` give `.veil` `-webkit-app-region: no-drag`. The sheet now renders inside the bar's drag region, and Electron's drag regions ignore what sits on top, so without it the backdrop over the bar would drag the window instead of closing the sheet.

- [ ] **Step 3: `PostScreen.tsx`**
  - Remove the `onToolbar` and `onGoWrite` props, and the effect that called `onToolbar`.
  - Build the AI menu's `items` during render, with the same entries and reasons as before.
  - Read `const slot = useContext(ToolbarSlot)`. At the end of the returned section render `{slot && createPortal(<><AiMenu items={items} running={run.running ? t("post.planRunning") : null} onStop={() => void api.cancelAi()} /><WriteButton /></>, slot)}`.
  - Put `<FailedReads />` first inside `.edit-main`, above `room.error`.

- [ ] **Step 4: `ClipRoom.tsx`**
  - Remove the `page` prop, `pageNow` and every branch on it. `ended` always sets `told`.
  - `runWrite` starts with `if (ownWrite.current) return`, so a second activation in the same tick cannot start a second write or turn the running one idle. Test it with two clicks on "เขียนเลย" inside one `act`: `writeTimeline` is called once.
  - The toast is `<Toast message={toldMessage(told)} ms={toldIsLong(told) ? ACTION_TOAST_MS : undefined} … />`.
  - Add `writeFailed: string | null` state. `runWrite`'s catch and the followed write's "failed" event set it instead of calling `setError`, and set the write to idle. It renders `<Toast message={t("write.failed", { message: writeFailed })} ms={ACTION_TOAST_MS} onDone={() => setWriteFailed(null)} />`.
  - Update the doc comments that name "the write page" to name the post page's write button.

- [ ] **Step 5: `App.tsx`, `StageChips.tsx` and `test/room.tsx`**
  - `Stage` is `"prepare" | "outline" | "post"`. `STAGES` and `LABELS` lose "write".
  - `App.tsx`:
    - Remove the `"write"` screen, `goWrite`, and the `write` entries of `stageOf`, `reachable` and `onStage`.
    - Remove the `WriteScreen` branch, the `toolbar` state and the `toolbar` prop passed to `AppShell`.
    - `ClipRoom` renders only for `screen.name === "post"`, and gets no `page`.
    - `storedChanged` checks the post screen only.
    - Update the comments that mention the write page.
  - `test/room.tsx`:
    - The host holds a slot element in state. It renders `<ToolbarSlot.Provider value={slot}><div className="topbar" ref={setSlot} /><ClipRoom …><PostScreen onEditOutline={…} />{options.extra}</ClipRoom></ToolbarSlot.Provider>`.
    - Remove `Page`, the `page` option, `go`, `onToolbar` and the `WriteScreen` import. Keep `setCapcutRunning`.
    - A restore can no longer be clicked on a write page. If a test needs one, bump the room's `draftVersion` through a new `restore()` on the return value, as the app does after a restore from the backup menu.
    - Fix the tests that used `page: "write"` or `room.go(...)` by moving what they checked to the post page.
  - `WriteButton.test.tsx`: use the toolbar's button (query within `.topbar`) and the page's `FailedReads` instead of a second copy mounted through `extra`. Then remove the `extra` option if nothing else uses it.

- [ ] **Step 6: Remove the page**

```bash
mv "apps/desktop/src/renderer/src/screens/WriteScreen.tsx" ~/.Trash/WriteScreen-0930.tsx
mv "apps/desktop/src/renderer/src/screens/WriteScreen.test.tsx" ~/.Trash/WriteScreen-0930.test.tsx
```

Before moving the test file, check that every behaviour it tested is covered by Task 1's tests or this task's. In your report, list the ones that are not true any more: the page's cards, the result card, and the backup list on the page.

- [ ] **Step 7: i18n and CSS**
  - Remove the keys nothing uses any more. Find them by searching `apps/desktop/src` for each `write.*`, `stage.write` and `post.goWrite` key.
    - Expected to go: `stage.write`, `post.goWrite`, `write.summaryTitle`, `write.checksTitle`, `write.resultTitle`, `write.check.ok`, `write.check.wait`, `write.check.warn`, `write.check.fail`, `write.check.going`, `write.result`, `write.resultText`, `write.resultEmphasis`, `write.resultSkipped`, `write.backupsTitle`.
    - Keep any key that a search still finds.
  - Remove the CSS rules only the write page used: `.write-page`, `.write-check`, `.write-checks`, `.write-action`, `.write-told`, `.write-backups`, `.check-retry`, `.check-note`, and the write page's `.screen.write` rules. Keep `.write-list`.

- [ ] **Step 8: Run everything**

Run from the repo root: `npm test` and `npm run typecheck`. Expected: all green and typecheck clean. Then search `apps/desktop/src` for `WriteScreen`, `goWrite`, `onToolbar`, `toolbar=`, a `"write"` stage, and a `page` prop on `ClipRoom`. Expected: nothing.

---

### Task 3: Version and docs

- [ ] **Step 1:** `apps/desktop/package.json` version `0.4.4`.
- [ ] **Step 2:** In `docs/specs/2026-09-17-capcut-timeline-manager-design.md`, after the 0.4.3 bullet, add a Thai 0.4.4 bullet: the write stage is gone, the post page's top bar has the write button with a confirm sheet, the stage bar has three chips, see the M25 spec §14 "0.4.4". The controller adds the test counts and mutation results after Task 4.
- [ ] **Step 3:** In the M25 spec §2's table, mark the rows "แถบขั้น" and "หน้าเขียน" as replaced in 0.4.4.
- [ ] **Step 4:** `npm test` and `npm run typecheck` green.

### Task 4 (controller): Mutation checks, the DMG and the live test

- Mutation checks on `writeHold.ts` (each hold removed or reordered), `WriteBar.tsx` (`doneNotes` conditions), `WriteButton.tsx` (the `canWrite` gate on both buttons, `setAsking(false)` on cancel), `ClipRoom.tsx` (`toldIsLong` use, failure toast), `StageChips.tsx` (the list). Every mutant must fail a test.
- `npm run dist` in `apps/desktop` gives `release/boxblack-0.4.4-arm64.dmg`.
- Live test on draft 0917 with a test profile: back up 0917 first. Check the three chips; the button's reason while CapCut is open; the sheet's summary; one write; the toast; restore from the backup menu; the window at 900 px with the reason showing. Restore 0917 and compare it with the backup.
