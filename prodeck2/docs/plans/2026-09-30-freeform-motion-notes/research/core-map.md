Root: `/Users/ford/Desktop/Thalent Ai/excp/prodeck2/packages/core` (paths below are relative to `src/` unless absolute). Nothing was modified.

## 1. `src/graphics/` (6 source files, 5 test files)

**`index.ts`** (6 lines): re-exports everything. Nobody imports the bare `@boxblack/core/graphics`.

**`plan.ts`** (194 lines) — only import is `CueAnchor, Tone` from `../flair/plan.ts`.
- Kit-specific (delete or replace):
  - `PIECE_KINDS`/`PieceKind` :3-4, `GRAPHIC_INS`/`GRAPHIC_OUTS` :5-8, `ICONS`/`LEGACY_ICONS` :10-12
  - `STICKER_MOTIONS` :15, `STICKER_SIZE` :23, `CROSSING_MOTIONS`/`crossesKeepClear` :29-33, `STICKER_ROOM` :40 (mirrors `timeline.js`)
  - `GraphicPiece` :59-74 (`atS`, `untilS`, `items[].atS`, `target`, `size`, `icon`)
  - `CardSpec` :86-92, `StickerSpec` :95-101, `GraphicSpec` union :103
  - `isSticker` :105, `piecesOf` :107, `iconEmoji` :109, `upgradeSpec` :112, `settledMotion` :169-176
  - `GRAPHIC_TEXT_MAX`=60, `GRAPHIC_ITEM_MAX`=40, `GRAPHIC_UNIT_MAX`=12 :143-145
- Generic (keep):
  - `GraphicBox` :51 (x0,y0,x1,y1 as frame shares)
  - `GraphicBase` :76-83 (`version`, `box`, `seconds`, `why`; not exported)
  - `GraphicCue` :117-127 (`anchor`, `spec`, `edited`, `off`, `pointId?`)
  - `PlacedGraphic` :130-136 (`cue`, `atUs`, `durationUs`; `storedMotion?` is kit-only)
  - `GRAPHIC_MIN_US`=1_500_000 :139, `GRAPHIC_MAX_S`=6 :141
  - `clipText` :153 (grapheme-safe cut)
  - `enforceGraphics(graphics, durationUs)` :184-194: filters `off`, trims to timeline end, drops under 1.5 s, returns `{kept, dropped}`.

**`direct.ts`** (676 lines)
- Prompt: `GRAPHICS_PROMPT_VERSION` :35; `SYSTEM` (Thai) :51-103; `GRAPHICS_PROMPT` :105. Almost all of it is card/sticker rules.
- Schema: `PieceSchema` :107-119; `GraphicsReplySchema` :121-142 (`kind`, `point`, `word`, `seconds`, `why`, `box[4]`, `tone`, `in`, `out`, `pieces`, `emoji`, `motion`, `size`); `GraphicsReply` :143.
- Input types (generic): `GraphicSentence` :146-158 (extends `SpeechSlot`; `words: {text, startUs, timelineUs}[]`, `timelineEndUs`, `scene`, `textBand`); `GraphicPoint` :161-182; `ExistingGraphic` :539-544.
- Limits: `MIN_BOX` :186, `MAX_BOX` :188, `MAX_CROSSING_BOX` :193, exported `MAX_PIECES`=3 :195, `MAX_BARS`=4 :197, `MAX_CHECKS`=5 :198, `MAX_FRAMES`=12 :203, `cardAnchored` :210.
- Word matching (generic, reusable): `saidOf` :227, `findWord` :251, `wordAt` :264, `secondsOfChar` :270, `Scope` :278, `secondsOf` :289, `itemTimes` :296, `startOf` :415-426.
- Kit validators: `boxOf` :213, `targetOf` :223, `stickerOf` :306, `pieceOf` :315-369, `capped` :377.
- `acceptGraphics(reply, points, framed, taken, known)` :446-503 returns `{ graphics: GraphicCue[]; dropped: number }`. There is no kept count; kept is `graphics.length`. Rules:
  - Whole graphic dropped (+1): unknown point, bad box, point already filled or in `taken` :460; `startOf` null (sentence has no words) :465; sticker fails `stickerOf` (emoji not in `known`, unknown motion) :474; card has no pieces or is not `anchored` :488.
  - Kept card adds `answer.pieces.length - pieces.length` to `dropped` :492.
  - `seconds` clamped to 1.5–6, default 3 :469.
  - Anchor is always `{kind:"speech", videoId, sourceUs, beatId}` :470.
  - Stamps `KIT_VERSION` and `pointId` :479, :496.
