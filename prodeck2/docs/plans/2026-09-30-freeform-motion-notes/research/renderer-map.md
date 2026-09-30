Renderer map for replacing the graphics kit. Paths are relative to `/Users/ford/Desktop/Thalent Ai/excp/prodeck2/apps/desktop/src/`; read-only, nothing run or edited.

## 1. `renderer/src/edit/FlairTab.tsx` (267 lines)
- Props, `TechniqueListProps` :31-49: `graphicsWaitForPack: boolean` :35, `graphicsProblem` :41, `onGraphic(anchor, patch: GraphicPatch | null)` :46, `onRetryGraphic(anchor)` :47, `onEditGraphic(graphic: GraphicView)` :48.
- Graphics section :200-264, gated on `options.graphic`; heading `t("edit.flairGraphics")` :202.
- Banners :204-214, one at most, in this order:
  - `graphicsProblem?.kind === "emoji"` shows `graphics.problemEmoji`, with main's text as `title`.
  - any other `graphicsProblem` shows `graphics.problem` with `{problem: graphicsProblem.text}`.
  - else `graphicsWaitForPack` shows `graphics.waitForPack`.
- Empty hint `graphics.none` :215.
- Row :218-259: `<ItemRow key={cueKey(graphic.anchor)} atUs className="flair-row graphic[ off]">`; `ItemRow` :84-91 prints the timestamp.
  - Poster :224: `graphic.poster ? <img className="graphic-poster" src={graphic.poster} alt="" /> : <span className="graphic-poster-none" aria-hidden />`
  - Summary :226: `graphic.summary` in `.flair-what`.
  - Why :227: `graphic.why || graphic.what` in `.hint.graphic-why`.
  - Point :228: `<FromPoint points pointId={graphic.pointId} />` (:60-67, uses `pointLabel` and `emphasis.from`).
  - State :230-237: off shows `graphics.offState`; else `graphics.render.${graphic.render}`, plus ` · ${lastLines(error)}` when failed (`lastLines` :52-57 keeps the last 3 non-empty lines; full error in `title`). `failed = !graphic.off && graphic.render === "failed"` :220.
  - Edited :238: `flair.edited`.
  - Length :241: `edit.pieceLength` with `playedSeconds(graphic.durationUs)`, imported from `./GraphicSheet.tsx` (:6).
- Buttons :242-257, all `size="xs"`, `disabled={busy}`, aria-labels take `{summary}`:

| Button | Line | Handler | API call (wired in `GraphicsTab.tsx`) |
|---|---|---|---|
| Retry, only when `failed` | :243-247 | `onRetryGraphic(anchor)` | `api.retryGraphic(folder, anchor)` :84 |
| Edit | :248-250 | `onEditGraphic(graphic)` | none; opens the sheet |
| Off/on | :251-253 | `onGraphic(anchor, { off: !graphic.off })` | `api.setGraphic(folder, anchor, patch)` :83 |
| Remove | :254-256 | `onGraphic(anchor, null)` | `api.setGraphic(folder, anchor, null)` :83 |

- There is no redo button today. The nearest thing is the AI menu's whole-work `rethink("graphics")`.
- There are no summary helpers in the renderer. `summary` arrives ready-made on `GraphicView` (`shared/api.ts:610-635`), built in main by `summaryOf(spec)` at `main/graphics-cues.ts:492` with hard-coded Thai `KIND_NAMES`/`MOTION_NAMES` just above it, and used at :261 and :529.
- CSS: `renderer/src/styles/edit.css:433-500` (row, poster, state, actions), `:502-546` (sheet, `.graphic-piece`, `.emoji-input`, `.graphic-item`), `:110` `.mark.graphic`.

## 2. `renderer/src/edit/GraphicSheet.tsx` (330 lines)
- It edits:
  - length in seconds, clamped between `GRAPHIC_MIN_US` and `GRAPHIC_MAX_S` (:81, :241-252);
  - a sticker's emoji (`EmojiField` :65-73) and motion (`STICKER_MOTIONS` select :256-264, `graphic.storedMotion` :147, `graphics.motionPops` note :185-188);
  - per card piece (:267-320): icon emoji, `text`, `from`, `to`, `items[].text/value`, `unit`.
