# M12 · Speech inserts — implementation plan

> Spec: `docs/specs/2026-09-20-speech-inserts-design.md`. TDD throughout: failing test → run → implement → run → mutation check (`scratchpad/mutate.py`). No git in this repo; "commit" = the suite green.

**Goal:** a cutaway lands on the sentence — and the word — where the speaker mentions the thing, chosen by Claude or by hand from the speech tab, independent of highlight text.

**Architecture:** one new `CueAnchor` kind, `speech`, whose `sourceUs` is a source time inside a spoken row. Claude is shown the spoken sentences of the rough cut and answers with a sentence number, a picture number and a word; the word is resolved to a source time in core. In main, the sentence list is built by a helper shared with highlight picking, and the "where does this anchor play" question moves behind a `place(anchor)` resolver so speech anchors can be looked up by piece. The renderer adds a `รูป` button to speech rows and a list of inserts to the flair tab.

**Tech:** TypeScript, zod, vitest (core / desktop-main / desktop-renderer jsdom), React 19.

---

## Task 1: the `speech` anchor and its resolution (core)

**Files:** `packages/core/src/flair/plan.ts`, `packages/core/src/flair/direct.ts`, `packages/core/src/flair/direct.test.ts`

- [ ] Add to `CueAnchor`: `| { kind: "speech"; videoId: string; sourceUs: number }`.
- [ ] In `direct.ts` add:

```ts
/** A spoken sentence of the rough cut, as Claude is shown it for cutaways. */
export interface SpeechSlot {
  videoId: string
  beatId: string
  /** where it starts on the rough cut */
  atUs: number
  text: string
  /** its words with their source times, so an answer's word becomes a time */
  words: { text: string; startUs: number }[]
}
```

- [ ] `FlairReplySchema.inserts` becomes `z.array(z.object({ at: z.number().int(), picture: z.number().int(), word: z.string().default("") }))`.
- [ ] `acceptFlair(..., media, sentences: SpeechSlot[] = [])`: for each answer, `sentence = sentences[at - 1]`, `picture = media[picture - 1]`; drop and count when either is missing, the sentence was already given a picture, or the picture already used. `sourceUs` = the start of the first word whose composed text equals the composed answer word (`wordAt(sentence, word)`), else `sentence.words[0].startUs`. Push `{ anchor: { kind: "speech", videoId, sourceUs }, binId, edited: false }`.
- [ ] `describe()`: replace the media part's gating with `sentences.length > 0 && media.length > 0`; add after the pictures: `"", "ประโยคที่แทรกรูปได้", ...sentences.map((s, i) => \`[${i + 1}] ${clock(s.atUs)} “${s.text}”\`)`. The groups part says `ไม่มีชุดข้อความเด่น ตอบ groups เป็นรายการว่าง` when empty.
- [ ] SYSTEM prompt, insert section: `สื่อแทรก: ถ้ามีรายการรูปกับรายการประโยคมาให้ ให้เลือกด้วยว่าประโยคไหนควรตัดไปให้เห็นรูปอะไร ตอบเป็นเลขประโยค เลขรูป และคำในประโยคที่รูปควรขึ้น (ว่างได้ = ต้นประโยค)` + existing rules + `ประโยคหนึ่งแทรกได้รูปเดียว`. `FLAIR_PROMPT_VERSION = "flair-2026-09-20-speech-inserts"`.
- [ ] `planFlair`: early return only when `groups.length === 0 && !(slots.length && sounds.length) && pieces.length === 0 && !(sentences.length && media.length)`.

Tests (add to `direct.test.ts`; `SENTENCES` fixture with two sentences, words with times):

```ts
const SENTENCES: SpeechSlot[] = [
  { videoId: "v1", beatId: "b1", atUs: 0, text: "เล็บสีชมพูลายดอกไม้ ราคา 299", words: [{ text: "เล็บ", startUs: 17_160_000 }, { text: "สีชมพู", startUs: 17_440_000 }, { text: "ลายดอกไม้", startUs: 18_080_000 }, { text: "ราคา", startUs: 19_000_000 }, { text: "299", startUs: 19_780_000 }] },
  { videoId: "v1", beatId: "b2", atUs: 4_400_000, text: "ทักมาได้เลย", words: [{ text: "ทัก", startUs: 22_620_000 }, { text: "มา", startUs: 23_880_000 }, { text: "ได้เลย", startUs: 24_840_000 }] },
]
```