- Frames (generic): `frameKey` :506, `framesToAttach` :518-530.
- `describe` :546-625 (not exported): brief, canvas orientation, caption line, one line per point (clock, length, label, phrase, reason, textBand, framed, scene/keepClear), user's existing graphics, sticker room table :589-598 (kit-specific).
- `planGraphics` :628-676: returns empty when every point is taken :648; reads frames as base64; one `transport.generate` with `maxTokens: 16_000`; returns `acceptGraphics(...)`.

**`framing.ts`** (126 lines)
- Generic: `PixelBox` :3, `placeOnCanvas` :94-100 (CapCut scale/transform), `mergeBands` :103, `KEEP_CLEAR_GAP` :109, `dodgeKeepClear` :119-126.
- Kit-tuned: `PointerTarget` :15, `RENDER_MARGIN`=0.08 :30, `RENDER_MARGIN_PX`=80 :32, `RENDER_MARGIN_BOTTOM_PX`=128 :38, `POINTER_REACH` :43, `renderBox(box, targets, canvas)` :62-87.
- In `renderBox`, the even-pixel rounding and canvas clamp are generic; the margins (card pop overshoot, shadow, rise/drop) and the `targets` widening are the kit's.

**`emoji.ts`** (106 lines)
- Generic if emoji pictures stay: `EMOJI_SET` :11, `EmojiSet` :14, `keyOfCodepoints` :36, `emojiKey` :58, `plainEmoji` :68, `WrongEmojiSetError` :74, `readEmojiSet` :77.
- Spec-coupled: `drawsEmoji` :92, `imageFiles` :99 (walk `GraphicSpec`).

**`kit/version.ts`**: `KIT_VERSION = "kit-2026-09-25-2"` :2, stamped on specs and part of the render hash.

**`kit/html.ts`** (106 lines): `GraphicAssets` :12-17, `kitAssets(dir)` :24-30 (reads `timeline.js`, `kit.js`, `kit.css`), `graphicColours` :39-49, `inScript` :56 (base64 JSON, so no spec text reaches page source), `graphicHtml` :67-106. The wrapper shell is reusable: `@font-face`, `:root` CSS vars, `#root` with `data-composition-id`/`data-duration`/`data-width`/`data-height`/`data-fps`, `#stage.clip`. `window.__SPEC` :96 and the inlined kit scripts are kit-specific.

## 2. Importers

Core, outside `graphics/`: only `emphasis/filter.test.ts:6` (type `GraphicCue`). `capcut/graphics.ts:17` mentions `placeOnCanvas` in a comment only.

Desktop (`/Users/ford/Desktop/Thalent Ai/excp/prodeck2/apps/desktop/src`):
- **`graphics/plan`**
  - `shared/api.ts:9` (`GraphicCue, GraphicSpec, StickerMotion`)
  - `main/flair.ts:16` (`clipText`, `GRAPHIC_*`, `isSticker`, `STICKER_MOTIONS`, `GraphicCue`, `GraphicPiece`, `PlacedGraphic`)
  - `main/graphics-cues.ts:9-22` (`enforceGraphics`, `GRAPHIC_MIN_US`, `iconEmoji`, `isSticker`, `settledMotion`, `upgradeSpec`, types)
  - `main/graphics-render.ts:8`, `main/sound-cues.ts:8`, `main/highlight-api.ts:6`, `main/timeline.ts:62`, `main/highlights.ts:48`
  - `renderer/src/edit/GraphicSheet.tsx:2-14`
  - Tests: `PostScreen.test.tsx`, `WriteButton.test.tsx`, `post-flow.test.ts`, `graphics-kit.test.ts`, `sound-cues.test.ts`, `highlights.test.ts`, `graphics-render.test.ts`, `post-cleanup.test.ts`, `flair-plan.test.ts`, `graphics-cues.test.ts`, `timeline.test.ts`, `flair.test.ts`, `emphasis.test.ts`
