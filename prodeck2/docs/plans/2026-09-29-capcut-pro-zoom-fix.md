# 0.4.2: Zoom Timing and the "มี CapCut Pro" Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zooms land when the app meant them to, and a user without CapCut Pro never gets a draft that CapCut refuses to export — without losing anything the user chose.

**Architecture:**
- The zoom writer converts each keyframe time from "µs into the piece" to "µs into the piece's source file", because that is what CapCut reads. It is one private helper in `core/capcut/zoom.ts`.
- A new top-level setting, `capcut.pro` (default off), gates the two kinds of CapCut resources that may need Pro: exit text animations and sounds that did not come with the app.
- The gate runs where things are shown and where they are written. It never runs where they are stored, so turning Pro on later brings everything back.

**Tech Stack:**
- TypeScript on Node 26 (native TS), vitest, Electron main + React 19 renderer.
- No git. Here "commit" means `npm test` is green and `npm run typecheck` is clean.
- Each task starts with a code snapshot taken by the controller.

**Spec:** `docs/specs/2026-09-29-capcut-pro-zoom-fix-design.md` (Thai). Read §1 for the evidence and §4.3 for the rules of the gate.

**Ground rules for every task:**
- Work from the repo root `/Users/ford/Desktop/Thalent Ai/excp/prodeck2`.
- Run one file's tests with `npx vitest run <path>`, all tests with `npm test`, and types with `npm run typecheck`.
- Write code comments and docs in English in the style of the file around them (Thai only in UI strings and the Thai spec).
- Never touch `~/Movies`, `~/Library`, or any CapCut draft; the controller runs the live test.
- Snapshots and mutation checks are the controller's job, not the implementer's.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `packages/core/src/capcut/zoom.ts` (+ `zoom.test.ts`) | keyframe times in source time | 1 |
| `packages/core/src/capcut/types.ts` | `KeyframePoint` doc | 1 |
| `packages/core/src/flair/catalogue.ts` (+ test) | exit `pro` flags, `exitsFor`, `usableExit` | 2 |
| `packages/core/src/flair/index.ts` | re-exports | 2 |
| `packages/core/src/highlights/styles.ts` (+ test) | "in" animation `pro: false` | 2 |
| `packages/core/src/flair/sound-catalogue.ts` (+ test) | `soundNeedsPro`, `usableSounds` | 2 |
| `packages/core/src/flair/plan.ts` (+ test) | `enforce(…, pro)` | 2 |
| `packages/core/src/highlights/pick.ts` (+ test) | Claude sees only usable exits | 2 |
| `apps/desktop/src/main/settings.ts` (+ test), `settings-api.ts` (+ test) | `capcut.pro` | 3 |
| `apps/desktop/src/shared/api.ts` | `SettingsPatch`, `SettingsView`, preview + write result fields | 3, 4, 5 |
| `apps/desktop/src/renderer/src/screens/SettingsScreen.tsx` (+ test), `i18n.ts` | the switch | 3 |
| `apps/desktop/src/main/highlight-state.ts` (+ test) | `looksInForce(…, pro)`, `heldExits` | 4 |
| `apps/desktop/src/main/highlights.ts` (+ test) | preview/pick read the setting; `exits`, `heldExit`, `proLeftOut` | 4, 5 |
| `apps/desktop/src/main/timeline.ts` (+ test) | write gates exits and sounds; `WriteResult.proLeftOut` | 4, 5 |
| `apps/desktop/src/main/timeline-fixture.ts` | test harness turns Pro on by default | 4 |
| `apps/desktop/src/main/sound-cues.ts` (+ test) | `cuesInForce` counts gated sounds apart | 5 |
| `apps/desktop/src/main/flair.ts` (+ tests), `index.ts` | Claude's sound list gated; `FlairDeps.pro` | 5 |
| `apps/desktop/src/renderer/src/edit/LookPopover.tsx`, `HighlightTab.tsx`, `GraphicsTab.tsx`, `FlairTab.tsx`, `screens/WriteScreen.tsx`, `i18n.ts`, `test/fake-api.ts` (+ tests) | UI | 6 |
| docs, `apps/desktop/package.json` | release notes, 0.4.2 | 7 |

---

### Task 1: Keyframes in source time

**Files:**
- Modify: `packages/core/src/capcut/zoom.ts` (the `addZooms` body around :90-103, plus a new helper)
- Modify: `packages/core/src/capcut/types.ts:13` (doc of `KeyframePoint`)
- Test: `packages/core/src/capcut/zoom.test.ts`
- Test: `apps/desktop/src/main/flair.test.ts` (~:423)
- Test: `apps/desktop/src/main/flair-plan.test.ts` (~:952)

- [ ] **Step 1: Write the failing tests.**

  In `zoom.test.ts`, change the drift test's expectation, because piece 1 plays its file from 10 s:

```ts
test("a drift runs from the start of its piece to the end", async () => {
  const out = addZooms(await roughCut(), [drift]).info
  const segment = out.tracks[0]!.segments[1]!
  // piece 1 plays its file from 10 s, and CapCut times keyframes in the file
  expect(of(segment, "KFTypeScaleX").keyframe_list.map((entry) => [entry.time_offset, entry.values[0]])).toEqual([
    [10_000_000, 1],
    [15_000_000, 1.08],
  ])
  expect(of(segment, "KFTypePositionY").keyframe_list.map((entry) => entry.values[0])).toEqual([0, -0.2 * (1 - 1.08)])
  // the piece that was not asked for is left alone
  expect(out.tracks[0]!.segments[0]!.common_keyframes).toEqual([])
})
```

  Then add two tests to the same file:

```ts
test("keyframes are timed in the piece's source file, where CapCut reads them", async () => {
  // piece 1 plays its file from 10 s: a punch 1 s into the piece lands 11 s into the file
  const out = addZooms(await roughCut(), [{ ...punch, cut: 1, durationUs: 5_000_000 }]).info
  const scale = of(out.tracks[0]!.segments[1]!, "KFTypeScaleX")
  expect(scale.keyframe_list.map((entry) => entry.time_offset)).toEqual([10_000_000, 11_000_000, 11_350_000])
  // every property keyframes on the same moments
  for (const property of ["KFTypePositionX", "KFTypePositionY"]) {
    expect(of(out.tracks[0]!.segments[1]!, property).keyframe_list.map((entry) => entry.time_offset)).toEqual([10_000_000, 11_000_000, 11_350_000])
  }
})

test("a piece played faster goes through its file faster, and so do its keyframes", async () => {
  const info = await roughCut()
  info.tracks[0]!.segments[1]!.speed = 2
  const out = addZooms(info, [{ ...punch, cut: 1, durationUs: 5_000_000 }]).info
  expect(of(out.tracks[0]!.segments[1]!, "KFTypeScaleX").keyframe_list.map((entry) => entry.time_offset)).toEqual([10_000_000, 12_000_000, 12_700_000])
})
```

  In `apps/desktop/src/main/flair.test.ts` (~:423), the expected punch time now includes the piece's source start:

```ts
  expect(scale.keyframe_list[1]!.time_offset).toBe(keyframed[0]!.source_timerange!.start + (preview.groups[0]!.lines[0]!.startUs - preview.pieces[0]!.atUs))
```

  In `apps/desktop/src/main/flair-plan.test.ts` (~:952), turn the source-time offset back into time within the piece before comparing it with the sound:

```ts
  // keyframes are timed in the piece's source file: less its source start, the offset is time into the piece
  const offset = piece!.common_keyframes!.find((entry) => entry.property_type === "KFTypeScaleX")!.keyframe_list.findLast((entry) => entry.values[0] === 1)!.time_offset - piece!.source_timerange!.start
```

- [ ] **Step 2: Run the tests and see them fail.**

  Run: `npx vitest run packages/core/src/capcut/zoom.test.ts apps/desktop/src/main/flair.test.ts apps/desktop/src/main/flair-plan.test.ts`

  Expected: the drift test, the two new tests and the two main tests FAIL, because the offsets are still counted from the piece start.

- [ ] **Step 3: Implement.**

  In `zoom.ts`, add above `addZooms`:

```ts
/**
 * Where a moment `atUs` into a piece is in the piece's source file: CapCut 9.5 times a video segment's
 * keyframes by its source, not by the segment's start (two exports of 0917, 2026-09-29: a punch written 3.145 s
 * into a piece whose file starts at 1.8 s landed 1.35 s into it, and pieces starting later in their file stayed
 * zoomed throughout). A piece played faster goes through its file faster.
 */
function sourceTime(segment: Segment, atUs: number): number {
  const speed = typeof segment.speed === "number" && segment.speed > 0 ? segment.speed : 1
  return (segment.source_timerange?.start ?? 0) + Math.round(atUs * speed)
}
```

  In `addZooms`, time every point with it; the three `frames.map` calls become:

```ts
    segment.common_keyframes = [
      track(
        "KFTypeScaleX",
        frames.map((frame) => point(sourceTime(segment, frame.at), base * frame.scale)),
      ),
      track(
        "KFTypePositionX",
        frames.map((frame) => point(sourceTime(segment, frame.at), baseX)),
      ),
      track(
        "KFTypePositionY",
        frames.map((frame) => point(sourceTime(segment, frame.at), shift(frame.scale))),
      ),
    ]
```

  Add a sentence to `addZooms`'s doc: "Each keyframe is timed in the piece's source file (`sourceTime`), which is how CapCut reads them."

  In `types.ts:13`, the doc becomes:

```ts
/** One point of a keyframed property: its value at `time_offset` µs into the segment's source file — CapCut times a video segment's keyframes by its source, not by the segment's start. */
```

- [ ] **Step 4: Run the tests and see them pass.**

  Run: `npx vitest run packages/core/src/capcut/zoom.test.ts apps/desktop/src/main/flair.test.ts apps/desktop/src/main/flair-plan.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit.** Run `npm test` and `npm run typecheck`. Both must be clean.

---

### Task 2: Pro flags and the core rules

**Files:**
- Modify: `packages/core/src/flair/catalogue.ts:58-73`
- Modify: `packages/core/src/flair/index.ts` (re-export `exitsFor`, `usableExit`)
- Modify: `packages/core/src/highlights/styles.ts:50-58`
- Modify: `packages/core/src/flair/sound-catalogue.ts`
- Modify: `packages/core/src/flair/plan.ts:47-76`
- Modify: `packages/core/src/highlights/pick.ts` (`describe` ~:303-326, `acceptHighlights` ~:172-284, `pickHighlights` ~:329-355)
- Test: `catalogue.test.ts`, `styles.test.ts`, `sound-catalogue.test.ts`, `plan.test.ts`, `pick.test.ts` next to those files

- [ ] **Step 1: Write the failing tests.**

  `packages/core/src/flair/catalogue.test.ts`:

```ts
import { EXIT_ANIMATIONS, exitsFor, usableExit } from "./catalogue.ts"

describe("which exit animations need CapCut Pro", () => {
  it("marks หมุนหายไป Pro by CapCut's own data, the three not in any cache Pro until checked, and อัลเทอร์เนตเฟด free", () => {
    expect(Object.fromEntries(EXIT_ANIMATIONS.map((exit) => [exit.id, exit.pro]))).toEqual({
      "fade-out": true,
      "fade-dim": true,
      "fade-alt": false,
      "spin-out": true,
      "burst-out": true,
    })
  })

  it("offers only the free ones without Pro, and every one with it", () => {
    expect(exitsFor(false).map((exit) => exit.id)).toEqual(["fade-alt"])
    expect(exitsFor(true).map((exit) => exit.id)).toEqual(EXIT_ANIMATIONS.map((exit) => exit.id))
  })

  it("lets an exit through only when it exists and the user may have it", () => {
    expect(usableExit("spin-out", false)).toBeNull()
    expect(usableExit("spin-out", true)).toBe("spin-out")
    expect(usableExit("fade-alt", false)).toBe("fade-alt")
    expect(usableExit("made-up", true)).toBeNull()
    expect(usableExit(null, true)).toBeNull()
  })
})
```

  (Import `describe`, `it` and `expect` from vitest the way the file already does.)

  `packages/core/src/highlights/styles.test.ts`:

```ts
it("never needs CapCut Pro for a style's entrance animation", () => {
  for (const style of Object.values(HIGHLIGHT_STYLES)) expect(style.animation.pro).toBe(false)
})
```

  `packages/core/src/flair/sound-catalogue.test.ts`:

```ts
import { BUILT_IN_SOUNDS, soundNeedsPro, usableSounds } from "./sound-catalogue.ts"