- "a cutaway answer lands on the word of the sentence it names" → `{ at: 1, picture: 1, word: "สีชมพู" }` gives anchor `{ kind: "speech", videoId: "v1", sourceUs: 17_440_000 }`, dropped 0.
- "with no word, or one the sentence does not say, the cutaway starts with the sentence" → `word: ""` and `word: "ฟรี"` both give `sourceUs: 17_160_000`, dropped 0.
- "one sentence and one picture are each used once, and unknown numbers are dropped" → mirrors the old test with sentences.
- "the prompt lists the spoken sentences with their times" → contains `[2] 0:04.4 “ทักมาได้เลย”`.
- "with no highlight text Claude is still asked when there are pictures to place" → `planFlair({ groups: [], sentences: SENTENCES, media: MEDIA })` makes one request whose text contains `ไม่มีชุดข้อความเด่น`; with nothing at all no request is made.
- Update the two old insert tests to use sentences instead of `SLOTS`.

Mutations: drop the word lookup (always sentence start) · skip the "sentence used" check · skip the "picture used" check · early return whenever groups are empty.

## Task 2: `spokenSentences` — one walk of the rough cut's speech (main)

**Files:** `apps/desktop/src/main/spoken.ts` (new), `apps/desktop/src/main/spoken.test.ts` (new), `apps/desktop/src/main/highlights.ts`

```ts
export interface SpokenSentence extends HighlightSentence {
  /** the row's words with their source times */
  words: { text: string; startUs: number }[]
}

/** Every sentence the rough cut plays (used, or kept by the user), in playing order, with where it starts on the timeline. */
export function spokenSentences(input: {
  plan: CutPlan
  wordsOf: (videoId: string) => { text: string; startUs: number; endUs: number }[]
  beatNames: Map<string, string>
  at: (cut: number, sourceUs: number) => number
}): SpokenSentence[]
```