- It builds a minimal `GraphicPatch` (:174-179) through `changeOf` (:108-132).
- Save failures are mapped by regex on main's message (`NO_PICTURE` :39, `PICTURES_BROKEN` :41, `saveFailure` :48-52).
- Core imports :2-14 from `@boxblack/core/graphics/plan`: `clipText, GRAPHIC_ITEM_MAX, GRAPHIC_MAX_S, GRAPHIC_MIN_US, GRAPHIC_TEXT_MAX, GRAPHIC_UNIT_MAX, isSticker, piecesOf, STICKER_MOTIONS, GraphicPiece, StickerMotion`. No other non-test renderer file imports that module.
- Exports: `GraphicSheet` :139 and `playedSeconds` :84.
- Importers, complete:
  - `screens/PostScreen.tsx:10` (`GraphicSheet`).
  - `edit/FlairTab.tsx:6` (`playedSeconds`). This helper must move, for example to `format.ts`, before the file is deleted.
- `GraphicPatch` (`shared/api.ts:640-649`) in the renderer: `FlairTab.tsx:4,46` and `GraphicSheet.tsx:15,23,139,174`. Once the sheet goes, only `{ off }` and `null` are sent.
- `room.changeHighlightText(action, showsFailure = false)` (`room/ClipRoom.tsx:678-694`): the sheet is the only caller passing `true` (`PostScreen.tsx:241`).

## 3. `GraphicsTab.tsx`, `PostScreen.tsx`
- `edit/GraphicsTab.tsx`:
  - prop `onEditGraphic` :18, :25, passed on at :85.
  - switch :45: `<Switch label={t("flair.graphic")} hint={t("flair.graphicHint")} checked={flair.graphic} disabled={writing} onChange={(graphic) => room.changeFlair({ ...flair, graphic })} />`
  - points-changed banner :48: `preview.emphasis.changed.graphics && !room.run.running` renders `<EmphasisBanner onRethink={() => room.rethink("graphics")} />`.
  - `TechniqueList` wiring :73-86.
- `screens/PostScreen.tsx`:
  - imports :3 (`GraphicView`), :9 (`cueKey`), :10 (`GraphicSheet`).
  - state :50 `const [editingGraphic, setEditingGraphic] = useState<GraphicView | null>(null)`; the doc comment at :38 mentions it.
  - `:214` `<GraphicsTab … onEditGraphic={setEditingGraphic} />`.
  - sheet mount :234-243, `key={cueKey(editingGraphic.anchor)}`, `onSave` calls `api.setGraphic`.
  - counts :68-72: `graphic: graphicsOn ? carried.counts.graphic : 0`; tab count :144 sums `text + zoom + insert + graphic`.
  - AI item :103: `{ id: "graphics", label: t("post.ai.rethink.graphics"), disabled: aiBlocked ?? needsPoints, onRun: () => room.rethink("graphics") }`.

## 4. Counts, labels, run progress
- `edit/byBeat.ts`: `BeatFlair.graphics` :11; `counts.graphic` :14; off graphics are listed but not counted :48; poured by `graphic.beatId` :62.
- `edit/postTabs.ts`:
  - `TAB_OF_WORK` :9 maps `text`, `techniques` and `graphics` to the `graphics` tab.
  - `MAIN_WORDS` :33-34 (`graphics.refused.noPicture` / `noCutaway`) are about cutaways, not graphics.
  - `tabRuns` :58-67 gives the tab spinner or failure flag.