it("counts only the built-in sounds as free: any other one may be Pro", () => {
  expect(soundNeedsPro(BUILT_IN_SOUNDS[0]!.effectId)).toBe(false)
  expect(soundNeedsPro("123")).toBe(true)
  const mine = { effectId: "123", name: "from a draft", durationUs: 1_000_000, path: null }
  expect(usableSounds([BUILT_IN_SOUNDS[0]!, mine], false)).toEqual([BUILT_IN_SOUNDS[0]])
  expect(usableSounds([BUILT_IN_SOUNDS[0]!, mine], true)).toEqual([BUILT_IN_SOUNDS[0], mine])
})
```

  `packages/core/src/flair/plan.test.ts`: the test "keeps every exit the catalogue has, the loudest included: no level gates one" now passes Pro, and a new test covers the gate:

```ts
  it("keeps every exit the catalogue has with CapCut Pro, the loudest included: no level gates one", () => {
    const looks = enforce([look({ exit: "fade-out" }), look({ exit: "burst-out" })], [group("ลดครึ่งราคา"), group("วันนี้เท่านั้น")], false, true)
    expect(looks.map((entry) => entry.exit)).toEqual(["fade-out", "burst-out"])
  })

  it("without CapCut Pro drops an exit that needs it, even one set by hand, and keeps a free one", () => {
    const looks = enforce([look({ exit: "spin-out" }), look({ exit: "spin-out", edited: true }), look({ exit: "fade-alt" })], [group("ก"), group("ข"), group("ค")], false, false)
    expect(looks.map((entry) => entry.exit)).toEqual([null, null, "fade-alt"])
  })
```

  `packages/core/src/highlights/pick.test.ts`:
  - In "each group's look comes with it…", change the answer's exit from `"fade-out"` to `"fade-alt"`, and the expected `exit` to match.
  - Add tests that use the file's `fakeTransport` and `textOf`, as the tests near :265 do:

```ts
test("Claude is offered only the exits the user may have: the free one without CapCut Pro, all five with it", async () => {
  for (const [pro, listed, left] of [
    [false, ["- fade-alt: "], ["- spin-out: ", "- fade-out: ", "- burst-out: "]],
    [true, ["- fade-alt: ", "- spin-out: ", "- fade-out: ", "- burst-out: ", "- fade-dim: "], []],
  ] as const) {
    const { transport, requests } = fakeTransport({ style: "bold-white", groups: [] })
    await pickHighlights({ transport, model: "m", brief: BRIEF, durationUs: 10_000_000, points, wordsOf, maxChars: 12, newId: ids(), pro })
    const text = textOf(requests[0]!.content)
    for (const line of listed) expect(text).toContain(line)
    for (const line of left) expect(text).not.toContain(line)
  }
})

test("an exit Claude answers that needs Pro the user does not have is left off and counted", () => {
  const answer = group(2, [["ราคาเริ่มต้น"]], { exit: "spin-out" })
  expect(accept([answer])).toMatchObject({ dropped: 1, looks: { h1: { exit: null } } })
  expect(acceptPro([answer])).toMatchObject({ dropped: 0, looks: { h1: { exit: "spin-out" } } })
})
```

  - Use the names this file already has for the brief, points, words and ids (`BRIEF`, `points`, `wordsOf`, `ids()` stand for them here). Define `acceptPro` next to `accept`: the same call with `pro: true`.
  - `accept` stays Pro-off.

- [ ] **Step 2: Run the tests and see them fail.**

  Run: `npx vitest run packages/core/src/flair packages/core/src/highlights`

  Expected: FAIL (`pro`, `exitsFor`, `usableExit`, `soundNeedsPro` and `usableSounds` don't exist yet).

- [ ] **Step 3: Implement.**

  In `catalogue.ts`, give `ExitAnimation` a flag and add the two helpers:

```ts
export interface ExitAnimation {
  id: string
  /** shown to the user */
  name: string
  /** what CapCut downloads it by */
  resourceId: string
  /**
   * needs CapCut Pro to export. หมุนหายไป is Pro by CapCut's own cached panel data (paid_type "subscribe", its
   * export needs the Pro package; read 2026-09-29). จางหายหลอน ๆ, จางหายหม่นหมอง and แตกกระจาย were in no cache
   * on the machine, so they count as Pro until someone checks (the user's decision, 2026-09-29). อัลเทอร์เนตเฟด
   * is free by the same data.
   */
  pro: boolean
}
export const EXIT_ANIMATIONS: ExitAnimation[] = [
  { id: "fade-out", name: "จางหายหลอน ๆ", resourceId: "7644574121141062913", pro: true },
  { id: "fade-dim", name: "จางหายหม่นหมอง", resourceId: "7648937969314843924", pro: true },
  { id: "fade-alt", name: "อัลเทอร์เนตเฟด", resourceId: "7646374090143567112", pro: false },
  { id: "spin-out", name: "หมุนหายไป", resourceId: "7664531039884152084", pro: true },
  { id: "burst-out", name: "แตกกระจาย", resourceId: "7667414562756562183", pro: true },
]

export const exitById = (id: string): ExitAnimation | undefined => EXIT_ANIMATIONS.find((animation) => animation.id === id)

/** The exits a user may have: every one with CapCut Pro, the free ones without. */
export const exitsFor = (pro: boolean): ExitAnimation[] => EXIT_ANIMATIONS.filter((animation) => pro || !animation.pro)

/** An exit as it may be written: known, and free unless the user has CapCut Pro; null otherwise. */
export const usableExit = (id: string | null, pro: boolean): string | null => {
  const animation = id === null ? undefined : exitById(id)
  return animation !== undefined && (pro || !animation.pro) ? animation.id : null
}
```

  - In `flair/index.ts`, add `exitsFor` and `usableExit` next to `exitById` in the re-export list.

  In `styles.ts`, flag the entrance animations:

```ts
/** A CapCut "in" text animation, named by its resource id; CapCut downloads it when its cache lacks it. */
export interface HighlightAnimation {
  resourceId: string
  name: string
  /** needs CapCut Pro to export: none of the styles' does, by CapCut's cached panel data (2026-09-29) */
  pro: boolean
}

/** Animations CapCut 9.4 played from an id alone. Older ids ("สปริง" 7179946712943825410) did not. */
const POP_UP: HighlightAnimation = { resourceId: "7664531520492686613", name: "รวมแบบป๊อปอัป", pro: false }
const DROP_IN: HighlightAnimation = { resourceId: "7664533258335440148", name: "ร่วงเร็ว", pro: false }
const CURTAIN_UP: HighlightAnimation = { resourceId: "7643711191419833618", name: "ดึงม่านขึ้น", pro: false }
```

  In `sound-catalogue.ts`, below `BUILT_IN_SOUNDS`:

```ts
const BUILT_IN_IDS = new Set(BUILT_IN_SOUNDS.map((sound) => sound.effectId))

