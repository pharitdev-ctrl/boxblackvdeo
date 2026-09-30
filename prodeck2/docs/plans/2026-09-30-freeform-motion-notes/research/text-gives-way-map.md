# Code map: a point's motion graphic takes the place of its highlight text (rules A and B)

Line numbers are those of the code before Task 7 (the snapshot `before-task7`); Task 7 has since removed the kit's branches, so lines have moved and the card and sticker cases are gone.

All paths are relative to the frozen tree. Short forms: `main/` = `apps/desktop/src/main/`, `rend/` = `apps/desktop/src/renderer/src/`, `api.ts` = `apps/desktop/src/shared/api.ts`, `core/` = `packages/core/src/`. Nothing was edited or run.

## What shapes the task

- **Rule A has one choke point.** `graphicsInForce` has a single caller outside tests (`graphicsOn`, `main/highlights.ts:266`). The write, the planner and the sound plan reach it through `graphicJobs`. A text band carries its group id but no point id.
- **Rule B has no choke point.** Groups are placed separately in the preview (`highlights.ts:174`), the write (`timeline.ts:470`), the hidden words (`timeline.ts:244`) and three planning calls. Two checks refuse a write when preview and write disagree (`timeline.ts:476-478`, `:489-491`).
- **The order is the wrong way round for rule B.** Every flow places the groups first and the graphics from those groups' bands. The filter also has to come after `timeHighlights`, not before (section 4).
- **Traps found:**
  - the "Aa เน้น" button comes back on a point whose text is hidden (section 11);
  - the polish runs before the graphics are written (section 8);
  - the subtitle lines are not read again when the graphics switch, the looks switch or the text position changes (section 8);
  - a sound on a line of hidden text would be counted as "unplaced" (section 7);
  - a failed render leaves a point with neither text nor graphic (section 6).
- **Two decisions are needed first:** whether stored cards and stickers also replace text (only a motion graphic has `spec.html`), and what happens to sounds anchored on the hidden lines.

## 1. Highlight groups and points

- **Type:** `core/highlights/placement.ts:15-30`, `HighlightGroup { id; source: "ai" | "user"; edited; lines; beatId?; pointId?; scene? }`. `pointId` (:23-24): "the emphasis point it was made for; absent on the user's own and on edited items whose point was deleted".
- **Stored at** `StoredOutline.highlights.groups` (`api.ts:506`, `StoredHighlights` :517-527). Points are `EmphasisPoint` (`core/emphasis/types.ts:18-28`) in `StoredOutline.emphasis.points` (`api.ts:510`). The only tie is `group.pointId === point.id`.
- **The placed and timed forms drop it.** `PlacedGroup` (`placement.ts:45-54`) and `TimedGroup` (:139-145) carry `groupId` and `beatId` only. Callers rebuild the map from the stored groups: `main/highlights.ts:177`, `main/flair.ts:674`.
- **More than one group per point: yes.**
  - Claude makes one per point (`core/highlights/pick.ts:28` "จุดหนึ่งมีได้ชุดเดียว", enforced :225-236).
  - The user's "Aa" (`rend/screens/PostScreen.tsx:187-195` → `main/highlights.ts:673-693`) makes a group per three lines (`core/highlights/manual.ts:27-39`), all given the point id (`highlights.ts:679`).
  - A kept user or edited group plus a fresh Claude group can share a point when their words do not overlap (`highlights.ts:589-602`, `withoutOverlaps` `main/highlight-state.ts:134-141`).
- **A group with no point: yes.** `unbound` (`main/emphasis.ts:35-40`) strips the id from the user's groups when their point is deleted (`withoutPoint` :93-117) and in the pre-M25 cleanup (`main/post-cleanup.ts:22`). The renderer's only `addHighlightGroup` call passes a point, but the API allows none (`api.ts:222`). Such a group passes every level.

## 2. Show rules (`main/highlight-state.ts`)

- `ShowRules` :54-57 is `{ text: boolean; passes: PointFilter }`.
  - `text`: highlight text is on.
  - `passes(pointId)`: built by `pointFilter(placed, level)` (`core/emphasis/filter.ts:118-121`). True for `undefined`; otherwise the point must be placed on this cut and pass `passesLevel` (`core/emphasis/types.ts:81-84`: light = key, medium = key and secondary, heavy = all).