- **`graphics/direct`**: `main/flair.ts:14` (`planGraphics`, `GraphicPoint`); `main/graphics-cues.ts:6` (`cardAnchored`, `frameKey`, `framesToAttach`, `ExistingGraphic`, `GraphicPoint`, `GraphicSentence`); `main/highlight-api.ts:5` (`MAX_BARS`, `MAX_CHECKS`, `MAX_PIECES`); tests `post-flow`, `flair-plan` (`GRAPHICS_PROMPT`), `graphics-cues` (`frameKey`).
- **`graphics/framing`**: `main/graphics-render.ts:6` (`placeOnCanvas`, `renderBox`, `PixelBox`); `main/graphics-cues.ts:7` (`dodgeKeepClear`, `KEEP_CLEAR_GAP`, `mergeBands`); `graphics-render.test.ts:8`.
- **`graphics/emoji`**: `main/graphics-render.ts:5`, `main/flair.ts:15`, `main/index.ts:9` (`readEmojiSet`); tests `graphics-render` (mocks the module :33), `flair`.
- **`graphics/kit`**: `main/graphics-render.ts:7` (`graphicHtml`, `KIT_VERSION`, `GraphicAssets`); `main/index.ts:8` (`kitAssets`); tests `graphics-kit`, `graphics-render`.
- **`capcut/graphics`**: `main/timeline.ts:60` (`addGraphicTrack`, `TimelineGraphic`).

## 3. CapCut writer — fully kit-independent

- `capcut/graphics.ts:6-19` `TimelineGraphic`: `atUs`, `durationUs`, `binId`, `path`, `name`, `width`, `height`, `durationOfFileUs`, `place {scale, x, y}`.
- `addGraphicTrack(info, graphics)` :35-65 returns `Written` (`info`, `kept`, `dropped`). It snaps to frames, caps at the file's whole frames :45-46, gives up one shared frame on touching graphics :52-53, and uses `RENDER_INDEX_BASE = 1000` :22.
- `capcut/overlays.ts:7-16` `OverlayPiece`; `addOverlayTracks` :27-77: silent video material, lanes via `laneOf`, `clip.scale`/`transform` from `place`, track `flag: 2`.
- `capcut/bin.ts:12` `graphicBinItem({id, path, width, height, durationUs, nowMs})`; `RENDERED_GRAPHICS_FOLDER` :40; `isRenderedGraphic` :43, used by `capcut/projects.ts:76` and `flair/media.ts:52`.
- Desktop builds the metadata at `main/graphics-render.ts:323`: `{width, height, durationUs: spec.seconds*1e6, place: placeOnCanvas(box, canvas)}`. A free-form graphic needs only a box, seconds and a rendered file.

## 4. Interactions with other core modules