- `edit/BeatSidebar.tsx`: `MARKS.graphics` :48, symbol `graphic: "📊"` :52, screen-reader text `post.mark.graphic` :61.
- `edit/AiMenu.tsx`: item ids :7; the button shows only `✦ {running}` (:26) plus a stop button (:28-31) that calls `api.cancelAi()` (`PostScreen.tsx:251`).
- `edit/PlanStrip.tsx`:
  - `linesOf(work, state)` :7-31. A running work gets one line, `post.run.running` with `{work}` (:13); done gets `post.run.done` with `{work, count}`, plus `post.run.dropped` when `dropped > 0`.
  - The bar :42-45 is the share of the run's works that are finished, not progress inside a work.
- The running state carries no counter: `PostWorkState` is `{ state: "running" }` (`shared/api.ts:422-433`). "Writing graphic 2 of 5" needs either `done`/`total` added to that variant, or a new event.
- Events reach the room at `room/ClipRoom.tsx:459-483` (`post-plan` sets `run.states[work]`; `runWorks` :228, :479). `linesOf` :12-13 is the one place to render the new text.
- The existing `{ type: "graphics"; state: "progress"; hash; done; total }` event (`shared/api.ts:463`) is for renders; the renderer uses it only as a refresh tick.

## 5. `room/ClipRoom.tsx`
- Constants: `GRAPHICS_REFRESH_MS = 500` :148, `RECOLOUR_READ_MS = 600` :151.
- `graphicsVersion` :208 is a dependency of the preview read effect (:390-427). A read where only it changed is "quiet" (:395-397): no `placing`, and errors are swallowed.
- Listener :432-453: any `graphics` event for this folder, or `graphics-pack` with `state === "done"`, bumps `graphicsVersion`, throttled with one trailing read.
- `post-plan-finished` also bumps it :472. A work reaching `done` bumps `highlightsVersion` :484.
- Recolour :659-669: in `changeHighlights`, when `custom` colours changed and `graphicsOn`, it waits for the save plus `RECOLOUR_READ_MS`, then bumps `graphicsVersion`.
- `graphicsOn = flair?.graphic === true` :383, exposed at :80 and :793.
- Nothing here is card- or sticker-specific.

## 6. Settings (`screens/SettingsScreen.tsx`; no separate card component)
- `GraphicsPackRow` :100-179:
  - installing :111-127 and downloading :129-148, each with a cancel button calling `api.cancelGraphicsPack()`; progress is measured against `GRAPHICS_PACK.bytes` (`shared/graphics-pack.ts`).
  - idle :150-178: installed or hint text, `settings.graphicsPackFailed`, and the problem line :157-166 (`kind === "emoji"` shows `graphics.problemEmoji`, else `settings.graphicsPackProblem`).
  - buttons: `api.removeGraphicsPack()` :169 and `api.installGraphicsPack()` :173.
- `GraphicFilesRow` :202-236:
  - hidden when `view.graphicFiles.count === 0` and there is no result yet.
  - button `settings.graphicFilesClean` :230-233 calls `api.cleanGraphicFiles()` :214.
  - result text from `cleanResult` :193-199 and `blockedMessage` :182-190.
- Pack event state :336-338 and :370-388; rows mounted :457-458.
- Emoji-specific places: `SettingsScreen.tsx:159-163`, `FlairTab.tsx:204-209`, `GraphicSheet.tsx:36-73`.

## 7. `renderer/src/i18n.ts` keys (Thai truncated)
- Rows and buttons (:158-185):
  - `edit.flairGraphics` "กราฟิกในบีต · ตามจุดเน้น"
  - `graphics.none` "ยังไม่มีกราฟิกในบีตนี้ กดคิดใหม่…"
  - `graphics.render.waiting` "รอเรนเดอร์", `.rendering` "กำลังเรนเดอร์…", `.ready` "พร้อม", `.failed` "เรนเดอร์ไม่สำเร็จ"
  - `graphics.offState` "ปิดอยู่ ไม่ใส่ในคลิป"
  - `graphics.retry` / `retryLabel` "ลองเรนเดอร์ใหม่"
  - `graphics.off` / `offLabel` "ปิดอันนี้"; `graphics.on` / `onLabel` "เปิดอันนี้"
  - `graphics.edit` "แก้"; `graphics.editLabel` "แก้กราฟิก {summary}"
  - `graphics.remove` "ลบ"; `graphics.removeLabel` "ลบกราฟิก {summary}"
  - shared: `flair.edited` :465 "คุณตั้งเอง", `edit.pieceLength` :225, `emphasis.from` :309