Body = the loop in `highlights.pick()` (rows with `state !== "cut"` and `toggle.type === "words"`, piece found by the first word's midpoint), plus `words: indexes.map(i => ({ text, startUs }))`. `pick()` calls it. Sort by `timelineUs`.

Test with the fixture from `timeline-fixture.ts` through `setup()` + `service.compiled()` (see how `flair.test` gets `plan`): the sentences are the used rows only, in order, the first one's words start with ขึ้น at 17.16 s, and a row the user cut (`setCutDecision` words keep:false) disappears.

## Task 3: `placeOf` — where an anchor plays (main)

**Files:** `apps/desktop/src/main/insert-media.ts`, `apps/desktop/src/main/insert-media.test.ts`

```ts
export interface Place { atUs: number; what: string; beatId: string }

/** Where each kind of anchor plays on this rough cut: points by their slot, speech by the piece that holds its source time. */
export function placeOf(input: { slots: CueSlot[]; sentences: SpokenSentence[]; plan: CutPlan; at: (cut: number, sourceUs: number) => number }): (anchor: CueAnchor) => Place | null
```

Speech: find `cutIndex` where `plan.cuts[i].binId === videoId && sourceStartUs <= sourceUs < sourceStartUs + sourceDurationUs`; `beatId` from the beat that owns that cut (same `beatOf` walk as `slotsFor`); `what` = the sentence of that video whose words span `sourceUs` → `ที่ “text” ตรงคำว่า “word”` when a word starts exactly at `sourceUs`, else `ที่ “text”`; no sentence → `ที่ ${clock}`.

`insertsInForce({ inserts, place, media, flair, durationUs })` — `place` instead of `slots`; a null place is a dropped insert. Update its existing tests to pass `place: placeOf({ slots, sentences: [], plan: EMPTY_PLAN, at })`.

Tests: speech anchor inside a piece → atUs from `at`, what names the word · between pieces (cut away) → null · unknown video → null · point anchors still resolve through slots.

## Task 4: wire main — plan, preview, write, api

**Files:** `apps/desktop/src/main/flair.ts`, `apps/desktop/src/main/highlights.ts`, `apps/desktop/src/main/timeline.ts`, `apps/desktop/src/main/highlight-api.ts`, tests `flair.test.ts`, `highlight-api.test.ts`

- `flair.plan()`: `const sentences = options.flair.insert && pictures.length > 0 ? spokenSentences({...}) : []`; pass `sentences` to `planFlair`; store `planned.inserts` as before.
- `highlights.insertView` and `timeline.insertCutaways`: build `place = placeOf({ slots, sentences: spokenSentences(...), plan, at })` and call `insertsInForce({ ..., place })`; the view's `what`/`beatId` come from `place(anchor)`.
- `checkedAnchor`: `if (anchor?.kind === "speech" && typeof anchor.videoId === "string" && Number.isInteger(anchor.sourceUs) && anchor.sourceUs >= 0) return { kind: "speech", videoId: anchor.videoId, sourceUs: anchor.sourceUs }`.

Tests in `flair.test.ts` (fixture words: ขึ้น 17.16 · อวกาศ 18.08 · second countdown สาม 22.62):
- "Claude cuts away at the word it names, and the preview says where" → reply `{ at: 1, picture: 1, word: "อวกาศ" }`; `preview.inserts[0]` has anchor `{ kind: "speech", videoId, sourceUs: 18_080_000 }`, `what` contains `“อวกาศ”`, `atUs` = timeline of 18.08 s.
- "a cutaway put on a sentence by hand survives planning, and comes off by its own anchor".
- "a sentence the user cuts takes its cutaway with it" → `setCutDecision` the second row keep:false → preview has no insert on it.
- "the write puts the cutaway at the word's time" → overlay segment start ≈ atUs.
- "with no highlight text Claude still plans the cutaways" → clear the groups (`removeGroup`) and plan; request made, inserts present.
- `highlight-api.test`: a speech anchor passes with only its own fields; a negative or fractional `sourceUs` is refused.

## Task 5: renderer — the `รูป` button, the inserts list, the AI menu

**Files:** `edit/SpeechTab.tsx`, `edit/FlairTab.tsx`, `screens/EditScreen.tsx`, `i18n.ts`, `styles/edit.css`, `screens/EditScreen.test.tsx`

- `SpeechTab` props: `inserts?: InsertView[]`, `media?: HighlightPreview["media"]`, `onInsert?: (anchor: CueAnchor, binId: string | null) => void`. A row with text and `state !== "cut"` gets, when `onInsert && media.length > 0`, a `รูป` xs button (`aria-label` `t("inserts.pickLabel", { text })`) that opens a `Popover` (row gets `position: relative` via `.speech-actions.look-anchor`) listing `t("flair.insert.none")` and every picture as buttons (`.ai-items` layout). Chosen → `onInsert(existing?.anchor ?? { kind: "speech", videoId: cut.videoId, sourceUs: row.startUs }, binId)`. `existing` = the beat's insert with a speech anchor on this video whose `sourceUs` ∈ [row.startUs, row.endUs). A row with one shows `<span className="mark insert">🖼 {picture}</span>` after the quote.
- `FlairTab`: points section keeps the sound select only. New section `t("edit.flairInserts")` listing `flair.inserts` rows: time · `insert.picture` · `insert.what` · `เอาออก` xs button → `onInsert(insert.anchor, null)`; `options.insert && media.length > 0 && flair.inserts.length === 0` → hint `t("inserts.pickHint")`. The `nothing` check counts inserts too.
- `EditScreen`: pass `inserts`, `media`, `onInsert` to `SpeechTab` (only when `flair?.insert`); AI menu: `nothingToPlan = !preview || (preview.groups.length === 0 && preview.media.length === 0 && preview.pieces.length === 0 && !(preview.slots.length && preview.sounds.length))` → `t("edit.ai.nothing")`.
- i18n: `inserts.pick` "รูป", `inserts.pickLabel` "แทรกรูปที่ \"{text}\"", `inserts.pickHint` "เลือกรูปให้ประโยคได้จากปุ่ม รูป ในแท็บคำพูด", `edit.flairInserts` "สื่อแทรกในบีต", `inserts.remove` "เอาออก", `edit.ai.nothing` "ยังไม่มีอะไรให้จัด — ต้องมีข้อความเด่น รูปในกรุสื่อ เสียง หรือชิ้นที่ซูมได้". Drop `edit.ai.noGroups`.

Tests in `EditScreen.test.tsx` (extend `withFlair` preview with `media` and a speech insert on the first row):
- "a used sentence can be given a picture from its own row, and the choice is saved" → click `รูป` on the first row, choose "เล็บสีชมพู" → `setInsert(FOLDER, { kind: "speech", videoId: "a", sourceUs: <row start> }, "m1")`.
- "a row that has a picture says which, and taking it off sends its own anchor" → mark text on the row; in the flair tab click เอาออก → `setInsert(FOLDER, <stored anchor>, null)`.
- "the flair tab no longer offers pictures on points" → no combobox named `flair.insert.label`.
- "Claude can be asked to plan with pictures alone" → preview with no groups but media → AI menu item enabled; with nothing at all → disabled with `edit.ai.nothing`.

## Outcome (2026-09-20)

Done as planned, TDD with mutation checks on every changed file (`direct.ts`, `spoken.ts`, `insert-media.ts`, `flair.ts`, `SpeechTab.tsx`, `EditScreen.tsx`; no survivors — two mutants of `spokenSentences` turned out equivalent and one was resolved by dropping a redundant sort). 992 tests pass, typecheck clean.

What changed from the plan while doing it:

- `SpeechSlot` (what Claude is shown) and `SpokenSentence` (what main builds from the rough cut) are two shapes: the second carries `endUs`, `beatName`, `from`/`to` and `timelineUs` for highlight picking; `flair.plan()` maps it down. `SpokenSentence.endUs` is what lets `placeOf` say which sentence a moment between two words belongs to.
- `acceptFlair` tolerates a reply with no `word` field at all (a transport that skips the schema's defaults), so the main-process fake transport did not need to parse.
- Thai rows are joined without spaces (`ขึ้นไปในอวกาศใน`), which the tests had to learn.
- The first piece's edge snaps to quiet a little before the first word, so a sentence's `timelineUs` is not 0 even at the start; tests compare against `at(0, wordStart)` instead of a literal.

Checked in the real app on 0917 (its bin was given the two nail photos from 0815 through `scratchpad/hl/add-bin.mts`, backed up in `scratchpad/hl/backup-m12` and restored afterwards; nothing written to the draft): every used row of the speech tab has a `รูป` button; the popover lists "ไม่แทรก" and both pictures by what Claude saw in them; choosing one puts `🖼 …` on the row and `🖼 1` on the beat card; the flair tab's new section reads `ที่ “เอาละครับวันนี้” ตรงคำว่า “เอาละ” · 2.0 วิ · คุณตั้งเอง · เอาออก`; the points section offers sounds only. `ให้ AI แต่ง → จัดลูกเล่น` ran against Claude Code with the sentence list in the prompt and **placed no picture** — the clip is about astronauts and the pictures are nails, which is the rule working — while the hand-placed one survived. Taking it off from the flair tab cleared it.

Known limits: the whole flair preview still rides on the highlight-text *switch* (`previewHighlights` is the one call that carries flair), so with ข้อความเด่น turned off in the clip settings there are no cutaways either — "no highlight text needed" means no groups picked, not the kind switched off. Claude still needs a sentence to be on the rough cut; a picture that fits no sentence is not placed, by design.

## Task 6: docs, real app, DMG

- Master spec `docs/specs/2026-09-17-capcut-timeline-manager-design.md` §6: M12 entry.
- Real app on 0917 (its bin has the two nail photos from M10.4 — check `draft_meta_info.json`; put them back if gone, with a backup first): speech tab `รูป` → popover → pick; flair tab list; `ให้ AI แต่ง → จัดลูกเล่น` with highlight text off. No write to the draft.
- `npx vitest run`, `npx tsc --noEmit`, `npm run dist:local -w apps/desktop`.