- `SHOW_ALL` :60 is `{ text: true, passes: () => true }`.
- `everyPoint`: not found under that name in this file. It is `everyPointShown(placed, highlightsOn)` :108 = `{ text: highlightsOn, passes: pointFilter(placed, "heavy") }`. `everyPoint` is a local wrapper at `main/flair.ts:310`.
- `showRulesOver(placed, options)` :116-118 = `{ text: options.highlightsOn, passes: pointFilter(placed, options.flair.level) }`.
- `showRulesOf(stored, plan, clips, options)` :111-113 is the same over `placedPoints(...)`. Its only caller is `timeline.ts:635`.
- `placedPoints(stored, plan, clips)` :71-73 = `placePoints({ points: currentPoints(stored, clips), plan, wordsOf })`.
- `placeStored` :125-128 is the one function that filters groups:
  ```ts
  if (!show.text) return []
  return placeHighlights({ plan, wordsOf: wordsIn(clips), groups: currentGroups(stored, clips).filter((group) => show.passes(group.pointId)) })
  ```
  `show.passes` is also handed alone to `cuesInForce`, `zoomsInForce`, `insertsInForce` and `graphicsInForce`, which filter items by their own `pointId`.

Callers of `placeStored` in `main/` (all eight):

| Where | Show rules | Result used for |
|---|---|---|
| `highlights.ts:174` (`view`) | `showRulesOver(points, options)` :173 | preview `groups` :198-210; looks :182; held exits :184; `dodgeOf` :185-192; `hidden` count :213; sound slots and places (`soundView` :194 → `slotsFor` :363); zoom slots (`zoomView` :218 → :441); cutaway places (`insertView` :219 → :416); `emphasis.items.text` :235 |
| `highlights.ts:257` (`graphicsOn`) | same | graphic places (`slotsFor` :261); looks :264; text bands :265 → `textIn` :274 |
| `highlights.ts:477` (`beatsOn`) | `SHOW_ALL` | beats of old beatless items; not touched by rule B |
| `timeline.ts:244` (`hiddenFor`) | caller's | subtitles' hidden words; called at :474 (write) and :636 (subtitle preview) |
| `timeline.ts:470` (`writeNow`) | `showRulesOver(points, highlights)` :466 | text tracks :488-531; then handed to `zoomsFor` :543, `insertCutaways` :548, `soundCues` :585 |
| `flair.ts:423` (`planTechniques`) | `everyPoint` | zoom pieces :424 (only a piece's length reaches the prompt) |
| `flair.ts:525` (`planGraphics`) | `everyPoint` | looks :527; text bands :529 → `graphicPoints` :530 |
| `flair.ts:673` (`planSounds`) | `everyPoint` | groups with `pointId` :674-675; slots :677; punch moments :681-690; `soundSlotsFor` :701 |

## 3. Text bands for graphics

- `textBands(input)` (`main/graphics-cues.ts:93-139`) returns `GroupBand[]`. `GroupBand` :50-57 is `{ groupId, videoId, beatId, words, band, startUs, endUs }`: the group, not the point.
- `textBandsIn(bands, span)` :149 returns bare `Band[]`; the group is lost here.
- `textBandOn(sentence, bands)` :142-146 merges the bands of the groups showing the sentence's words in its beat. It is used only for what Claude is shown.
- `keepClearsIn(plan, clips, span)` :156-169 gives the `keepClear` of every scene played inside the span.
- They reach `graphicsInForce` in one place, `graphicsOn` (`highlights.ts:255-281`):
  ```ts
  const bands = textBands({ placed, timed, clips, canvas, font, looks, position: options.position, subtitlesOn: options.subtitlesOn })  // :265
  keepClearIn: (span) => keepClearsIn(plan, clips, span),            // :273
  textIn: (span) => textBandsIn(bands, span),                        // :274
  captionsFromY: options.subtitlesOn ? SUBTITLE_ROOM_FROM_Y : null,  // :277
  ```
- `flair.ts` has no `textIn` or `keepClearIn`: not found. Its only band call is `textBands` at :529, for the planner.
- The bands are read once per graphic, `graphics-cues.ts:505-506`:
  ```ts
  const never = isSticker(cue.spec) && crossesKeepClear(cue.spec.motion) ? input.textIn(span) : [...input.keepClearIn(span), ...input.textIn(span)]
  let box = dodgeBands(cue.spec.box, never, subtitles)
  ```
- **To leave out one point's groups for one graphic:**
  1. Add `pointId?` to `GroupBand`, filled in `textBands` from a group-to-point map. Or make core carry it on `PlacedGroup` (`placement.ts:91`, `:120`).
  2. `textBandsIn(bands, span, exceptPointId?)`.
  3. `textIn: (span: Span, pointId?: string) => Band[]` (:467), and `input.textIn(span, cue.pointId)` twice on :505.
  4. `highlights.ts:274` passes it through.
- The test helper defaults `textIn: () => []` (`graphics-cues.test.ts:275`), so an optional parameter breaks no test.
- A graphic with no `pointId` keeps dodging all text. A group with no `pointId` is dodged by every graphic.
- **Side effect:** `spec.box` is in a motion graphic's render hash (`main/graphics-render.ts:341`). Every written graphic that its own text was pushing gets a new box and renders again. It does not go stale: staleness is version, words and length (`withWordsNow`, `graphics-cues.ts:407-411`), and a dodge keeps the box's size (`core/graphics/framing.ts:160-167`).

## 4. `graphicsInForce` and its callers

Signature, `graphics-cues.ts:455-474`:
```ts
export function graphicsInForce(input: {
  graphics: GraphicCue[]; place: (anchor: CueAnchor, pointId?: string) => ItemPlace | null
  flair: FlairOptions; durationUs: number; passes: PointFilter
  pieceEndOf: (anchor: CueAnchor) => number | null
  keepClearIn: (span: Span) => Band[]; textIn: (span: Span) => Band[]
  wordsFrom: (anchor: CueAnchor, seconds: number) => MotionWord[]
  captionsFromY: number | null; canvas: { width: number; height: number }
}): { kept: PlacedGraphic[]; dropped: number; off: PlacedGraphic[] }
```

- `kept`: on, passes the level, placed, has room, at least 1.5 s left (`enforceGraphics`, `core/graphics/plan.ts:216-226`). An unwritten or stale motion graphic is still in `kept`, with `stale` and `wordsNow` set (:540-551).
- `off`: switched off, still placed.
- `dropped`: a number only (no place, no room, a label-only card, too little time). No caller reads it.
- A graphic the level hides is in none of the three (:481).
- "Written and not stale" is already one expression, `graphicJob` :571: `spec.html !== null && graphic.stale === false`. A card or sticker always has a job (:572-573). `graphicViews` reports the same as `written` and `stale` (:626-627).

Direct caller: `highlights.ts:266` only. `timeline.ts`, `flair.ts` and `sound-cues.ts` do not call it: not found. They go through these:

| Caller | Uses |
|---|---|
| `graphicsOn` `highlights.ts:255-281` | returns `{ kept, off, place }` |
| `graphicView` :300-338 (preview) | `graphicViews({ kept, off }, place)` :314; jobs of `kept` :321; `renderer.ensure` :327 |
| `graphicJobs` :346-352 | returns `{ kept, off, jobs }`; wired at `main/index.ts:335` (timeline) and :378 (flair) |
| `jobFor` :524-529 | `kept` and `jobs` under saved settings, for a render retry |
| `candidateJob` :538-543 | places nothing; takes a `PlacedGraphic` already placed |
| `timeline.ts:416` (write) | `inForce.kept` and `jobs`; waits for jobs :439; jobless ones counted in `unmade` :422 |
| `flair.ts:578` (`planGraphics`) | `kept` with `html === null` → `writeGraphic` :581-584; `jobs` → `ensure` :588 |
| `flair.ts:634` (`redoGraphic`) | finds the graphic in `kept`, else `off` |
| `flair.ts:696` (`planSounds`) | `kept` at level `"heavy"` → `soundSlotsFor` :701 |

Order of computation, groups against graphics:

- **Preview, `view` (`highlights.ts:155-243`):** points :172 → show :173 → `placed` :174 → `timed` :175 → looks :182 → sounds :194 → `groups` :198 → zooms :218 → cutaways :219 → graphics last :220. `graphicView` calls `graphicsOn` at :313, which places the groups a second time (:257-265).
- **Write, `writeNow` (`timeline.ts:399-614`):** graphics first, at :416, from a compile of their own. Then the renders are waited for (:439), the draft is read (:451), and the groups are placed at :470.
- **`planGraphics` (`flair.ts:512-611`):** groups at every level :525 → bands :529 → `planMotion` :535 → store :553 → `graphicJobs` at the level in force :578 → writings.
- **`planSounds`:** groups :673, then graphics :696.

Under rule B the groups depend on `kept`, and `kept` depends on the groups' bands. One-pass way out:

1. Place and time the groups under the show rules as today.
2. Place the graphics against every other point's band.
3. Hide the groups of the points in the replaced set.

In step 2 a graphic also dodges text that step 3 then hides. The exact alternative is to repeat steps 2 and 3, removing replaced points' bands, until `kept` stops changing; text shown only grows, so it ends.

**Filter after timing, not before.** `timeHighlights` ends each group at the next group's start (`placement.ts:167`). Filtering `placed` first would let the group before a hidden one run on, under the graphic that was placed against its shorter band.

The same applies to looks: `enforce` counts runs of three over the groups shown (`core/flair/plan.ts:58-77`). Dropping a group can change a neighbour's pattern, and with it the band a graphic dodged.

## 5. The preview

- API: `previewHighlights(folder, rules, options)` (`api.ts:213`) → `main/highlight-api.ts:180` → `highlights.preview` (`highlights.ts:507-514`) → `view` :155-243.
- Groups are built from `timed` at :198-210. The renderer gets `HighlightGroupView` (`api.ts:549-566`): `{ id, beatId, source, pointId?, startUs, endUs, placement: Dodge, look, heldExit?, lines: HighlightLineView[], scene? }`.
- Graphics come from `graphicView` :300-338 as `GraphicView` (`api.ts:623-657`), with `written`, `stale`, `off`, `pointId`. Kept ones come first, then switched-off ones. Dropped ones are not listed.
- **Where rule B would go:**
  - Filter `timed` right after :175. Everything below then follows: looks, held exits, sounds, zooms, cutaways, `items.text`.
  - That needs `graphicsOn` called before :175, and its result handed to `graphicView` instead of the call at :313. `graphicsOn` is pure and synchronous.
  - `hidden` (:213) is `filter(show.passes).length - timed.length`. It would count the replaced groups under "คำของชุดนั้นไม่อยู่ในผลตัดต่อแล้ว".
- **Stored but not shown, today:**
  - `HighlightPreview.hidden` (`api.ts:691-697`) is a number: groups that pass the level but are off the cut.
  - Groups the level hides are neither listed nor counted; only the point says so (`EmphasisPointView.shown`, `api.ts:767-768`).
  - With the text switch off, `groups` is empty.
  - "Held" exists only as `heldExit` on a shown group (:561-562). "Waits" is a main-side idea (`highlights.ts:372-375`, :588) that never reaches the renderer.
  - A per-group hidden or replaced state: not found. A group cannot be switched off.
- The text work calls `view` with `graphic: false` (`main/post-plan.ts:175`), so its count is of all groups.

## 6. The write (`main/timeline.ts`, `writeNow` :399-614)

| Step | Lines | Takes the placed groups? |
|---|---|---|
| Graphics in force and their jobs, then the wait | :412-447 | no: `graphicJobs` places its own |
| `placed = placeStored(stored, cutPlan, clips, show)` | :470 | source |
| Subtitles with `hideSubtitles` | :472-481 | no: `hiddenFor` :243-246 calls `placeStored` itself from `show` |
| Text tracks: `timeHighlights(placed, at, info.duration)` :488, count check :489-491, looks :499-505, layout :507-523, `addHighlightTracks` :524 (`core/capcut/highlights.ts:148`) | :487-532 | yes |
| Zooms: `zoomsFor(…, placed, …)`, punch moment from `punchAtUs(slot, timed)` :322 | :543-544, :310-328 | yes, timed again at :313 |
| Cutaways: `insertCutaways(…, placed, …)`, line anchors through `slotsFor` :286 | :548-549, :270-307 | yes, timed again at :284 |
| Graphics laid; a failed or missing render is skipped and counted | :552-582 | no |
| Sounds: `soundCues(…, placed, …)`, line anchors through `slotsFor` :351 | :585-586, :334-373 | yes, timed again at :349 |

- `inForce.kept` is in hand at :416, before :470. The replaced set can be taken there: kept graphics with a job and a `pointId`.
- The preview's group count is sent as `groupCount` (`rend/edit/WriteButton.tsx:65`) and checked at :489. Preview and write must apply rule B alike.
- **Gap:** a graphic whose render failed is left out (:557-563) while its text stays hidden. Tying rule B to the render result would break the :489 check, because the preview counts groups before renders end.

## 7. Things anchored on a highlight line

- **What can sit on a line** (`CueAnchor` kind `"highlight"`, `core/flair/plan.ts:80-86`):
  - Sounds.
  - Old or hand-made cutaways. Claude's cutaways use the point's speech anchor (`core/flair/direct.ts:170`).
  - The coloured word and exit live in `flair.looks[groupId]` and stay stored when the group is not shown (`highlight-state.ts:348`).
  - Graphics never sit on a line (`highlight-api.ts:121-126`).
  - A punch zoom lands on the first line in its piece (`main/zoom-cues.ts:52-55`), and the piece's name quotes it (:40-41).
- **Slots:**
  - `slotsFor` (`main/sound-cues.ts:61-119`) makes one slot per line of each timed group (:70-77). The preview, the write and the user's picks use it.
  - `soundSlotsFor` (:130-201) is what Claude is offered. At the same moment a text line wins over a graphic's start (:160, :198-200).
  - An anchor is resolved by `placeOf` (`main/insert-media.ts:57-96`). `itemPlaceOf` (:113-124) falls back to the point's start for speech anchors only: a line "has no fallback" (:107-109).
- **Today, when the level hides the point:**
  - Preview: `soundView` filters such a cue out first (`waits`, `highlights.ts:372-377`). It is in no count and has no row.
  - Write: a cue carrying the point's id is skipped by `passes` (`sound-cues.ts:235`). A hand-set cue with no `pointId` (`flair.ts:735`) finds no place and adds to `unplaced` (:238), which the write never reads (`timeline.ts:356`). It is dropped silently and is not in `WriteResult.dropped`.
  - A cutaway on such a line adds to `insertsInForce`'s `dropped`, which no caller reads.
  - UI: nothing is shown.
- **Under rule B**, if only `timed` is filtered:
  - Claude's cue on a hidden line passes the level, finds no place, and raises the `flair.unplaced` notice. `waits` needs the new condition.
  - The point's sound goes quiet, unless it is moved to the graphic's start.
  - The punch moves to the piece's start.
  - `planSounds` would still offer the hidden lines (`flair.ts:673-675`, :701).

## 8. Subtitles

- **Lines:** `captionsFor(plan, clips, draft, length, hidden)` (`timeline.ts:227-237`) → `buildCaptions` (`core/subtitles/captions.ts:115-165`), per piece, with the hidden word numbers filtered out.
- **Hidden words:** `hiddenFor` :243-246 → `hiddenWords(placed, timed, minUs)` (`highlight-state.ts:169-186`). A placed group that is absent from `timed` hides nothing (:171, :177-178), so filtering `timed` alone is enough.
- **Preview of lines:** `subtitles()` :631-656. It reads the level from the saved settings (:635) and takes no position.
- **Matching stored texts:** by key `` `${cut.binId}:${caption.startUs}:${caption.endUs}:${caption.text}` `` (:645), returned as `savedText` (:653). The polish stores by the same key (`polishStored` :720-742).
- **When hidden words change,** the captions of the affected breaths get new times and text, so new keys. Their stored texts stop matching; they stay stored, up to 5,000 (:138-149). Other lines keep theirs. The polish cache is keyed by the whole list of lines (:698), so it asks Claude again.
- **The write's check** compares counts only (:476-478): "the subtitles changed since they were shown (N lines now, not M)". Texts are applied by index (:479).
- **When the renderer reads the lines again** (`rend/room/ClipRoom.tsx`): the effect at :558-580 depends on `[api, folder, rules, subtitlesOn, subtitleLength, decisionsVersion, hideUnderHighlights, hiddenWordsVersion, linesVersion]`, where `hiddenWordsVersion` is `highlightTextVersion:levelVersion` (:557).
  - `setLinesVersion`: :531 (subtitles work done), :644 (retry).
  - `setHighlightTextVersion`: :499 (run finished), :533 (emphasis or text work done), :737 (any stored change by the user, which covers a graphic switched off or removed).
  - `levelVersion`: only on a level change, once saved (:678-706).
- **Not covered under rule B:** the graphics switch and the looks switch (`changeFlair` tracks the level only, :685), and the text position (`changeHighlights` :713-721). Each can change which text a graphic replaces. The write would then fail the count check until something else triggers a read.
- **Polish order:** in a plan run the polish starts right after the text work (`post-plan.ts:219-228`), before the graphics are written. Under rule B it must also wait for the graphics work.

## 9. The renderer's highlight text list

- **Section and list:** `rend/edit/GraphicsTab.tsx:48-71`. The title is `highlights.title` (:50). The list is `HighlightTab` (:59-69) with `groups={beat.groups}`, from `byBeat`/`wholeClip` (`rend/edit/byBeat.ts:56-89`).
- **Row:** `rend/edit/HighlightTab.tsx:54-89`. The head (:57-74) shows:
  - `highlights.group` with start and end (:58);
  - the source tag `highlights.source.ai` / `.user` (:59);
  - `FromPoint` (:60; `rend/edit/FlairTab.tsx:97-104` → `pointLabel`, `rend/edit/postTabs.ts:72-76`, key `emphasis.from`);
  - the placement note (:61);
  - the look button (:63-70) and `highlights.removeGroup` (:71-73).
- **Lines** (:75-86): time, input (`highlights.lineLabel`), `highlights.removeLine`, and `highlights.partial` when words were cut (:83).
- **"ไม่มีที่ว่าง วางทับน้อยที่สุด"** is `highlights.dodge.over` (`rend/i18n.ts:397`), drawn at :61 from `group.placement`. Main sets it at `highlights.ts:185-192`, :205 from `layoutGroup(...).dodge`. `"over"` comes from `core/highlights/layout.ts:115-118`: the text found no room clear of the scene's `keepClear` band. It has nothing to do with graphics; text never dodges a graphic.
- **Can a row carry a note today?** Yes, that one `hint` span, plus the per-line warning. There is no general state field. The nearest patterns: a switched-off graphic's row (`flair-row graphic off`, `graphics.offState`, `FlairTab.tsx:88`, :280) and a point the level hides (`emphasis-point off`, `emphasis.notShown`).
- **Keys:** `highlights.title` :370, `highlights.hidden` :387, `highlights.group` :388, `highlights.source.*` :389-390, `highlights.lineLabel` :391, `highlights.removeLine` :392, `highlights.removeGroup` :393, `highlights.partial` :394, `highlights.dodge.*` :395-398, `emphasis.from` :281, `edit.textEmpty` and `edit.textEmptyHint` :153-154.
- With no group in view the tab shows `edit.textEmpty` and its hint "ไปแท็บจุดเน้น แล้วกด “Aa”…" (`HighlightTab.tsx:50`). That is wrong for a beat whose text is all replaced.

## 10. The planner's request

- **`describePoints`** (`core/graphics/direct.ts:552-600`). The band is written at :567-568:
  ```ts
  [point.textBand ? `มีข้อความเด่น [${point.textBand.fromY}, ${point.textBand.toY}]` : "", args.framed.has(i + 1) ? "มีเฟรม" : ""].filter(Boolean).join(" · ")
  ```
  It is appended to the point's line at :596. The subtitle line is :575 ("ซับเริ่มที่ y = … ห้ามทับ").
- **`MOTION_PLAN_PROMPT`** (`core/graphics/motion/direct.ts:11-45`, version :9 `"motion-plan-2026-09-30"`). The lines about highlight text:
  - :13 "… ข้อความเด่นและซับที่ครองพื้นที่อยู่แล้ว และเฟรมของบางจุดแนบท้าย …"
  - :14 "keepClear และแถบข้อความเด่น [บน, ล่าง] = แถบเต็มความกว้าง สัดส่วนความสูงจากขอบบน"
  - :17 "ใส่เฉพาะจุดที่ภาพเคลื่อนไหวช่วยให้คนดูเข้าใจหรือรู้สึกตามได้มากกว่าคำพูดกับข้อความเด่นที่มีอยู่แล้ว …"
  - :20 "- ไม่เหมาะ: … · จุดที่ข้อความเด่นพูดครบแล้วและไม่มีอะไรให้เห็นเพิ่ม · …"
  - :21 "- จุดที่มีข้อความเด่นอยู่แล้ว กราฟิกต้องไม่เขียนคำเดิมซ้ำ ให้แสดงสิ่งที่ตัวหนังสืออย่างเดียวทำให้เห็นไม่ได้"
  - :24 "… ห้ามทับ keepClear ของฉากนั้น ห้ามทับข้อความเด่นที่ขึ้นระหว่างกราฟิกอยู่บนจอ ทั้งของจุดนั้นและจุดถัดไป ห้ามทับพื้นที่ซับ …"
- The writing contract (`core/graphics/motion/write.ts`) says nothing of highlight text.
- **`graphicPoints`** is at `main/graphics-cues.ts:212-235`, called from `flair.ts:530` with the bands of :529 (groups at every level, :525). It fills `textBand` at :232:
  ```ts
  textBand: sentence ? sentence.textBand : mergeBands(textBandsIn(input.bands, { startUs: placed.atUs, endUs: placed.endUs })),
  ```
  - For a speech point this is `textBandOn` (:187, :142-146): every group on the words of the point's sentence in its beat, whichever point it was made for.
  - For a scene point it is every group on screen while the point plays.
- **So the band is not the point's own text.** Two points in one sentence both get the merged band. To tell Claude that its point's text gives way, `GraphicPoint` (`core/graphics/direct.ts:161-182`) needs the own band apart from the others'. That needs the point id on `GroupBand`, the same addition as rule A.
- **Pinned by tests:** `core/graphics/motion/direct.test.ts:727-757`, :820, :868; `core/graphics/direct.test.ts:843`; `main/flair-plan.test.ts:726`.

## 11. Other readers of "which groups are shown"

- **"Aa เน้น" button:** `rend/edit/EmphasisTab.tsx:248` shows it when `point.shown && point.items.text === 0`. `items.text` counts `preview.groups` by point (`highlights.ts:235`). With the replaced group left out, the button returns and makes a second group for the point.
- **Counts:**
  - `counts.text = flair.groups.length` (`byBeat.ts:43`);
  - sidebar marks (`rend/edit/BeatSidebar.tsx:45-51`);
  - tab count `text + zoom + insert + graphic` (`PostScreen.tsx:139`);
  - the `emphasis.items` line (`EmphasisTab.tsx:296`).
- **Write sheet:** `WriteButton.tsx:98` (groups and lines) and :65 (`groupCount`). If replaced groups stay in `groups` with a flag, both must skip them, as must `byBeat.ts:43` and `highlights.ts:235`.
- The sheet's filter for graphics that play, `graphic.written && !graphic.stale` among those not off (`WriteButton.tsx:44-46`), is rule B's condition.
- **`looksInForce`** (`highlight-state.ts:382-399`) is called over the shown groups at `highlights.ts:182`, :264, `timeline.ts:499` and `flair.ts:527`. The four calls must see the same list, or the bands and the written text differ.
- **`heldExits`** (`highlights.ts:184`, `timeline.ts:506`) counts shown groups only, so `proLeftOut.exits` follows.
- **Zoom names and punch:** `zoomSlotsFor` and `punchAtUs` take `timed` (`highlights.ts:441`, `timeline.ts:314`, :322, `flair.ts:681`, :687).
- **Cutaways:** a line anchor finds no slot once its group is gone. Speech anchors do not depend on groups.
- **`slotsFor` by time:** a line's slot wins over a beat start at the same instant (`sound-cues.ts:114-117`). Hiding the group brings that beat-start slot back.
- **Cards and stickers:** stored ones still play and count as written (`graphics-cues.ts:626`). Rule B's `spec.html !== null` exists only on `MotionSpec` (`core/graphics/plan.ts:118-128`).
- **Specs that state the old rule:** `docs/specs/2026-09-30-freeform-motion-design.md:141-142`, `docs/specs/2026-09-27-post-production-design.md:267`.

## Functions to change, and the smallest place for each

**Rule A**
1. `apps/desktop/src/main/graphics-cues.ts`:
   - `GroupBand` :50-57 and `textBands` :93-139: add `pointId?`.
   - `textBandsIn` :149: add the excepted point.
   - `graphicsInForce`: `textIn` :467 takes the graphic's `pointId`; pass `cue.pointId` on :505.
2. `apps/desktop/src/main/highlights.ts` `graphicsOn` :265, :274, and `apps/desktop/src/main/flair.ts:529` for the new `textBands` input. Optionally `packages/core/src/highlights/placement.ts` `PlacedGroup.pointId` (:45-54, set at :91 and :120), which removes the maps at `highlights.ts:177` and `flair.ts:674`.

**Rule B**
3. One predicate beside `graphicJob` (`graphics-cues.ts:568-574`): a kept graphic with a `pointId` that has a job. Plus one filter over `TimedGroup[]`, applied after timing everywhere.
4. `highlights.ts` `view` :172-225:
   - call `graphicsOn` first and filter `timed` after :175;
   - hand the result to `graphicView` in place of the call at :313;
   - correct `hidden` :213, `waits` :372-375 and `items.text` :235.
5. `apps/desktop/src/main/timeline.ts`:
   - take the replaced set from `inForce` :416-422;
   - apply it at :488 (before the check at :489) and at the inner timings :284, :313, :349;
   - apply it in `hiddenFor` :243-246, for both callers (:474, :636).
   - `subtitles()` :631-656 needs the graphics under the saved position and flair. The cheapest way is to hoist `graphicsOn` out of the service closure, since it uses no dependency.
6. `apps/desktop/src/main/post-plan.ts:219-228`: start the polish after the graphics work when text hides subtitles and graphics are on.
7. `apps/desktop/src/main/flair.ts` `planSounds` :672-701: do not offer the lines of replaced groups.
8. `apps/desktop/src/shared/api.ts`: a flag on `HighlightGroupView` :549-566, or a count on `HighlightPreview` :686-749.
9. Renderer:
   - `rend/room/ClipRoom.tsx:555-580`, :684-706, :713-721: read the lines again on the graphics switch, the looks switch and the position.
   - `rend/edit/HighlightTab.tsx:50`, :57-62: the note and the empty state.
   - `rend/edit/EmphasisTab.tsx:248`.
   - `rend/edit/byBeat.ts:43` and `rend/edit/WriteButton.tsx:65`, :98, if flagged groups stay in the list.
   - New keys beside `rend/i18n.ts:394-398`.

**Planner**
10. `packages/core/src/graphics/direct.ts`: `GraphicPoint` :161-182 and `describePoints` :567-568. `apps/desktop/src/main/graphics-cues.ts` `graphicPoints` :212-235. `packages/core/src/graphics/motion/direct.ts` lines :13, :17, :20, :21, :24, and the version at :9.

**To decide before writing the task**
- Do stored cards and stickers replace text, or only motion graphics?
- Do sounds on the hidden lines go quiet, or move to the graphic's start? Does a punch keep landing on the hidden line's moment?
- One pass (a graphic also dodges text that ends up hidden) or repeat until stable?
- Are replaced groups listed with a note and still editable, or left out and counted?
- Is a failed render accepted as "neither text nor graphic"?

**Tests that pin today's behaviour**
- `main/graphics-cues.test.ts:604-676` (text dodge), :131 (`graphicPoints`).
- `main/highlights.test.ts:359` (group count check).
- `main/sound-cues.test.ts:171` (a cue that waits).
- The prompt tests listed in section 10.