/**
 * Whether a sound needs CapCut Pro as far as the app can tell: the built-in ones are CapCut's free sounds; any
 * other sound was read from a draft on this machine and may be a Pro one, so it counts as Pro (spec 0.4.2 §4.2).
 */
export const soundNeedsPro = (effectId: string): boolean => !BUILT_IN_IDS.has(effectId)

/** The sounds a user may put in a draft: every one with CapCut Pro, the built-in ones without. */
export const usableSounds = <T extends { effectId: string }>(sounds: T[], pro: boolean): T[] => (pro ? sounds : sounds.filter((sound) => !soundNeedsPro(sound.effectId)))
```

  In `plan.ts`, `enforce` takes the flag. Its doc gains "…an accent or exit that does not exist — or an exit that needs CapCut Pro the user does not have — is dropped…".

```ts
import { TEXT_PATTERNS_BY_ID, usableExit, type TextPattern } from "./catalogue.ts"
// …
export function enforce(looks: GroupLook[], groups: { lines: string[] }[], landscape = false, pro = false): GroupLook[] {
  // …unchanged down to the exit…
    const exit = usableExit(look.exit, pro)
```

  In `pick.ts`:
  - `describe` takes `pro: boolean` and lists `exitsFor(pro)`:

```ts
    "แอนิเมชันตอนข้อความหายไป",
    ...(exitsFor(args.pro).length > 0 ? exitsFor(args.pro).map((exit) => `- ${exit.id}: ${exit.name}`) : ["- (ไม่มีให้เลือก ให้ตอบค่าว่าง)"]),
```

  - `acceptHighlights` takes `pro?: boolean` and passes `args.pro ?? false` as `enforce`'s fourth argument. The existing `dropped++` for a refused exit covers the count.
  - `pickHighlights` takes `pro?: boolean` ("the user has CapCut Pro: exits that need it are offered; off when not given"). It passes `pro: args.pro ?? false` to both `describe` and `acceptHighlights`.
  - Import `exitsFor` instead of `EXIT_ANIMATIONS`.

  **Keep main as 0.4.1 until Task 4.** These two explicit `true`s keep every task green, and Task 4 replaces them with the user's setting:
  - In `apps/desktop/src/main/highlight-state.ts`, `looksInForce` passes `true` as `enforce`'s fourth argument, with a comment "every exit, as before 0.4.2, until the setting reaches here".
  - In `apps/desktop/src/main/highlights.ts`, `pick()` passes `pro: true` to `pickHighlights`, with the same comment.

- [ ] **Step 4: Run the tests and see them pass.**

  Run: `npx vitest run packages/core`

  Expected: PASS. A core test elsewhere may break because it used a Pro exit with the new default. If so, give it `pro: true` or `fade-alt`, whichever keeps what it tests.

- [ ] **Step 5: Commit.** `npm test` and `npm run typecheck`, both fully green.

---

### Task 3: The setting

**Files:**
- Modify: `apps/desktop/src/main/settings.ts` (`AppSettings` :12, `SettingsPatch` :24, `DEFAULT_SETTINGS` :35, `read` :90-131, `update` :133-149)
- Modify: `apps/desktop/src/shared/api.ts` (`SettingsPatch` :117-126, `SettingsView` :310-343)
- Check: `apps/desktop/src/main/settings-api.ts:57-87` passes the field through
- Modify: `apps/desktop/src/renderer/src/screens/SettingsScreen.tsx` (General tab :424-453)
- Modify: `apps/desktop/src/renderer/src/i18n.ts` (next to `settings.appearance`)
- Modify: `apps/desktop/src/renderer/test/fake-api.ts:57-85`
- Test: `apps/desktop/src/main/settings.test.ts`, `settings-api.test.ts`, the renderer's settings screen test

- [ ] **Step 1: Write the failing tests.**

  In `settings.test.ts`:
  - Every whole-object expectation (around :21-33, :60-68, :127, :144) gains `capcut: { pro: false }`.
  - Add:

```ts
test("remembers whether the user has CapCut Pro, off unless they said so", async () => {
  const store = new SettingsStore(join(await tempDir(), "settings.json"))
  expect((await store.read()).capcut).toEqual({ pro: false })
  await store.update({ capcut: { pro: true } })
  expect((await store.read()).capcut).toEqual({ pro: true })
  // another section's change keeps it
  await store.update({ appearance: "dark" })
  expect((await store.read()).capcut).toEqual({ pro: true })
})

test("reads anything but true or false as no CapCut Pro", async () => {
  const file = join(await tempDir(), "settings.json")
  await writeFile(file, JSON.stringify({ capcut: { pro: "yes" } }))
  expect((await new SettingsStore(file).read()).capcut).toEqual({ pro: false })
})
```

  (Use the helpers this test file already uses for temporary folders.)

  In `settings-api.test.ts`, the whole-object expectations (around :64-72, :121-129) gain `capcut: { pro: false }`.

  In the renderer's settings screen test (find the one that renders `SettingsScreen` with the fake API):

```ts
test("the General tab turns CapCut Pro on", async () => {
  // render the screen as the other tests in this file do, then:
  await user.click(screen.getByRole("switch", { name: /มี CapCut Pro/ }))
  expect(api.updateSettings).toHaveBeenCalledWith({ capcut: { pro: true } })
})
```

  (Follow how that file already fakes `updateSettings` and reaches the General tab.)

- [ ] **Step 2: Run them and see them fail.**

  Run: `npx vitest run apps/desktop/src/main/settings.test.ts apps/desktop/src/main/settings-api.test.ts apps/desktop/src/renderer`

  Expected: FAIL.

- [ ] **Step 3: Implement.**

  In `main/settings.ts`:

```ts
export interface AppSettings {
  // …existing fields…
  appearance: Appearance
  /** what the user's CapCut account has: without Pro the app puts nothing in a draft that needs it (spec 0.4.2) */
  capcut: { pro: boolean }
}

export type SettingsPatch = {
  // …existing fields…
  appearance?: Appearance
  capcut?: Partial<AppSettings["capcut"]>
}

export const DEFAULT_SETTINGS: AppSettings = {
  // …existing fields…
  appearance: "system",
  capcut: { pro: false },
}
```

  - In `read()`, add after `appearance`: `capcut: { pro: flag(raw.capcut?.pro, DEFAULT_SETTINGS.capcut.pro) },`
  - In `update()`, add after `appearance`: `capcut: { ...current.capcut, ...patch.capcut },`. This is needed because `update` rebuilds the object from the sections it knows and would drop the new one otherwise.

  In `shared/api.ts`:
  - `SettingsPatch` gains `capcut?: { pro?: boolean }`.
  - `SettingsView` gains:

```ts
  /** the user has CapCut Pro: without it nothing that needs Pro goes into a draft */
  capcut: { pro: boolean }
```

  - Check that `getSettings` in `settings-api.ts` spreads the whole settings object, so the field reaches the view. If it lists fields instead, add `capcut`.

  In `fake-api.ts` `settingsView()`, add `capcut: { pro: false },` after `appearance`.

  In `i18n.ts`, add next to the appearance keys:

```ts
  "settings.capcutPro": "มี CapCut Pro",
  "settings.capcutProHint": "เปิดเมื่อบัญชี CapCut ของคุณเป็น Pro · ถ้าปิด แอปจะไม่ใส่ของที่ต้องใช้ Pro เพื่อให้ export ได้โดยไม่ต้องสมัคร",
```

  In `SettingsScreen.tsx`, import `Switch` from `../ui/Switch.tsx`. Put this row right after the appearance `RowCard` in the General tab:

```tsx
                  <RowCard>
                    <Switch
                      label={t("settings.capcutPro")}
                      hint={t("settings.capcutProHint")}
                      checked={view.capcut.pro}
                      onChange={(pro) => void update({ capcut: { pro } })}
                    />
                  </RowCard>
```

- [ ] **Step 4: Run them and see them pass.**

  Run: `npx vitest run apps/desktop/src/main/settings.test.ts apps/desktop/src/main/settings-api.test.ts apps/desktop/src/renderer`

  Expected: PASS.

- [ ] **Step 5: Commit.** `npm test` and `npm run typecheck`, both fully green.

---

### Task 4: Main — exit animations gated where shown and written

**Files:**
- Modify: `apps/desktop/src/main/highlight-state.ts:377-396` (`looksInForce` gains `pro`; new `heldExits`)
- Modify: `apps/desktop/src/main/highlights.ts` (`view` :153-231; `preview` :466-472; `pick` :492-559)
- Modify: `apps/desktop/src/main/timeline.ts` (write around :461-500, result :567-577)
- Modify: `apps/desktop/src/shared/api.ts` (`HighlightGroupView` :533-548, `HighlightPreview` :661-716, `WriteResult` :799-828)
- Modify: `apps/desktop/src/main/timeline-fixture.ts:~110` (the harness turns Pro on)
- Modify: `apps/desktop/src/renderer/test/fake-api.ts` (preview :~250-265 and write result :~355 fixtures)
- Test: `highlight-state.test.ts`, `highlights.test.ts`, `timeline.test.ts` (or whichever main test file already exercises `service.write` with highlight looks)

- [ ] **Step 1: Turn Pro on in the shared harness.**

  The tests before 0.4.2 were written for an app that used every CapCut resource. In `timeline-fixture.ts`, right after `const settings = new SettingsStore(…)`:

```ts
  // the tests before 0.4.2 were written for an app that used every CapCut resource; the tests of the Pro gate turn it off
  await settings.update({ capcut: { pro: options.pro ?? true } })
```

  Add `pro?: boolean` to the fixture's options type with the doc `the user's CapCut Pro setting; on unless a test of the gate says otherwise`.

- [ ] **Step 2: Write the failing tests.**

  In `highlight-state.test.ts`:
  - The test near :476-478 that expects a Pro exit to show now passes `true` as `looksInForce`'s fifth argument.
  - Add:

```ts
test("without CapCut Pro a stored exit that needs it shows as none, and is named as held", () => {
  // build `stored` with one group whose look has exit "spin-out", and `groups` for it, the way the neighbouring tests do
  expect(looksInForce(stored, groups, FLAIR, null, false)[groupId]!.exit).toBeNull()
  expect(heldExits(stored, [groupId], FLAIR, false)).toEqual({ [groupId]: "spin-out" })
  // with Pro, or with the looks off, nothing is held
  expect(heldExits(stored, [groupId], FLAIR, true)).toEqual({})
  expect(heldExits(stored, [groupId], { ...FLAIR, text: false }, false)).toEqual({})
  // what is stored is untouched
  expect(stored.flair!.looks[groupId]!.exit).toBe("spin-out")
})
```

  In `highlights.test.ts`:
  - The test near :1051-1057 (a Pro exit in the preview) keeps working: the harness has Pro on.
  - Add a test that builds the harness with `pro: false`, stores `exit: "spin-out"` on a group's look (as the neighbouring tests store looks), and checks the preview:

```ts
  const preview = await h.highlights.preview(h.folder, DEFAULT_CUT_RULES, OPTIONS)
  const group = preview.groups.find((candidate) => candidate.id === groupId)!
  expect(group.look.exit).toBeNull()
  expect(group.heldExit).toEqual({ id: "spin-out", name: "หมุนหายไป" })
  expect(preview.exits).toEqual([{ id: "fade-alt", name: "อัลเทอร์เนตเฟด" }])
  expect(preview.proLeftOut.exits).toBe(1)
  expect((await h.outlines.get(h.folder))!.flair!.looks[groupId]!.exit).toBe("spin-out")
```

  - Add a pick test with `pro: false`: the request Claude gets lists `- fade-alt: ` and not `- spin-out: `. Use the harness's fake Claude and `textOf`, as the pick tests there already read requests.

  In the main test file that already writes highlight looks through `service.write`, add a Pro-off write test. Harness `pro: false`, one group stored with `exit: "spin-out"`:

```ts
  const result = await h.service.write(/* as the neighbouring write tests call it */)
  const info = await readInfo(h.folder)
  const ids = (info.materials.material_animations as { animations: { resource_id: string }[] }[]).flatMap((entry) => entry.animations.map((animation) => animation.resource_id))
  expect(ids).not.toContain("7664531039884152084")
  expect(result.proLeftOut).toEqual({ exits: 1, sounds: 0 })
  // and with Pro on, the same outline writes the exit
```

- [ ] **Step 3: Run them and see them fail.**

  Run: `npx vitest run apps/desktop/src/main/highlight-state.test.ts apps/desktop/src/main/highlights.test.ts apps/desktop/src/main/timeline.test.ts`

  Expected: FAIL.

- [ ] **Step 4: Implement.**

  In `highlight-state.ts`:

```ts
export function looksInForce(
  stored: StoredOutline,
  groups: { id: string; lines: ShownLine[] }[],
  flair: FlairOptions,
  canvas: { width: number; height: number } | null,
  /** the user has CapCut Pro: without it an exit that needs Pro shows and writes as none (it stays stored) */
  pro = false,
): Record<string, GroupLook> {
  if (!flair.text) return Object.fromEntries(groups.map((group) => [group.id, DEFAULT_LOOK]))
  const looks = stored.flair?.looks ?? {}
  const enforced = enforce(
    groups.map((group) => shownLook(looks[group.id] ?? DEFAULT_LOOK, group.lines)),
    groups.map((group) => ({ lines: group.lines.map((line) => line.text) })),
    isLandscape(canvas),
    pro,
  )
  return Object.fromEntries(groups.map((group, i) => [group.id, enforced[i]!]))
}

/**
 * The exits groups keep stored but that are not written because they need CapCut Pro the user does not have,
 * by group id: the look popover shows them as held, so an edit of the rest of the look keeps them, and the
 * write page counts them. None with Pro, or with the looks off (nothing's exit is written then anyway).
 */
export function heldExits(stored: StoredOutline, groupIds: string[], flair: FlairOptions, pro: boolean): Record<string, string> {
  if (pro || !flair.text) return {}
  const looks = stored.flair?.looks ?? {}
  return Object.fromEntries(
    groupIds.flatMap((id) => {
      const exit = looks[id]?.exit ?? null
      const animation = exit === null ? undefined : exitById(exit)
      return animation?.pro ? [[id, animation.id]] : []
    }),
  )
}
```

  (Import `exitById` from `@boxblack/core/flair/catalogue`.)

  In `shared/api.ts`:
  - `HighlightGroupView` gains:

```ts
  /** an exit the group keeps but that needs CapCut Pro, which the user does not have: not written, and shown so an edit of the rest of the look keeps it */
  heldExit?: { id: string; name: string }
```

  - `HighlightPreview` gains:

```ts
  /** the exit animations the look popover may offer: the free ones without CapCut Pro, every one with it */
  exits: { id: string; name: string }[]
  /** what is not written because it needs CapCut Pro, which the user does not have: groups' exits and sound effects */
  proLeftOut: { exits: number; sounds: number }
```

  - `WriteResult` gains the same `proLeftOut` field, documented "what was left out of the draft because it needs CapCut Pro, which the user does not have".

  In `highlights.ts`:
  - `view` takes `pro: boolean` right after `options`.
  - It builds looks with `looksInForce(stored, shownLines(timed), options.flair, canvas, pro)` and computes `const held = heldExits(stored, timed.map((group) => group.groupId), options.flair, pro)`.
  - Each group view gains `...(held[group.groupId] ? { heldExit: { id: held[group.groupId]!, name: exitById(held[group.groupId]!)!.name } } : {})`.
  - The preview gains `exits: exitsFor(pro).map(({ id, name }) => ({ id, name }))` and `proLeftOut: { exits: Object.keys(held).length, sounds: 0 }`. Task 5 fills in the sounds.
  - `preview()` and `pick()` read the flag with `const { pro } = (await deps.footage.settings.read()).capcut` and pass it to `view`.
  - `pick()` also passes `pro` to `pickHighlights`.
  - The other `looksInForce` callers (highlights.ts :251 and flair.ts :390) lay out graphics, where the exit plays no part. Leave them on the default.

  In `timeline.ts` `write`:
  - Read settings once where the style is chosen (`const settings = await deps.settings.read()`), and use `settings.highlights.custom` there.
  - Call `looksInForce(…, canvas, settings.capcut.pro)`.
  - Count `const heldCount = highlights.flair.text ? Object.keys(heldExits(stored, groups.map((group) => group.groupId), highlights.flair, settings.capcut.pro)).length : 0`, and declare it where the result can see it (0 when there are no highlights).
  - The result returns `proLeftOut: { exits: heldCount, sounds: 0 }`. Task 5 fills in the sounds.
  - The existing `exitById(look.exit)` line stays: `look.exit` is already gated.

  In `fake-api.ts`, the preview fixture gains `exits: EXIT_ANIMATIONS.map(({ id, name }) => ({ id, name }))`, which is every exit as with Pro, so renderer tests that pick one keep working, and `proLeftOut: { exits: 0, sounds: 0 }`. The write-result fixture gains `proLeftOut: { exits: 0, sounds: 0 }`.

- [ ] **Step 5: Run them and see them pass.**

  Run: `npx vitest run apps/desktop/src/main apps/desktop/src/renderer`

  Expected: PASS. The two temporary `true`s from Task 2 are gone: `looksInForce` gets the setting, and so does `pickHighlights`.

- [ ] **Step 6: Commit.** `npm test` and `npm run typecheck`, both fully green.

---

### Task 5: Main — sounds gated where shown, planned and written

**Files:**
- Modify: `apps/desktop/src/main/sound-cues.ts:201-237` (`cuesInForce`)
- Modify: `apps/desktop/src/main/highlights.ts` (`soundView` :324-363; `view` passes `pro`; `proLeftOut.sounds`)
- Modify: `apps/desktop/src/main/timeline.ts` (`soundCues` :327-355; write result)
- Modify: `apps/desktop/src/main/flair.ts` (`FlairDeps` :34-57, `planSounds` :450-509)
- Modify: `apps/desktop/src/main/index.ts:350-370` (wire `pro`)
- Modify: `apps/desktop/src/shared/api.ts` (`unusedSounds` :692)
- Modify: `apps/desktop/src/renderer/test/fake-api.ts` (`unusedSounds` fixture)
- Test: `sound-cues.test.ts`, `highlights.test.ts`, `flair-plan.test.ts`, `flair.test.ts`, `post-flow.test.ts`, the write test file of Task 4

- [ ] **Step 1: Write the failing tests.**

  In `sound-cues.test.ts`:

```ts
test("a sound that needs CapCut Pro is not placed, and is counted apart from one the machine does not have", () => {
  // as the neighbouring cuesInForce tests build cues, place and sounds: two cues, one on a built-in sound, one on "from-a-draft"
  const result = cuesInForce({ cues, place, sounds, flair: FLAIR, durationUs: 10_000_000, passes: () => true, needsPro: (effectId) => effectId === "from-a-draft" })
  expect(result.kept.map((placed) => placed.cue.effectId)).toEqual([BUILT_IN_ID])
  expect(result).toMatchObject({ missing: 0, pro: 1 })
})
```

  In `highlights.test.ts`, a harness with `pro: false` and a sound library that lists one built-in sound and one draft sound (`{ effectId: "from-a-draft", … }`), with a stored cue on each:

```ts
  const preview = await h.highlights.preview(h.folder, DEFAULT_CUT_RULES, OPTIONS)
  expect(preview.sounds.map((sound) => sound.effectId)).toEqual([BUILT_IN_ID])
  expect(preview.cues.map((cue) => cue.effectId)).toEqual([BUILT_IN_ID])
  expect(preview.unusedSounds).toMatchObject({ missing: 0, pro: 1 })
  expect(preview.proLeftOut.sounds).toBe(1)
  // the stored cue is untouched
  expect((await h.outlines.get(h.folder))!.flair!.cues!.some((cue) => cue.effectId === "from-a-draft")).toBe(true)
```

  In `flair-plan.test.ts`, with `pro: async () => false` on the service:
  - Claude's sound request lists only the built-in sounds: its text holds the built-in's `use` label and not the draft sound's name.
  - A cue the user set by hand on the draft sound survives a re-plan: `planSounds` does not delete it.

  In the write test file, write with `pro: false` and a stored cue on the draft sound. The draft's audio materials must not hold `from-a-draft`, and `result.proLeftOut.sounds` must be 1.

- [ ] **Step 2: Run them and see them fail.**

  Run: `npx vitest run apps/desktop/src/main`

  Expected: FAIL.

- [ ] **Step 3: Implement.**

  In `sound-cues.ts` `cuesInForce`:
  - The input gains `/** a sound the user may not use: it needs CapCut Pro, which they do not have; none when not given */ needsPro?: (effectId: string) => boolean`.
  - The result gains `pro: number`.
  - In the loop:

```ts
    if (!where) unplaced++
    else if (!sound) missing++
    else if (input.needsPro?.(sound.effectId)) pro++
    else if (!filled.has(where.atUs)) {
```

  - The early return with sound off gains `pro: 0`.
  - The doc gains "…and those that need CapCut Pro the user does not have apart from the ones this machine does not have…".

  In `shared/api.ts`, `unusedSounds` becomes `{ unplaced: number; missing: number; lost: number; pro: number }`, documented "`pro` when the sound needs CapCut Pro, which the user does not have".

  In `highlights.ts` `soundView`:
  - It takes `pro: boolean` and passes `needsPro: pro ? undefined : soundNeedsPro` to `cuesInForce`.
  - It offers `sounds: usableSounds(sounds, pro).map(…)`.
  - It returns `unusedSounds: { unplaced, missing, lost, pro: proCount }`, and its sound-off return gains `pro: 0`.
  - In `view`, `proLeftOut.sounds` is the `soundView` result's `unusedSounds.pro`.

  In `timeline.ts`:
  - `soundCues` takes `pro: boolean`, passes `needsPro: pro ? undefined : soundNeedsPro`, and returns `{ cues, pro: count }`.
  - The write uses `.cues` and puts the count in `proLeftOut.sounds`.

  In `flair.ts`:
  - `FlairDeps` gains a required field, so the compiler finds every place that builds the service:

```ts
  /** whether the user has CapCut Pro, read from settings each time: without it Claude is offered only the free sounds (spec 0.4.2) */
  pro: () => Promise<boolean>
```

  - `planSounds`:

```ts
      const all = deps.sounds ? await deps.sounds.list() : []
      // Claude is offered only what the user may use; the user's own choices on the others stay stored
      const sounds = usableSounds(all, await deps.pro())
      if (sounds.length === 0) return { count: 0, dropped: 0 }
      // …
      const have = new Set(all.map((sound) => sound.effectId))
```

  - `have` keeps the full list, so a cue the user edited on a sound that is only gated is not deleted.
  - `setCue` keeps validating against the full list. The renderer offers only usable sounds, and a gated one set earlier stays stored.

  In `index.ts`, where `createFlairService({…})` is called (~:350), add `pro: async () => (await settings.read()).capcut.pro,`.

  In the tests, every `createFlairService({…})` call must now pass `pro`: flair-plan.test.ts (6 calls), flair.test.ts (1) and post-flow.test.ts (1). Use `pro: async () => true` so they keep testing what they tested.

  In `fake-api.ts`, the preview's `unusedSounds` gains `pro: 0`.

- [ ] **Step 4: Run them and see them pass.**

  Run: `npx vitest run apps/desktop`

  Expected: PASS.

- [ ] **Step 5: Commit.** `npm test` and `npm run typecheck`.

---

### Task 6: Renderer — the popover, the sound notice, the write page

**Files:**
- Modify: `apps/desktop/src/renderer/src/edit/LookPopover.tsx`
- Modify: `apps/desktop/src/renderer/src/edit/HighlightTab.tsx` (props, and pass `exits` to the popover)
- Modify: `apps/desktop/src/renderer/src/edit/GraphicsTab.tsx:60-67` (pass `preview.exits`)
- Modify: `apps/desktop/src/renderer/src/edit/FlairTab.tsx:94-100` (`SoundList` notice)
- Modify: `apps/desktop/src/renderer/src/screens/WriteScreen.tsx` (summary :136-158, result card :209-241)
- Modify: `apps/desktop/src/renderer/src/i18n.ts`
- Test: the popover's test (PostScreen.test.tsx has the exit dropdown test near :1477-1492), the sound tab test, WriteScreen.test.tsx

- [ ] **Step 1: Write the failing tests.**
  - **The popover with a held exit.** Render with a preview whose `exits` is only `[{ id: "fade-alt", name: "อัลเทอร์เนตเฟด" }]` and whose group has `look.exit: null` and `heldExit: { id: "spin-out", name: "หมุนหายไป" }`.
    - The exit select shows "หมุนหายไป (ต้องมี Pro · ไม่ใส่ตอนเขียน)" as the selected option.
    - Its options are that one, "หายเฉยๆ" and "อัลเทอร์เนตเฟด", with no "แตกกระจาย".
    - Changing the pattern calls `setFlairLook` with `exit: "spin-out"`.
  - **The existing test at PostScreen.test.tsx ~:1477-1492** keeps passing, because the fake preview lists every exit.
  - **The sound tab.** With `unusedSounds.pro: 2` it shows "มีเสียง 2 จุดที่ไม่ใส่ เพราะต้องมี CapCut Pro เปิดได้ในตั้งค่า", and not the "เครื่องนี้ไม่มี" line.
  - **The write page.**
    - With `preview.proLeftOut = { exits: 1, sounds: 2 }`, the summary has "ของที่ต้องมี CapCut Pro ไม่ใส่: แอนิเมชัน 1 · เสียง 2 (เปิดได้ในตั้งค่า)".
    - With zeros it has no such line.
    - After a write whose result has `proLeftOut` above zero, the result card shows the same line.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run apps/desktop/src/renderer`; they FAIL.

- [ ] **Step 3: Implement.**

  In `i18n.ts`:

```ts
  "flair.exit.heldPro": "{name} (ต้องมี Pro · ไม่ใส่ตอนเขียน)",
  "flair.needsPro": "มีเสียง {count} จุดที่ไม่ใส่ เพราะต้องมี CapCut Pro เปิดได้ในตั้งค่า",
  "write.proLeftOut": "ของที่ต้องมี CapCut Pro ไม่ใส่: แอนิเมชัน {exits} · เสียง {sounds} (เปิดได้ในตั้งค่า)",
```

  In `LookPopover.tsx`:
  - It takes `exits: { id: string; name: string }[]` in its props, documented "the exit animations the user may have (the preview's list)".
  - Drop the `EXIT_ANIMATIONS` import.
  - Keep a held exit on every change:

```tsx
  // an exit held for want of CapCut Pro is kept when the rest of the look changes, so turning Pro on brings it back
  const exit = group.heldExit?.id ?? group.look.exit
  const change = (patch: FlairLookPatch) => onLook(group.id, { pattern: group.look.pattern, tone: group.look.tone, exit, ...patch })
  // …
        <Select label={t("flair.exit")} value={exit ?? ""} disabled={busy} onChange={(value) => change({ exit: value || null })}>
          <option value="">{t("flair.exit.none")}</option>
          {group.heldExit && <option value={group.heldExit.id}>{t("flair.exit.heldPro", { name: group.heldExit.name })}</option>}
          {exits.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
```

  - `HighlightTab` takes `exits` and passes it to `LookPopover`; `GraphicsTab` passes `exits={preview.exits}`. Search for any other place that renders `HighlightTab` or `LookPopover` and pass the preview's list there too.

  In `FlairTab.tsx` `SoundList`, add under the `missing` notice:

```tsx
      {unused.pro > 0 && <p className="notice warn-text">{t("flair.needsPro", { count: unused.pro })}</p>}
```

  In `WriteScreen.tsx`:
  - In the summary list, after the `zoomsLost` line:

```tsx
            {preview && preview.proLeftOut.exits + preview.proLeftOut.sounds > 0 && (
              <li className="warn-text">{t("write.proLeftOut", { exits: preview.proLeftOut.exits, sounds: preview.proLeftOut.sounds })}</li>
            )}
```

  - In the result card, next to where `zoomsLost` is shown, add the same line from `result.proLeftOut`.

- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run apps/desktop/src/renderer`; they PASS.

- [ ] **Step 5: Commit.** `npm test` and `npm run typecheck`.

---

### Task 7: Docs, version, and the full check

**Files:**
- Modify: `apps/desktop/package.json` ("version": "0.4.2")
- Modify: `docs/specs/2026-09-17-capcut-timeline-manager-design.md` (line with "time_offset (µs นับจากต้นชิ้น)" near :240; new entry after the 0.4.1 entry near :650)
- Modify: `docs/specs/2026-09-27-post-production-design.md` §14 (add "### 0.4.2")
- Modify: `docs/plans/2026-09-18-flair-zoom.md:56` (a one-line note that the timing was wrong and fixed in 0.4.2)

- [ ] **Step 1: Fix the zoom format line in the main spec.** It becomes: `time_offset (µs นับจากต้นไฟล์ต้นฉบับของชิ้น = source time; 0.1.x–0.4.1 เขียนนับจากต้นชิ้นซึ่งผิด แก้ใน 0.4.2)`.

- [ ] **Step 2: Add the release entries in Thai to both specs.** Use the voice of the 0.4.1 entries.
  - **What changed:** the zoom time fix, the "มี CapCut Pro" setting (default off), and what the gate does.
  - **Which files:** the files that changed.
  - **Tests:** the counts from Step 4.

- [ ] **Step 3: Set `"version": "0.4.2"` in `apps/desktop/package.json`.**

- [ ] **Step 4: Run the full check.** Run `npm test` and `npm run typecheck`, and note the file, pass and skip counts for the entries.

- [ ] **Step 5 (controller): Run the mutation checks with `python3 $S/mutate.py` on every touched source file.**
  - Keep the lists in `$S/mut042/`.
  - Cover at least:
    - `zoom.ts` `sourceTime` (source start dropped, speed dropped);
    - `usableExit`, `exitsFor` and `soundNeedsPro` (the `pro` flag flipped);
    - `heldExits` (the `pro` and `text` checks);
    - `cuesInForce` (the `needsPro` branch);
    - `planSounds`'s `have` (full list vs usable);
    - `LookPopover`'s held exit on change.
  - Never run mutations while another vitest run or a reviewer is reading code.

---

### Task 8 (controller): Build, live test, release

- [ ] **Step 1: Build.** Run `npm run dist` in `apps/desktop` and confirm `release/boxblack-0.4.2-arm64.dmg`, the version inside, and the app.asar sha256.

- [ ] **Step 2: Live test on 0917.** Use the built app on the test profile (`$S/m25/profile`), driven over CDP (`$S/m25/live/ui.mjs`).
  1. Back up 0917 with `node $S/m25/draft-backup.mts backup release-042`.
  2. With "มี CapCut Pro" off, open 0917's post page and write.
  3. Check the draft:
     - no `material_animations` resource id among the four Pro exits;
     - no audio material whose effect id is outside `BUILT_IN_SOUNDS`;
     - every zoom keyframe's `time_offset` equals its segment's `source_timerange.start` plus the intended time into the piece;
     - the write page and result show the Pro line when the outline had Pro items.
  4. Ask the user to open 0917 in CapCut and export. There must be no Pro prompt, and the zooms must land on the text they belong to.
  5. Restore 0917 and check it is identical.

- [ ] **Step 3: Release.** Tell the user where the DMG is. After they install it, verify `/Applications/BOXBLACK.app` reports 0.4.2 and the app.asar hash matches. Update memory (`prodeck2-design-decisions.md`).