- Sheet fields (:186-210):
  - `graphics.editTitle`, `seconds`, `playsFor`, `pieceText`, `pieceFrom`, `pieceTo`, `pieceUnit`, `pieceItem`, `pieceValue`, `pieceNumbered`
  - `graphics.save` "บันทึกและเรนเดอร์ใหม่", `editedHint`, `saveFailed`
  - `graphics.emoji`, `emojiHint`, `emojiOne`, `emojiUnknown`, `emojiBroken`
- Sticker motions (:211-218, :221): `graphics.motion` "ท่า"; `.pop` โผล่ขึ้น, `.float` ลอย, `.bounce` เด้ง, `.spin` หมุน, `.fly-up` พุ่งขึ้น, `.fly-across` บินผ่าน, `.rain` โปรย; `graphics.motionPops`.
- Card pieces (:196-202): `graphics.kind.number` ตัวเลขวิ่ง, `.label` ป้าย, `.bars` แถบเทียบ, `.checks` รายการติ๊ก, `.arrow` ลูกศร, `.ring` วงกลมชี้, `.icon` อีโมจิ.
- Problems (:168-170): `graphics.waitForPack`, `graphics.problem` "เรนเดอร์กราฟิกไม่ได้: {problem} — ลองลบแล้วติดตั้ง…", `graphics.problemEmoji` "…รูปอีโมจิในแอปเสีย ติดตั้ง BOXBLACK ใหม่".
- Not graphics despite the prefix: `graphics.refused.noPicture` / `noCutaway` :219-220 (cutaways).
- Switch, tab, plan:
  - `flair.graphic` :447 "กราฟิกซ้อนภาพ"
  - `flair.graphicHint` :448 "AI ทำสติกเกอร์อีโมจิ 3D ที่ขยับตามคำพูด และการ์ดตัวเลข แถบเทียบ รายการ…" — names the kit, so it needs rewriting.
  - `post.tab.graphics` :230, `post.mark.graphic` :239, `post.planHint` :244, `post.work.graphics` :250 "กราฟิก", `post.run.*` :253-259, `post.ai.rethink.graphics` :262, `emphasis.items` :295.
- Settings (:523-548):
  - `settings.graphicsPack`, `…Hint` ("HyperFrames + Chrome + Node · โหลดครั้งเดียว {size}"), `…Install`, `…Downloading`, `…Installing`, `…Cancel`, `…Installed`, `…Remove`, `…Failed`, `…Problem`
  - `settings.graphicFiles`, `…Hint` ("~/Movies/CapCut/BOXBLACK/graphics"), `…Clean` "ย้ายไฟล์ที่ไม่ได้ใช้ไปถังขยะ", `…Cleaned`, `…NoneUnused`, `…CleanedRecent`, `…NoneRecent`, `…Stopped`
  - `…BlockedDraft`, `…BlockedRecycled`, `…BlockedRecycleBin`, `…BlockedRoot`, `…BlockedBackup`, `…BlockedBackups`, `…BlockedNoRoot`, `…BlockedBusy`

## 8. Write texts
- `edit/writeEnd.tsx`:
  - `DROPPED_NAMES.graphics` maps to `"flair.graphic"` :12.
  - `doneMessage` :15-19 picks `write.done`, `write.doneGraphics`, `write.doneGraphicsSkipped` or `write.doneGraphicsAllSkipped` from `graphicCount` and `graphicsSkipped` (i18n :321-324).
  - `doneNotes` :22-30 uses `write.resultDropped` :352.
  - `toldIsLong` :38-40: a toast with skipped graphics stays `ACTION_TOAST_MS` (12 s, :9).