- **Options and levels**: `FlairOptions.graphic` is in `flair/catalogue.ts:8-24`, not `flair/plan.ts` (default `graphic: false`; `FLAIR_LEVELS` :4). There is no `passes` in `flair/plan.ts`. The level filter is `passesLevel` `emphasis/types.ts:84`, `LEVEL_IMPORTANCE` :81, and `pointFilter(placed, level)` `emphasis/filter.ts:118-121`, which reads only `pointId`.
- **`flair/plan.ts`**: supplies `Tone`/`TONES` :14-15 and `CueAnchor` :80-86 to graphics. It has no graphic code; `enforceGraphics` lives in `graphics/plan.ts`.
- **Sound**: `flair/sound-plan.ts` has no graphics import; the prompt mentions "กราฟิกขึ้น" :11; `SoundSlot` :28 extends `CueSlot` (`flair/direct.ts:43-51`, whose `what` is free text). The graphic sound slots are built in desktop `main/sound-cues.ts:8` (uses `isSticker`, `PlacedGraphic`).
- **Emphasis**: `StoredEmphasis.plannedOn.graphics` `emphasis/types.ts:36`, :55. `placePoints` `emphasis/filter.ts:104-112` returns `PlacedPoint` (`atUs`, `endUs`, `sourceUs`, `cut`, `beatId`) :8-20.
- **Anchor → atUs**: not in core. It is in desktop `main/graphics-cues.ts`: `graphicsInForce` :386-463 (uses `upgradeSpec` :412, `cardAnchored` :416, `settledMotion` :457, `enforceGraphics` :463) and `graphicPoints` :193.
- **Word timing**:
  - `SpeechSlot.words {text, startUs}` at `flair/direct.ts:54-62`; `GraphicSentence.words` adds `timelineUs` (`graphics/direct.ts:152`).
  - `timelineUs` is filled in desktop at `main/graphics-cues.ts:179`.
  - Seconds from graphic start: `(word.timelineUs - startTimelineUs)/1e6`, null if past `seconds` (`secondsOfChar`, `graphics/direct.ts:270-275`); start word chosen in `startOf` :415-426.
  - Times are baked into `piece.atS`/`untilS`/`items[].atS` at plan time (`pieceOf` :319, :334, `itemTimes` :296). The kit only reads them from `__SPEC`.
  - Shared helpers: `clock` `flair/direct.ts:123`, `pointLabel` :132, `comparable` `thai.ts:5`.

## 5. Palette and fonts

- `highlights/styles.ts`: `Palette {text, accent, alt, bar}` :17-26 (`Rgb`, channels 0–1); `HIGHLIGHT_FONTS` :42-46 (`Kanit-ExtraBold.ttf`, `Mali-Bold.ttf`, `Chonburi-Regular.ttf`); `HighlightStyle` :73-86 (`font`, `strokeWidth`, `barRoundness`, `palette`); `HIGHLIGHT_STYLES` :100-151 (5 styles); `styleFor(id, custom)` :157-160; `accentOnBar` :163.
- `highlights/colour.ts`: `READABLE`=3 :9, `contrast` :19, `strokeFor`/`onSurface` :27-32, `readableAccent` :40, `hexOf` :45, `rgbOf` :48.
- `graphicColours(palette, tone)` `graphics/kit/html.ts:39-49` returns `{text, colour, pointer, outline}`.
- CSS vars emitted at :88: `--text`, `--colour`, `--bar`, `--pointer`, `--pointer-outline`, `--font`, `--w`, `--h`. Font via `@font-face` by file name :87; the file is copied beside the page by desktop.

## 6. Tests

Under `graphics/`:

| File | Tests | Fate |
|---|---|---|
| `direct.test.ts` (1133 lines) | 84 | Nearly all card/sticker; rewrite. Keep-worthy: word matching (:116-187, :364-397), frames (:880-962, :1040), describe (:835-865, :974-1024), point start (:1093-1126) |
| `plan.test.ts` | 14 | `clipText` :27-44 and `enforceGraphics` :50-81 (9) survive; :89-123 (5) are kit |
| `framing.test.ts` | 18 | `placeOnCanvas` (3) and dodge/merge (6) are generic; `renderBox` (9), of which 5 are pointer-target |
| `emoji.test.ts` | 8 | 6 generic; :90, :99 are spec-coupled |
| `kit/html.test.ts` | 10 | All kit; the `graphicColours` ones (:64, :87) are reusable if tones stay |

Other core tests:
- `emphasis/filter.test.ts:208-215`: one `StickerSpec` literal in a type-check test; small edit.
- `capcut/graphics.test.ts` (14): no spec, untouched.
- `flair/sound-plan.test.ts`: a comment only.
- The "sticker" hits in `capcut/highlights.test.ts` are CapCut sticker tracks, unrelated.

## 7. `package.json` exports

`/Users/ford/Desktop/Thalent Ai/excp/prodeck2/packages/core/package.json`
- :44 `./graphics` → `src/graphics/index.ts`
- :45 `./graphics/plan`
- :46 `./graphics/framing`
- :47 `./graphics/direct`
- :48 `./graphics/emoji`
- :49 `./graphics/kit/version`
- :50 `./graphics/kit` → `src/graphics/kit/html.ts`
- :10 `./capcut/graphics` and :11 `./capcut/bin` are generic and stay.