- `edit/WriteButton.tsx`:
  - :44-48: `playing` (on and not off), `rendered`, `failedRenders`, `finished`.
  - :98: `write.graphics` with `{count: playing.length - failedRenders}`, or `write.off` with `flair.graphic`.
  - :114-120: `write.check.graphics` `{done,total}`, `write.check.graphicsGoing`, `write.check.graphicsFailed` (i18n :342-344).

## 9. Fixtures and tests
- `renderer/test/fake-api.ts`: there is no `GraphicView` builder. Defaults only:
  - `flair.graphic: false` :64; `graphicsPack: {state:"missing"}`, `graphicsProblem: null`, `graphicFiles` :76-78.
  - preview: `changed.graphics` :245, `graphics: []` :267, `graphicsWaitForPack` / `graphicsProblem` :268-269.
  - stubs: pack and clean :321-324, `setGraphic` / `retryGraphic` :381-382.
  - write result: `graphicCount`, `dropped.graphics`, `graphicsSkipped` :358-361.
- `screens/PostScreen.test.tsx` (3,023 lines, 163 tests), fixtures local to the file:
  - `CARD_SPEC` :1823; `GRAPHIC` :1833; `withGraphics` :1849; `graphicRows` / `graphicButton` :1855-1857.
  - `COUNTER` :2045; `LISTS` :2054; `editGraphic()` :2067; `STICKER_SPEC` / `STICKER` :2366-2367.
  - imports `piecesOf, CardSpec, StickerSpec` from core :24.
- PostScreen tests by group:
  - Rows, banners, counts (:1860-2027, :2119, :2567, :2619, :2628): about 20. They survive with new fixtures; the edit button is referenced at :1856 and :1879, and the write-lock test at :2876.
  - `GraphicSheet` (:2075-2355 cards, :2373-2614 stickers, emoji and icons): about 31. These go.
  - Background reads, throttle, pack install, recolour (:2669-2811): 10. These stay.
  - Plan strip and AI menu (:495-671); points-changed banners :1356 and :1374.
- Other files:
  - `edit/WriteButton.test.tsx`: `CARD_SPEC`/`GRAPHIC`/`graphicAt`/`withGraphics` :640-671; 2 tests (:673, :688).
  - `edit/writeEnd.test.ts`: 4 tests (:48, :77, :98, :103).
  - `edit/byBeat.test.ts`: `graphic()` builder :12-25 with `spec: {}`; 2 tests (:74, :85).
  - `room/ClipRoom.test.tsx`: 2 toast tests (:453, :476); `graphics` events :598, :617; `rethink("graphics")` :774.
  - `screens/SettingsScreen.test.tsx`: 10 pack tests (:231-321), about 6 graphic-files tests listed (:382-496).
  - `App.test.tsx`: "graphics were stopped" strings :367-444.

## 10. Media today
- Video: `shared/media-url.ts`. `MEDIA_SCHEME = "boxblack-media"` :2; `mediaUrl(folder, videoId)` :11 returns `boxblack-media://video/<encoded folder>/<encoded videoId>`; `parseMediaUrl` accepts only the `video/` host and exactly two parts.
- Main registers the scheme at `main/index.ts:79` and handles it at :382 with `createMediaHandler`.
- Renderer use is `<ScenePlayer src={mediaUrl(...)} startUs endUs />` in `edit/SpeechTab.tsx:45`, `outline/BeatList.tsx:125`, `outline/UnusedParts.tsx:92`.
- Graphic posters do not use the protocol. `GraphicView.poster` is "a small PNG data URL once rendered" (`shared/api.ts:627-628`), filled at `main/highlights.ts:321` from `renderer.posterOf(hash)` (`main/graphics-render.ts:479`) and put straight into `<img src>`.
- CSP (`renderer/index.html:7`): `img-src 'self' data:; media-src boxblack-media:`.
- For an animated preview later, a `<video>` must be served over `boxblack-media`, which means a new route beside `video/` in `parseMediaUrl` and the handler; the rendered `.mov` is not reachable from the renderer today. An iframe of the HTML fragment would be blocked by `default-src 'self'` and `script-src 'self'`.