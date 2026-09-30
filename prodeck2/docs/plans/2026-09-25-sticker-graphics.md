# M24 · Sticker graphics (Fluent 3D emoji) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Spec: `docs/specs/2026-09-25-sticker-graphics-design.md`. TDD throughout: failing test → run → implement → run → mutation check (`<scratchpad>/mutate.py <src> <list.json> <tests…>`, lists under `<scratchpad>/mut3/`; never run it while another vitest run or a reviewer is going). No git in this repo; "commit" = the whole suite green (`npm test`) and `npm run typecheck` clean. Reply to the user in Thai. Draft `0917` only, backed up and restored; `0815`, `0923`, `0925`, `0925 (1)` are read-only. `<scratchpad>` = `/private/tmp/claude-501/-Users-ford-Desktop-Thalent-Ai-excp-prodeck2/f297d1d6-b448-49ed-8563-d0f74dd57a87/scratchpad`.

**Goal:** a second kind of graphic — a Fluent 3D emoji that moves inside its box (fly up, fly across, rain, bounce, float, spin, pop) — which Claude picks when speech names a thing, an action or a feeling; cards must now carry a number, bars or checks, and their icons become 3D emoji.

**Architecture:** `GraphicSpec` becomes a union `CardSpec | StickerSpec` (a spec with no `kind` is a card, so stored outlines read unchanged). A new core module `graphics/emoji.ts` turns an emoji into the file name of its picture and reads the shipped set. The pictures (1,595 PNGs, 54 MB) ship in `resources/graphics/emoji/` beside the kit, fetched once by a script at a pinned commit. The kit gains pure sticker geometry in `timeline.js` and a sticker branch in `kit.js`; the renderer copies the pictures next to the page as it does the font. Claude's prompt, schema and acceptance learn the new kind; main upgrades old icon names, validates emoji on save, and the sheet edits emoji and motion.

**Tech Stack:** TypeScript on Node 26 (native TS), zod, vitest (core / desktop-main / desktop-renderer jsdom), React 19, plain JS kit run by HyperFrames 0.8.65 in Chrome headless shell 152, Fluent Emoji (MIT) at `microsoft/fluentui-emoji@1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`.

**Order:** 1 → 2 → 3 (pictures must exist before 3's release-check test and before 6/10/11) → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Each task leaves `npm test` and `npm run typecheck` green.

---

## File map

| Area | File | Change |
|---|---|---|
| core | `packages/core/src/graphics/plan.ts` | `CardSpec`/`StickerSpec` union, `STICKER_MOTIONS`, `STICKER_SIZE`, `LEGACY_ICONS`, `isSticker`, `piecesOf`, `iconEmoji`, `upgradeSpec`; `GraphicPiece.icon` becomes `string` |
| core | `packages/core/src/graphics/emoji.ts` (new) | `EMOJI_SET`, `keyOfCodepoints`, `emojiKey`, `readEmojiSet`, `imageFiles` |
| core | `packages/core/src/graphics/direct.ts` | prompt, schema (`kind`, `emoji`, `motion`, `size`), `acceptGraphics(…, pictures)`, `planGraphics({ known })` |
| core | `packages/core/src/graphics/kit/html.ts`, `kit/version.ts`, `index.ts`, `packages/core/package.json` | `images` payload, sticker colours, bump, export |
| kit | `apps/desktop/resources/graphics/timeline.js`, `kit.js`, `kit.css` | sticker geometry, sticker branch, emoji icons |
| pictures | `apps/desktop/resources/graphics/emoji/` (new) | 1,595 PNG + `index.json` + `FLUENT-EMOJI-LICENSE` |
| scripts | `apps/desktop/scripts/fetch-fluent-emoji.mts` (new), `release-check.ts`, `graphics-kit-check.mjs` | fetch, check, visual check |
| main | `graphics-render.ts`, `graphics-cues.ts`, `flair.ts`, `highlights.ts`, `highlight-api.ts`, `index.ts` | copy pictures + hash; upgrade, read-time rules, summary; known + save checks; canvas; patch validation; wiring |
| shared | `apps/desktop/src/shared/api.ts` | `GraphicPatch.emoji`, `.motion`, `pieces[n].icon` |
| renderer | `edit/GraphicSheet.tsx`, `screens/EditScreen.tsx`, `i18n.ts` | sticker fields, emoji icon field, save errors, texts |
| docs | spec, main spec §6/§7, memory, `apps/desktop/package.json` 0.3.0 | wrap-up |

---

## Task 1: the spec union and the old icon names

**Files:**
- Modify: `packages/core/src/graphics/plan.ts` (lines 10–48)
- Modify: `packages/core/src/graphics/kit/html.ts` (line 76)
- Modify: `apps/desktop/src/main/graphics-render.ts` (lines 7, 168–172)
- Modify: `apps/desktop/src/main/graphics-cues.ts` (lines 6, 337–374)
- Modify: `apps/desktop/src/main/flair.ts` (`changedGraphic`, line ~96)
- Modify: `apps/desktop/src/renderer/src/edit/GraphicSheet.tsx` (line 83)
- Test: `packages/core/src/graphics/plan.test.ts`, `apps/desktop/src/main/graphics-cues.test.ts`; typecheck fixes in `packages/core/src/graphics/direct.test.ts`, `apps/desktop/src/main/flair.test.ts`, `apps/desktop/src/renderer/src/screens/EditScreen.test.tsx`

- [ ] **Step 1: write the failing tests** — append to `packages/core/src/graphics/plan.test.ts` (extend its import with `iconEmoji, isSticker, LEGACY_ICONS, piecesOf, upgradeSpec, type CardSpec, type StickerSpec`):

```ts
const CARD: CardSpec = { version: "kit-1", box: { x0: 0.1, y0: 0.55, x1: 0.9, y1: 0.75 }, seconds: 3, tone: "base", in: "pop", out: "fade", why: "", pieces: [{ kind: "number", from: 0, to: 5, atS: 0 }, { kind: "icon", icon: "star", atS: 0 }] }
const STICKER: StickerSpec = { kind: "sticker", version: "kit-1", box: { x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.8 }, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "" }

test("a spec with no kind is a card, so outlines stored before stickers read as they always did", () => {
  expect(isSticker(CARD)).toBe(false)
  expect(isSticker({ ...CARD, kind: "card" })).toBe(false)
  expect(isSticker(STICKER)).toBe(true)
  expect(piecesOf(CARD)).toBe(CARD.pieces)
  expect(piecesOf(STICKER)).toEqual([])
})

test("an icon named before icons were emoji is drawn as its emoji; an emoji, or any other text, is left as it is", () => {
  expect(Object.keys(LEGACY_ICONS)).toEqual(["star", "heart", "check", "cross", "warning", "money", "clock", "fire", "up", "down", "gift", "cart"])
  expect(iconEmoji("star")).toBe("⭐")
  expect(iconEmoji("cart")).toBe("🛒")
  expect(iconEmoji("🚀")).toBe("🚀")
  // names an object has of its own are not icons
  expect(iconEmoji("constructor")).toBe("constructor")
  expect(iconEmoji("toString")).toBe("toString")
})

test("upgradeSpec turns a card's old icon names into emoji, and hands back the same spec when there is nothing to change", () => {
  expect(upgradeSpec(CARD)).toEqual({ ...CARD, pieces: [CARD.pieces[0], { kind: "icon", icon: "⭐", atS: 0 }] })
  expect(CARD.pieces[1]!.icon).toBe("star")
  const already = { ...CARD, pieces: [CARD.pieces[0]!, { kind: "icon" as const, icon: "⭐", atS: 0 }] }
  expect(upgradeSpec(already)).toBe(already)
  expect(upgradeSpec(STICKER)).toBe(STICKER)
})
```

Append to `apps/desktop/src/main/graphics-cues.test.ts` (next to the existing `summaryOf` test at line ~396):

```ts
test("a sticker is summed up by its emoji and how it moves; a card's icon by its emoji, an old name included", () => {
  expect(summaryOf({ kind: "sticker", version: "k", box: SPEC.box, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "" })).toBe("สติกเกอร์ 🚀 พุ่งขึ้น")
  expect(summaryOf({ kind: "sticker", version: "k", box: SPEC.box, seconds: 3, emoji: "💸", motion: "rain", size: 0.2, why: "" })).toBe("สติกเกอร์ 💸 โปรย")
  const card = { ...SPEC, pieces: [{ kind: "number" as const, from: 0, to: 5, atS: 0 }, { kind: "icon" as const, icon: "star", atS: 0 }, { kind: "icon" as const, icon: "🔥", atS: 0 }] }
  expect(summaryOf(card)).toBe("ตัวเลขวิ่ง 0 → 5 · อีโมจิ ⭐ · อีโมจิ 🔥")
})
```

(`SPEC` in that file is a card spec; if it is typed `GraphicSpec`, type it `CardSpec`.) The existing summary tests at `graphics-cues.test.ts:409` ("… · ไอคอน เปลวไฟ · …") and `:412–414` ("an icon piece shows its Thai name", "ไอคอน กากบาท") change to `อีโมจิ 🔥` and `อีโมจิ ❌`.

- [ ] **Step 2: run them to see them fail**

Run: `npx vitest run packages/core/src/graphics/plan.test.ts apps/desktop/src/main/graphics-cues.test.ts`
Expected: FAIL — `isSticker`, `piecesOf`, `iconEmoji`, `LEGACY_ICONS`, `upgradeSpec` are not exported; the summary still says "ไอคอน ดาว".

- [ ] **Step 3: implement in `plan.ts`** — replace lines 10–11 (`ICONS`/`IconName`) and the `GraphicPiece.icon` and `GraphicSpec` declarations with:

```ts
/** The icon names cards were planned with before icons were emoji; each is drawn as its emoji now (see iconEmoji). */
export const ICONS = ["star", "heart", "check", "cross", "warning", "money", "clock", "fire", "up", "down", "gift", "cart"] as const
export type IconName = (typeof ICONS)[number]
export const LEGACY_ICONS: Record<IconName, string> = { star: "⭐", heart: "❤️", check: "✅", cross: "❌", warning: "⚠️", money: "💰", clock: "⏰", fire: "🔥", up: "⬆️", down: "⬇️", gift: "🎁", cart: "🛒" }

/** How a sticker moves inside its box. */
export const STICKER_MOTIONS = ["pop", "float", "bounce", "spin", "fly-up", "fly-across", "rain"] as const
export type StickerMotion = (typeof STICKER_MOTIONS)[number]
/** A sticker's size as a share of the canvas width: the pictures are 256 px, which starts to blur past about a third of a 1080 px frame. */
export const STICKER_SIZE = { min: 0.1, max: 0.3, default: 0.2 } as const
```

In `GraphicPiece`, change `icon?: IconName` to:

```ts
  /** an emoji; a card planned before icons were emoji may still hold a name from ICONS (see iconEmoji) */
  icon?: string
```

Replace `export interface GraphicSpec { … }` with:

```ts
interface GraphicBase {
  /** the kit version it was made for; the render hash takes the kit that renders it instead */
  version: string
  box: GraphicBox
  seconds: number
  /** Claude's one line on why it is there, shown in the app */
  why: string
}

/** A card of pieces in the highlight style's colours. Stored before stickers, it has no kind. */
export interface CardSpec extends GraphicBase {
  kind?: "card"
  tone: Tone
  in: GraphicIn
  out: GraphicOut
  pieces: GraphicPiece[]
}

/** An emoji's picture moving inside the box, drawn in no colour of the style. */
export interface StickerSpec extends GraphicBase {
  kind: "sticker"
  emoji: string
  motion: StickerMotion
  /** as a share of the canvas width */
  size: number
}

export type GraphicSpec = CardSpec | StickerSpec

export const isSticker = (spec: GraphicSpec): spec is StickerSpec => spec.kind === "sticker"
/** A card's pieces; a sticker has none. */
export const piecesOf = (spec: GraphicSpec): GraphicPiece[] => (isSticker(spec) ? [] : spec.pieces)
/** The emoji an icon is drawn as: an old name becomes its emoji, anything else is taken as it is. */
export const iconEmoji = (icon: string): string => (Object.hasOwn(LEGACY_ICONS, icon) ? LEGACY_ICONS[icon as IconName] : icon)

/** The spec with every card icon as an emoji; the same spec when there is nothing to change. */
export function upgradeSpec(spec: GraphicSpec): GraphicSpec {
  if (isSticker(spec) || !spec.pieces.some((piece) => piece.icon !== undefined && iconEmoji(piece.icon) !== piece.icon)) return spec
  return { ...spec, pieces: spec.pieces.map((piece) => (piece.icon === undefined ? piece : { ...piece, icon: iconEmoji(piece.icon) })) }
}
```

- [ ] **Step 4: the summary** — in `apps/desktop/src/main/graphics-cues.ts`: import `iconEmoji, isSticker, type StickerMotion` from `@boxblack/core/graphics/plan` and drop `IconName`; set `KIND_NAMES.icon` to `"อีโมจิ"`; delete `ICON_NAMES`; add and use:

```ts
/** Each motion's Thai name, so a new motion with no name here fails typecheck. */
const MOTION_NAMES: Record<StickerMotion, string> = { pop: "โผล่ขึ้น", float: "ลอย", bounce: "เด้ง", spin: "หมุน", "fly-up": "พุ่งขึ้น", "fly-across": "บินผ่าน", rain: "โปรย" }

/** One line saying what a graphic is made of, in the user's language. */
export function summaryOf(spec: GraphicSpec): string {
  if (isSticker(spec)) return `สติกเกอร์ ${spec.emoji} ${MOTION_NAMES[spec.motion] ?? spec.motion}`
  return spec.pieces
    .map((piece) => {
      switch (piece.kind) {
        // … number / label / bars / checks exactly as now …
        case "icon":
          return `${KIND_NAMES.icon} ${iconEmoji(piece.icon ?? "")}`
        default:
          return KIND_NAMES[piece.kind]
      }
    })
    .join(" · ")
}
```

- [ ] **Step 5: make it compile** — `npm run typecheck` and fix each error:
  - `packages/core/src/graphics/kit/html.ts:76`: `const colours = graphicColours(palette, isSticker(spec) ? "base" : spec.tone)` (import `isSticker` from `../plan.ts`; comment: `// a sticker is a picture, in none of the style's colours`).
  - `apps/desktop/src/main/graphics-render.ts` `boxOf`: `const targets = piecesOf(job.spec).flatMap(…)` (import `piecesOf`).
  - `apps/desktop/src/main/flair.ts` `changedGraphic` (import `isSticker` from `@boxblack/core/graphics/plan` now): until Task 8, a sticker keeps everything but its length and switch:

    ```ts
    function changedGraphic(graphic: GraphicCue, patch: GraphicPatch): GraphicCue {
      const seconds = isNumber(patch.seconds) ? Math.min(GRAPHIC_MAX_S, Math.max(GRAPHIC_MIN_US / 1_000_000, patch.seconds)) : graphic.spec.seconds
      const off = patch.off ?? graphic.off
      if (isSticker(graphic.spec)) return { ...graphic, off, spec: { ...graphic.spec, seconds }, edited: true }
      const pieces = graphic.spec.pieces.map((piece, i) => changedPiece(piece, patch.pieces?.[i]))
      return { ...graphic, off, spec: { ...graphic.spec, seconds, pieces }, edited: true }
    }
    ```
  - `apps/desktop/src/renderer/src/edit/GraphicSheet.tsx:83`: `const pieces = piecesOf(graphic.spec)` (import `piecesOf` from `@boxblack/core/graphics/plan`).
  - Tests reading `X.spec.pieces` on a `GraphicSpec` (44 in `direct.test.ts`, 5 in `flair.test.ts`, 1 in `EditScreen.test.tsx`): rewrite each as `piecesOf(X.spec)` (import it). Fixtures that spread `GRAPHIC.spec` in `EditScreen.test.tsx`: declare the card once as `const CARD_SPEC: CardSpec = { … }`, use it in `GRAPHIC`, and spread `CARD_SPEC` in `COUNTER`, `LISTS` and the rest. Fixtures typed `GraphicSpec` that set or read `pieces` type as `CardSpec`: `graphics-render.test.ts:41`, `html.test.ts:13` and its `window: { __SPEC?: GraphicSpec }` at `:106`, `flair.test.ts:1625` (`RICH`, read at `:1679`), `highlights.test.ts:485` and the literal built at `:617`, `timeline.test.ts:490`.
  - `apps/desktop/src/main/graphics-kit.test.ts:334`: `built(pieces: CardSpec["pieces"], …)` (import `CardSpec`); its `ICONS` import stays until Task 5 replaces that test.

- [ ] **Step 6: run the suite** — `npm test` and `npm run typecheck`. Expected: all green.

- [ ] **Step 7: mutation check** — `<scratchpad>/mut3/plan.json` with at least: `isSticker` compares `"card"`; `piecesOf` returns `spec.pieces ?? []` for both; `iconEmoji` uses `icon in LEGACY_ICONS` (the `constructor` case must catch it); `upgradeSpec` always copies (the `toBe` case); `upgradeSpec` skips the `some` check; `MOTION_NAMES["fly-up"]` wrong text. Run `python3 <scratchpad>/mutate.py packages/core/src/graphics/plan.ts <scratchpad>/mut3/plan.json packages/core/src/graphics/plan.test.ts` (and the cues file against `graphics-cues.test.ts`). Every mutation caught; a survivor gets a test.

---

## Task 2: emoji keys and the shipped set (core `graphics/emoji.ts`)

**Files:**
- Create: `packages/core/src/graphics/emoji.ts`
- Create: `packages/core/src/graphics/emoji.test.ts`
- Modify: `packages/core/src/graphics/index.ts`, `packages/core/package.json` (exports)

- [ ] **Step 1: write the failing tests** — `packages/core/src/graphics/emoji.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { EMOJI_SET, emojiKey, imageFiles, keyOfCodepoints, plainEmoji, readEmojiSet } from "./emoji.ts"
import type { CardSpec, StickerSpec } from "./plan.ts"

test("an emoji's key is its code points in hex, without the emoji-style selector or a skin tone, joiners kept", () => {
  expect(emojiKey("🚀")).toBe("1f680")
  expect(emojiKey(" 🚀 ")).toBe("1f680")
  expect(emojiKey("❤️")).toBe("2764")
  expect(emojiKey("❤")).toBe("2764")
  expect(emojiKey("👍🏽")).toBe("1f44d")
  expect(emojiKey("🧑‍🚀")).toBe("1f9d1-200d-1f680")
  expect(emojiKey("🧑🏽‍🚀")).toBe("1f9d1-200d-1f680")
  expect(emojiKey("🇹🇭")).toBe("1f1f9-1f1ed")
  expect(emojiKey("#️⃣")).toBe("23-20e3")
})

test("anything but one emoji has no key", () => {
  for (const text of ["", "   ", "a", "ก", "1", "จรวด", "🚀🚀", "🚀a", "\u{1F3FD}", "️"]) expect(emojiKey(text), JSON.stringify(text)).toBeNull()
})

test("code points as Fluent's metadata writes them get the same key as the emoji itself", () => {
  expect(keyOfCodepoints("1f9d1 200d 1f680")).toBe(emojiKey("🧑‍🚀"))
  expect(keyOfCodepoints("2764 fe0f")).toBe("2764")
  expect(keyOfCodepoints("00a9")).toBe("a9")
  expect(keyOfCodepoints("")).toBeNull()
  expect(keyOfCodepoints("zz")).toBeNull()
  expect(keyOfCodepoints("fe0f")).toBeNull()
})

test("the shipped set is read from its index, which must be of the commit the app was made for", async () => {
  const dir = await mkdtemp(join(tmpdir(), "emoji-"))
  await writeFile(join(dir, "index.json"), JSON.stringify({ version: EMOJI_SET.commit, keys: ["1f680", "2b50"] }))
  const set = await readEmojiSet(dir)
  expect(set.dir).toBe(dir)
  expect([...set.keys]).toEqual(["1f680", "2b50"])
  await writeFile(join(dir, "index.json"), JSON.stringify({ version: "0000000", keys: [] }))
  await expect(readEmojiSet(dir)).rejects.toThrow(`the emoji pictures are 0000000, not the ${EMOJI_SET.commit} this app was made for`)
})

test("an emoji is kept plain: its skin tone and emoji-style selector taken off, anything but one emoji refused", () => {
  expect(plainEmoji(" 🚀 ")).toBe("🚀")
  expect(plainEmoji("👍🏽")).toBe("👍")
  expect(plainEmoji("🧑🏽‍🚀")).toBe("🧑‍🚀")
  expect(plainEmoji("❤️")).toBe("❤")
  expect(plainEmoji("🇹🇭")).toBe("🇹🇭")
  for (const text of ["", "a", "🚀🚀", "จรวด"]) expect(plainEmoji(text), JSON.stringify(text)).toBeNull()
})

test("a spec's pictures, by the emoji as the spec writes it: a sticker's, and each card icon's that the set has", () => {
  const known = new Set(["1f680", "2b50"])
  const sticker: StickerSpec = { kind: "sticker", version: "k", box: { x0: 0, y0: 0, x1: 1, y1: 1 }, seconds: 3, emoji: "🚀", motion: "pop", size: 0.2, why: "" }
  expect(imageFiles(sticker, known)).toEqual({ "🚀": "1f680.png" })
  expect(imageFiles({ ...sticker, emoji: "🦄" }, known)).toEqual({})
  const card: CardSpec = { version: "k", box: sticker.box, seconds: 3, tone: "base", in: "pop", out: "fade", why: "", pieces: [{ kind: "number", from: 0, to: 1, atS: 0 }, { kind: "icon", icon: "star", atS: 0 }, { kind: "icon", icon: "🦄", atS: 0 }] }
  expect(imageFiles(card, known)).toEqual({ star: "2b50.png" })
})
```

- [ ] **Step 2: run it to see it fail** — `npx vitest run packages/core/src/graphics/emoji.test.ts` → FAIL, module not found.

- [ ] **Step 3: implement** — `packages/core/src/graphics/emoji.ts`:

```ts
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { iconEmoji, isSticker, type GraphicSpec } from "./plan.ts"

/**
 * The Fluent Emoji 3D pictures the app ships in Resources/graphics/emoji, fetched by
 * apps/desktop/scripts/fetch-fluent-emoji.mts from this commit: one 256 px PNG per emoji, named by
 * its key, and index.json listing the keys. `count` is how many the commit has; the release check
 * holds the shipped folder to both.
 */
export const EMOJI_SET = { repo: "microsoft/fluentui-emoji", commit: "1ffb34c752ecf5d402f04cfb4b392c77f57c54bc", count: 1595 } as const

/** The pictures on this machine: where they are, and the key of every emoji there is one for. */
export interface EmojiSet {
  dir: string
  keys: ReadonlySet<string>
}

const EMOJI_STYLE = 0xfe0f
const isSkinTone = (point: number) => point >= 0x1f3fb && point <= 0x1f3ff

/** A skin tone or the emoji-style selector changes no picture the app has: the set holds each emoji once, in its default look. */
function keyOf(points: number[]): string | null {
  const kept = points.filter((point) => point !== EMOJI_STYLE && !isSkinTone(point))
  return kept.length === 0 ? null : kept.map((point) => point.toString(16)).join("-")
}

/** The key of an emoji written as its code points in hex, apart by spaces, as Fluent's metadata.json writes them ("1f9d1 200d 1f680"). */
export function keyOfCodepoints(unicode: string): string | null {
  const points = unicode.trim().split(/\s+/).map((hex) => (/^[0-9a-f]+$/i.test(hex) ? Number.parseInt(hex, 16) : Number.NaN))
  return points.every((point) => Number.isInteger(point) && point > 0) ? keyOf(points) : null
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" })
/** What makes a character an emoji: a pictograph, a flag's letter, a keycap. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

/** The code points of one emoji; null for anything but one emoji. */
function pointsOf(glyph: string): number[] | null {
  const text = glyph.trim()
  if ([...graphemes.segment(text)].length !== 1 || !EMOJI.test(text)) return null
  return Array.from(text, (char) => char.codePointAt(0)!)
}

/** The key of the picture of one emoji, the file being `<key>.png`; null for anything but one emoji. */
export function emojiKey(glyph: string): string | null {
  const points = pointsOf(glyph)
  return points === null ? null : keyOf(points)
}

/** One emoji as the app stores it: without a skin tone or the emoji-style selector, which its picture does not show; null for anything but one emoji. */
export function plainEmoji(glyph: string): string | null {
  const points = pointsOf(glyph)
  if (points === null) return null
  const kept = points.filter((point) => point !== EMOJI_STYLE && !isSkinTone(point))
  return kept.length === 0 ? null : String.fromCodePoint(...kept)
}

/** The shipped pictures, read once: refused when they are not the set this app was made for. */
export async function readEmojiSet(dir: string): Promise<EmojiSet> {
  const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as { version?: unknown; keys?: unknown }
  if (index.version !== EMOJI_SET.commit) throw new Error(`the emoji pictures are ${String(index.version)}, not the ${EMOJI_SET.commit} this app was made for`)
  return { dir, keys: new Set(Array.isArray(index.keys) ? index.keys.filter((key): key is string => typeof key === "string") : []) }
}

/**
 * The pictures a spec draws, by the emoji as the spec writes it (an old icon name included) to the
 * file next to its page: a sticker's, and each card icon's. One the set has no picture for is left
 * out; the kit then draws no icon, and the renderer refuses a sticker without one.
 */
export function imageFiles(spec: GraphicSpec, known: ReadonlySet<string>): Record<string, string> {
  const written = isSticker(spec) ? [spec.emoji] : spec.pieces.flatMap((piece) => (piece.kind === "icon" && piece.icon !== undefined ? [piece.icon] : []))
  const files: Record<string, string> = {}
  for (const glyph of written) {
    const key = emojiKey(iconEmoji(glyph))
    if (key !== null && known.has(key)) files[glyph] = `${key}.png`
  }
  return files
}
```

Add `export * from "./emoji.ts"` to `packages/core/src/graphics/index.ts` and `"./graphics/emoji": "./src/graphics/emoji.ts"` to the `exports` of `packages/core/package.json` next to `./graphics/direct`.

- [ ] **Step 4: run** — `npx vitest run packages/core/src/graphics/emoji.test.ts` → PASS; `npm run typecheck` clean.

- [ ] **Step 5: mutation check** — list: drop the `EMOJI_STYLE` filter; drop `isSkinTone`; skin range `0x1f3fc`; `.length !== 1` → `> 1`; drop `!EMOJI.test`; `keyOfCodepoints` accepts `point >= 0`; `readEmojiSet` skips the version check; `imageFiles` skips `known.has`; `imageFiles` keys by `iconEmoji(glyph)` instead of `glyph`. All caught.

---

## Task 3: the pictures, the script that fetches them, and the release check

**Files:**
- Create: `apps/desktop/scripts/fetch-fluent-emoji.mts`, `apps/desktop/scripts/fetch-fluent-emoji.test.ts`
- Create (by running the script): `apps/desktop/resources/graphics/emoji/*.png`, `index.json`, `FLUENT-EMOJI-LICENSE`
- Modify: `apps/desktop/scripts/release-check.ts`, `apps/desktop/scripts/release-check.test.ts`

- [ ] **Step 1: failing tests for the script's pure parts** — `apps/desktop/scripts/fetch-fluent-emoji.test.ts`:

```ts
import { expect, test } from "vitest"
import { fileNames, pictures } from "./fetch-fluent-emoji.mts"

test("each emoji folder gives its one 3D picture: the plain one, or the default-tone one of an emoji with skin tones", () => {
  const paths = [
    "assets/Rocket/3D/rocket_3d.png",
    "assets/Rocket/Color/rocket_color.svg",
    "assets/Rocket/metadata.json",
    "assets/Astronaut/Default/3D/astronaut_3d_default.png",
    "assets/Astronaut/Light/3D/astronaut_3d_light.png",
    "assets/Astronaut/Default/Color/astronaut_color_default.svg",
    "README.md",
  ]
  expect(pictures(paths)).toEqual([
    { folder: "Rocket", png: "assets/Rocket/3D/rocket_3d.png" },
    { folder: "Astronaut", png: "assets/Astronaut/Default/3D/astronaut_3d_default.png" },
  ])
})

test("a folder with two 3D pictures is an error, not a guess", () => {
  expect(() => pictures(["assets/Rocket/3D/a.png", "assets/Rocket/3D/b.png"])).toThrow("two 3D pictures for Rocket")
})

test("each picture is named by its emoji's key; two emoji on one key, or code points that are none, are errors", () => {
  expect(fileNames([{ folder: "Rocket", unicode: "1f680" }, { folder: "Astronaut", unicode: "1f9d1 200d 1f680" }])).toEqual(
    new Map([["Rocket", "1f680.png"], ["Astronaut", "1f9d1-200d-1f680.png"]]),
  )
  expect(() => fileNames([{ folder: "Red heart", unicode: "2764 fe0f" }, { folder: "Heart", unicode: "2764" }])).toThrow("Heart and Red heart are both 2764")
  expect(() => fileNames([{ folder: "Odd", unicode: "" }])).toThrow('Odd: its unicode "" is not an emoji')
})
```

- [ ] **Step 2: run** — `npx vitest run apps/desktop/scripts/fetch-fluent-emoji.test.ts` → FAIL, module missing.

- [ ] **Step 3: the script** — `apps/desktop/scripts/fetch-fluent-emoji.mts`:

```ts
/**
 * Fetches the Fluent Emoji 3D pictures the graphics kit draws stickers and card icons with, from the
 * commit EMOJI_SET pins, into apps/desktop/resources/graphics/emoji: one 256×256 PNG per emoji named
 * by its key (emojiKey), index.json listing the keys, and the set's MIT licence. A developer tool, run
 * once when EMOJI_SET changes, never by a build:
 *
 *   node apps/desktop/scripts/fetch-fluent-emoji.mts [--out <dir>]
 *
 * Only the plain 3D picture of each emoji is kept, and for an emoji with skin tones the default one:
 * the app draws every tone of it the same (emojiKey drops the tone).
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { EMOJI_SET, keyOfCodepoints } from "../../../packages/core/src/graphics/emoji.ts"

// GitHub answers scripts without a browser's User-Agent more slowly, and sometimes not at all
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
const AT_ONCE = 8

/** The one 3D picture of each emoji folder: `assets/<name>/3D/<file>.png`, or `assets/<name>/Default/3D/<file>.png` for one with skin tones. */
export function pictures(paths: string[]): { folder: string; png: string }[] {
  const found = new Map<string, string>()
  for (const path of paths) {
    const match = /^assets\/([^/]+)\/(?:Default\/)?3D\/[^/]+\.png$/.exec(path)
    if (!match) continue
    const folder = match[1]!
    const other = found.get(folder)
    if (other !== undefined) throw new Error(`two 3D pictures for ${folder}: ${other} and ${path}`)
    found.set(folder, path)
  }
  return [...found].map(([folder, png]) => ({ folder, png }))
}

/** Each folder's picture file, named by the key of the code points its metadata.json gives. */
export function fileNames(entries: { folder: string; unicode: string }[]): Map<string, string> {
  const folderOf = new Map<string, string>()
  const names = new Map<string, string>()
  for (const { folder, unicode } of entries) {
    const key = keyOfCodepoints(unicode)
    if (key === null) throw new Error(`${folder}: its unicode "${unicode}" is not an emoji's code points`)
    const other = folderOf.get(key)
    if (other !== undefined) throw new Error(`${folder} and ${other} are both ${key}`)
    folderOf.set(key, folder)
    names.set(folder, `${key}.png`)
  }
  return names
}

async function get(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } })
    if (response.ok) return Buffer.from(await response.arrayBuffer())
    if (attempt === 3) throw new Error(`${url} answered ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
  }
}

/** Runs `work` on every item, at most `limit` at a time. */
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await work(items[i]!)
      }
    }),
  )
  return results
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" } } })
  const out = values.out ?? join(import.meta.dirname, "../resources/graphics/emoji")
  const raw = (path: string) => `https://raw.githubusercontent.com/${EMOJI_SET.repo}/${EMOJI_SET.commit}/${path.split("/").map(encodeURIComponent).join("/")}`
  const tree = JSON.parse((await get(`https://api.github.com/repos/${EMOJI_SET.repo}/git/trees/${EMOJI_SET.commit}?recursive=1`)).toString("utf8")) as { truncated: boolean; tree: { path: string }[] }
  if (tree.truncated) throw new Error("GitHub cut the file listing short; fetch it in parts before trusting it")
  const found = pictures(tree.tree.map((entry) => entry.path))
  if (found.length !== EMOJI_SET.count) throw new Error(`${EMOJI_SET.commit} has ${found.length} pictures, not the ${EMOJI_SET.count} EMOJI_SET says`)
  console.log(`reading ${found.length} metadata files…`)
  const entries = await inBatches(found, AT_ONCE, async ({ folder }) => {
    const meta = JSON.parse((await get(raw(`assets/${folder}/metadata.json`))).toString("utf8")) as { unicode: string }
    return { folder, unicode: meta.unicode }
  })
  const names = fileNames(entries)
  const staging = `${out}.partial`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  console.log(`fetching ${found.length} pictures…`)
  await inBatches(found, AT_ONCE, async ({ folder, png }) => writeFile(join(staging, names.get(folder)!), await get(raw(png))))
  const keys = [...names.values()].map((file) => file.slice(0, -".png".length)).sort()
  await writeFile(join(staging, "index.json"), `${JSON.stringify({ version: EMOJI_SET.commit, keys })}\n`)
  await writeFile(join(staging, "FLUENT-EMOJI-LICENSE"), await get(raw("LICENSE")))
  // the folder is replaced whole: a run that fails leaves the one before it as it was
  await rm(out, { recursive: true, force: true })
  await rename(staging, out)
  console.log(`${keys.length} pictures in ${out}`)
}

if (import.meta.main) await main()
```

- [ ] **Step 4: run the tests** → PASS.

- [ ] **Step 5: fetch the pictures** (network; about 3,200 small requests to GitHub; a few minutes):

Run: `node apps/desktop/scripts/fetch-fluent-emoji.mts`
Expected: last line `1595 pictures in …/apps/desktop/resources/graphics/emoji`. Then check:

```bash
ls apps/desktop/resources/graphics/emoji | wc -l
```
Expected `1597` (1,595 PNG + index.json + licence). `du -sh apps/desktop/resources/graphics/emoji` ≈ 54M. `file apps/desktop/resources/graphics/emoji/1f680.png` → `PNG image data, 256 x 256, 8-bit/color RGBA`. Every one of `2b50 2764 2705 274c 26a0 1f4b0 23f0 1f525 2b06 2b07 1f381 1f6d2` (the old icons' emoji) has a `.png`.

- [ ] **Step 6: failing release-check test** — append to `apps/desktop/scripts/release-check.test.ts` (add `emojiProblems` to its `./release-check.ts` import; import `EMOJI_SET` from `../../../packages/core/src/graphics/emoji.ts`; add `mkdtempSync`, `writeFileSync` to its `node:fs` import and `tmpdir` from `node:os`):

```ts
test("the shipped emoji pictures must be the pinned set, all of them, with their licence", () => {
  const dir = mkdtempSync(join(tmpdir(), "emoji-check-"))
  expect(emojiProblems(dir)).toEqual(["resources/graphics/emoji/index.json is missing or unreadable; run node apps/desktop/scripts/fetch-fluent-emoji.mts"])
  const keys = Array.from({ length: EMOJI_SET.count }, (_, i) => (0x1f300 + i).toString(16))
  writeFileSync(join(dir, "index.json"), JSON.stringify({ version: "0000000", keys: keys.slice(1) }))
  for (const key of keys.slice(2)) writeFileSync(join(dir, `${key}.png`), "png")
  expect(emojiProblems(dir)).toEqual([
    `resources/graphics/emoji is from 0000000, not ${EMOJI_SET.commit}; run node apps/desktop/scripts/fetch-fluent-emoji.mts`,
    `resources/graphics/emoji lists ${EMOJI_SET.count - 1} pictures, not ${EMOJI_SET.count}; run node apps/desktop/scripts/fetch-fluent-emoji.mts`,
    `resources/graphics/emoji is missing 1 of its pictures (${keys[1]}); run node apps/desktop/scripts/fetch-fluent-emoji.mts`,
    "resources/graphics/emoji/FLUENT-EMOJI-LICENSE is missing; run node apps/desktop/scripts/fetch-fluent-emoji.mts",
  ])
  writeFileSync(join(dir, "index.json"), JSON.stringify({ version: EMOJI_SET.commit, keys }))
  writeFileSync(join(dir, `${keys[0]}.png`), "png")
  writeFileSync(join(dir, `${keys[1]}.png`), "png")
  writeFileSync(join(dir, "FLUENT-EMOJI-LICENSE"), "MIT")
  expect(emojiProblems(dir)).toEqual([])
})

test("the pictures in the repo pass", () => {
  expect(emojiProblems(join(import.meta.dirname, "../resources/graphics/emoji"))).toEqual([])
})
```

- [ ] **Step 7: run** → FAIL (`emojiProblems` not exported).

- [ ] **Step 8: implement in `release-check.ts`** — import `EMOJI_SET` from `../../../packages/core/src/graphics/emoji.ts`; add:

```ts
const FETCH_EMOJI = "run node apps/desktop/scripts/fetch-fluent-emoji.mts"

/** What is wrong with the emoji pictures in resources/graphics/emoji: missing, from another commit than EMOJI_SET, short of a picture, or without their licence. */
export function emojiProblems(dir: string): string[] {
  let index: { version?: unknown; keys?: unknown }
  try {
    index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))
  } catch {
    return [`resources/graphics/emoji/index.json is missing or unreadable; ${FETCH_EMOJI}`]
  }
  const problems: string[] = []
  if (index.version !== EMOJI_SET.commit) problems.push(`resources/graphics/emoji is from ${String(index.version)}, not ${EMOJI_SET.commit}; ${FETCH_EMOJI}`)
  const keys: unknown[] = Array.isArray(index.keys) ? index.keys : []
  if (keys.length !== EMOJI_SET.count) problems.push(`resources/graphics/emoji lists ${keys.length} pictures, not ${EMOJI_SET.count}; ${FETCH_EMOJI}`)
  const missing = keys.filter((key) => typeof key !== "string" || !existsSync(join(dir, `${key}.png`)))
  if (missing.length > 0) problems.push(`resources/graphics/emoji is missing ${missing.length} of its pictures (${missing.slice(0, 3).map(String).join(", ")}${missing.length > 3 ? ", …" : ""}); ${FETCH_EMOJI}`)
  if (!existsSync(join(dir, "FLUENT-EMOJI-LICENSE"))) problems.push(`resources/graphics/emoji/FLUENT-EMOJI-LICENSE is missing; ${FETCH_EMOJI}`)
  return problems
}
```

and in `runReleaseCheck` add a parameter `emojiDir = join(import.meta.dirname, "../resources/graphics/emoji")` (typed `emojiDir?: string`) and, right after `const problems = releaseProblems({…})`, `problems.push(...emojiProblems(emojiDir))`. Update the file's top comment: "…ship without a built and published graphics pack, or without the emoji pictures its graphics draw."

- [ ] **Step 9: run** — `npx vitest run apps/desktop/scripts` → PASS (the existing `runReleaseCheck` test uses the real, now fetched, folder).

- [ ] **Step 10: mutation check** — `release-check.ts`: drop each of the four pushes in turn; `keys.length !== EMOJI_SET.count` → `<`; `existsSync(…png)` → always true. `fetch-fluent-emoji.mts`: the `(?:Default\/)?` group removed; duplicate-folder throw removed; duplicate-key throw removed. All caught.

---

## Task 4: how a sticker moves (kit `timeline.js`)

**Files:**
- Modify: `apps/desktop/resources/graphics/timeline.js`
- Test: `apps/desktop/src/main/graphics-kit.test.ts`

- [ ] **Step 1: failing tests** — in `graphics-kit.test.ts` extend `KitParts`:

```ts
type Lane = { x: number; y: number; w: number; h: number }
interface StickerTween {
  copy: number
  name: "x" | "y" | "scale" | "rotate" | "opacity"
  from: number
  to: number
  at: number
  duration: number
  ease: string
}
interface StickerPlan {
  copies: { left: number; top: number; size: number }[]
  tweens: StickerTween[]
}
// inside interface KitParts:
  easeOf(name: string): (p: number) => number
  seeded(seed: number): () => number
  seedOf(text: string): number
  stickerSize(spec: { motion: string; size: number }, lane: Lane, shortSide: number): number
  stickerMoves(spec: { motion: string }, when: Timing, lane: Lane, size: number, seed: number): StickerPlan
```

and add (before `describe("the kit on its page"`):

```ts
const MOTIONS = ["pop", "float", "bounce", "spin", "fly-up", "fly-across", "rain"] as const

/** Each copy of a sticker drawn at time t: how far its turned square reaches, its scale and opacity. */
function stickerAt(plan: StickerPlan, end: number) {
  const tl = parts.timeline(end)
  const state = plan.copies.map(() => ({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }))
  const tracks = new Map<string, object>()
  for (const tween of plan.tweens) {
    const key = `${tween.copy} ${tween.name}`
    if (!tracks.has(key)) tracks.set(key, tl.track((value) => (state[tween.copy]![tween.name] = value)))
    tl.tween(tracks.get(key)!, tween.from, tween.to, tween.at, tween.duration, parts.easeOf(tween.ease))
  }
  return (t: number) => {
    tl.seek(t)
    return plan.copies.map((copy, i) => {
      const s = state[i]!
      const turn = (s.rotate * Math.PI) / 180
      // the pop's overshoot past full size is the render margin's to hold, not the box's
      const half = (copy.size * Math.min(s.scale, 1) * (Math.abs(Math.cos(turn)) + Math.abs(Math.sin(turn)))) / 2
      const cx = copy.left + s.x + copy.size / 2
      const cy = copy.top + s.y + copy.size / 2
      return { left: cx - half, right: cx + half, top: cy - half, bottom: cy + half, scale: s.scale, opacity: s.opacity }
    })
  }
}

describe("a sticker's motion", () => {
  const LANES: Lane[] = [
    { x: 80, y: 80, w: 648, h: 192 },
    { x: 80, y: 80, w: 216, h: 864 },
    { x: 80, y: 80, w: 540, h: 540 },
  ]
  const planFor = (motion: string, lane: Lane, share: number, seconds: number) => {
    const spec = { motion, size: share, seconds }
    const when = parts.timing(spec as Partial<GraphicSpec>, 30, 1)
    const size = parts.stickerSize(spec, lane, 1080)
    return { when, size, plan: parts.stickerMoves(spec, when, lane, size, parts.seedOf(`🚀|${seconds}`)) }
  }

  test("never leaves its box, whatever the motion, the box's shape, the size or the length", () => {
    const outside: string[] = []
    for (const motion of MOTIONS)
      for (const lane of LANES)
        for (const share of [0.1, 0.2, 0.3])
          for (const seconds of [1.5, 3, 6]) {
            const { size, plan } = planFor(motion, lane, share, seconds)
            if (size > share * 1080) outside.push(`${motion} ${lane.w}x${lane.h} grew to ${size}`)
            const at = stickerAt(plan, seconds)
            for (let frame = 0; frame <= seconds * 30; frame++) {
              for (const drawn of at(frame / 30)) {
                const inside = drawn.left >= lane.x - 0.5 && drawn.right <= lane.x + lane.w + 0.5 && drawn.top >= lane.y - 0.5 && drawn.bottom <= lane.y + lane.h + 0.5 && drawn.scale <= 1.1
                if (!inside) outside.push(`${motion} ${lane.w}x${lane.h} ${share} ${seconds}s frame ${frame}: ${JSON.stringify(drawn)}`)
              }
            }
          }
    expect(outside.slice(0, 5)).toEqual([])
  })

  test("a fly-up starts on the box's bottom edge and reaches its top on the last frame drawn; a fly-across goes from its left edge to its right", () => {
    const lane = LANES[1]!
    const up = planFor("fly-up", lane, 0.2, 3)
    const upAt = stickerAt(up.plan, 3)
    expect(upAt(0)[0]!.bottom).toBeCloseTo(lane.y + lane.h, 5)
    expect(upAt(up.when.last)[0]!.top).toBeCloseTo(lane.y, 5)
    // still climbing while it fades: not yet at the top when the way out starts
    expect(upAt(up.when.outStart)[0]!.top).toBeGreaterThan(lane.y + 10)
    // the sticker and two fainter ones trailing it, each a fixed time behind: they never catch it up
    expect(up.plan.copies).toHaveLength(3)
    expect(upAt(1.5).map((drawn) => drawn.opacity)).toEqual([1, 0.35, 0.18])
    const [head, near, far] = upAt(2)
    expect(near!.top).toBeGreaterThan(head!.top + 10)
    expect(far!.top).toBeGreaterThan(near!.top + 10)
    // a box only just tall enough still gives a whole sticker's height of travel
    const tight = planFor("fly-up", LANES[0]!, 0.3, 3)
    const tightAt = stickerAt(tight.plan, 3)
    expect(tightAt(0)[0]!.top - tightAt(tight.when.last)[0]!.top).toBeGreaterThanOrEqual(tight.size - 1e-6)
    const wide = LANES[0]!
    const across = planFor("fly-across", wide, 0.1, 3)
    const acrossAt = stickerAt(across.plan, 3)
    expect(acrossAt(0)[0]!.left).toBeCloseTo(wide.x, 5)
    expect(acrossAt(across.when.last)[0]!.right).toBeCloseTo(wide.x + wide.w, 5)
    const tightAcross = planFor("fly-across", LANES[1]!, 0.3, 3)
    const tightAcrossAt = stickerAt(tightAcross.plan, 3)
    expect(tightAcrossAt(tightAcross.when.last)[0]!.left - tightAcrossAt(0)[0]!.left).toBeGreaterThanOrEqual(tightAcross.size - 1e-6)
  })

  test("a rain is eight stickers of mixed sizes, each out of sight until it starts to fall, drawn the same for the same seed", () => {
    const lane = LANES[2]!
    for (const seconds of [1.5, 3]) {
      const { plan, when, size } = planFor("rain", lane, 0.2, seconds)
      expect(plan.copies).toHaveLength(8)
      for (const copy of plan.copies) expect(copy.size).toBeGreaterThanOrEqual(size * 0.5 - 1e-9)
      const firstFall = (copy: number) => Math.min(...plan.tweens.filter((tween) => tween.copy === copy && tween.name === "y").map((tween) => tween.at))
      const at = stickerAt(plan, seconds)
      plan.copies.forEach((_, copy) => {
        // every copy starts falling before the way out: none stands still at the top
        expect(firstFall(copy), `${seconds}s copy ${copy}`).toBeLessThan(when.outStart)
        if (firstFall(copy) > 0.05) expect(at(firstFall(copy) - 0.01)[copy]!.opacity).toBe(0)
      })
    }
    const { when, size } = planFor("rain", lane, 0.2, 3)
    expect(parts.stickerMoves({ motion: "rain" }, when, lane, size, 42)).toEqual(parts.stickerMoves({ motion: "rain" }, when, lane, size, 42))
    expect(parts.stickerMoves({ motion: "rain" }, when, lane, size, 43)).not.toEqual(parts.stickerMoves({ motion: "rain" }, when, lane, size, 42))
  })

  test("a spin turns a whole turn every second and a half; the others come in by popping up", () => {
    const { plan } = planFor("spin", LANES[2]!, 0.2, 3)
    expect(plan.tweens.filter((tween) => tween.name === "rotate").map((tween) => [tween.from, tween.to, tween.at, tween.duration])).toEqual([[0, 360, 0, 1.5], [0, 360, 1.5, 1.5]])
    for (const motion of ["pop", "float", "bounce", "spin"]) {
      expect(planFor(motion, LANES[2]!, 0.2, 3).plan.tweens.find((tween) => tween.name === "scale"), motion).toMatchObject({ copy: 0, from: 0.4, to: 1, at: 0, ease: "back" })
    }
  })

  test("the seed of a text is always the same number, and another text's is another", () => {
    // FNV-1a's published 32-bit value for "a"
    expect(parts.seedOf("a")).toBe(0xe40c292c)
    expect(parts.seedOf("🚀|3")).toBe(parts.seedOf("🚀|3"))
    expect(parts.seedOf("🚀|3")).not.toBe(parts.seedOf("🚀|3.5"))
    const a = parts.seeded(7)
    const b = parts.seeded(7)
    const drawn = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(drawn)
    for (const n of drawn) expect(n >= 0 && n < 1).toBe(true)
  })
})
```

- [ ] **Step 2: run** — `npx vitest run apps/desktop/src/main/graphics-kit.test.ts` → FAIL (`parts.stickerSize is not a function`).

- [ ] **Step 3: implement in `timeline.js`**:
  - In `EASE` add `"power1.in": (p) => p * p,` (comment: `// a gentle start that keeps speeding up, for a rocket's climb`) and `"sine.inOut": (p) => (1 - Math.cos(Math.PI * p)) / 2,` (comment: `// a swing that eases out of each end, for things that float and sway`).
  - In `timing()` change `const starts = spec.pieces.map(…)` to `const starts = (spec.pieces || []).map(…)` with `// a sticker has no pieces`.
  - Before `return { clamp, … }` add:

```js
  /** An easing by name, as a sticker's moves name them: one from EASE, or "back" for back.out(1.8). */
  const easeOf = (name) => (name === "back" ? backOut(1.8) : EASE[name] || EASE.linear)

  /** Numbers from 0 up to 1 from a seed (mulberry32): the same seed gives the same numbers, so a rain draws the same way every render. */
  function seeded(seed) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** A seed from a text (FNV-1a over its UTF-16 code units). */
  function seedOf(text) {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
    return hash >>> 0
  }

  /** A rain's sticker tilts up to this many degrees either way. */
  const RAIN_TILT = 10
  /** How far a square turned by `degrees` reaches, as a multiple of its side. */
  const turned = (degrees) => Math.abs(Math.cos((degrees * Math.PI) / 180)) + Math.abs(Math.sin((degrees * Math.PI) / 180))

  /**
   * How much room each motion takes, across and down, in multiples of the sticker's size: what it travels
   * through, a turn (a square turned 45° is √2 across, one tilted 10° is 1.16) and a sway included.
   * stickerMoves keeps every copy inside that, and stickerSize makes a sticker smaller rather than let a
   * box too small for it cut it off.
   */
  const STICKER_ROOM = {
    pop: [1, 1],
    float: [1.1, 1.4],
    bounce: [1, 1.35],
    spin: [Math.SQRT2, Math.SQRT2],
    "fly-up": [1, 2],
    "fly-across": [2, 1.2],
    rain: [turned(RAIN_TILT), 2.5], // as built after review: a drop falls at least its own size
  }

  /** A sticker's size in pixels: its share of the canvas's short side, made smaller when its box has no room for its motion. */
  function stickerSize(spec, lane, shortSide) {
    const [across, down] = STICKER_ROOM[spec.motion] || STICKER_ROOM.pop
    return Math.max(1, Math.min(spec.size * shortSide, lane.w / across, lane.h / down))
  }

  /** How long a sticker takes to pop in. */
  const POP = 0.35
  /** A fly's sticker and the two fainter ones trailing it: how far behind each flies, and how strong it is. */
  const TRAILS = [
    [0, 1],
    [0.12, 0.35],
    [0.24, 0.18],
  ]
  /** How many stickers a rain has. */
  const RAIN = 8

  /**
   * Where a sticker's copies sit in its box (`lane`, in render-box pixels) and how they move: each copy's
   * top-left corner and size, and tweens of its x and y (offsets from that corner), scale, rotate (degrees)
   * and opacity, each easing named for easeOf. Moves run to the end, so nothing stands still while it
   * fades; the way out is the caller's: the whole layer fades from when.outStart. Every copy stays inside
   * the lane at every frame (the pop's overshoot aside).
   */
  function stickerMoves(spec, when, lane, size, seed) {
    const copies = []
    const tweens = []
    const end = when.end
    const until = when.outStart
    const add = (copy, name, from, to, at, duration, ease) => tweens.push({ copy, name, from, to, at, duration, ease })
    const centre = { left: lane.x + (lane.w - size) / 2, top: lane.y + (lane.h - size) / 2 }
    // swings from a to b and back, half a period each way, from `from` to the end
    const swing = (copy, name, a, b, period, from) => {
      for (let at = from, forth = true; at < end; at += period / 2, forth = !forth) add(copy, name, forth ? a : b, forth ? b : a, at, period / 2, "sine.inOut")
    }
    // comes in where it stands, fading in as it pops up from small
    const popIn = () => {
      add(0, "opacity", 0, 1, 0, 0.2, "linear")
      add(0, "scale", 0.4, 1, 0, POP, "back")
    }
    switch (spec.motion) {
      case "fly-up":
      case "fly-across": {
        const up = spec.motion === "fly-up"
        const start = up ? { left: centre.left, top: lane.y + lane.h - size } : { left: lane.x, top: centre.top }
        const travel = up ? -(lane.h - size) : lane.w - size
        // the sticker reaches the far edge on the last frame drawn, still moving as it fades; each trail flies
        // the same way a fixed time behind it, so it never catches up (it would end past the last frame)
        TRAILS.forEach(([lag, strength], copy) => {
          copies.push({ left: start.left, top: start.top, size })
          add(copy, "opacity", 0, strength, lag, 0.15, "linear")
          // a rocket keeps speeding up as it climbs; a plane crosses at one speed, bobbing a little
          add(copy, up ? "y" : "x", 0, travel, lag, Math.max(0.1, when.last), up ? "power1.in" : "linear")
          if (!up) swing(copy, "y", -0.05 * size, 0.05 * size, 1.2, lag)
        })
        break
      }
      case "rain": {
        const random = seeded(seed)
        for (let copy = 0; copy < RAIN; copy++) {
          const s = size * (0.5 + 0.5 * random())
          const tilt = RAIN_TILT * (2 * random() - 1)
          // a tilted square reaches past its own box this far on each side, so it is kept that far in
          const reach = (s * turned(tilt) - s) / 2
          const left = lane.x + reach + random() * Math.max(0, lane.w - s - 2 * reach)
          const period = 1.4 + 0.6 * random()
          const fall = Math.max(0, lane.h - s - 2 * reach)
          copies.push({ left, top: lane.y + reach, size: s })
          add(copy, "rotate", tilt, tilt, 0, 0, "linear")
          // the first fall starts before the way out, so no copy stands still at the top; the falls go on to the end
          for (let at = random() * Math.min(period, until); at < end; at += period) {
            add(copy, "y", 0, fall, at, period, "linear")
            add(copy, "opacity", 0, 1, at, 0.15, "linear")
            add(copy, "opacity", 1, 0, at + period - 0.15, 0.15, "linear")
          }
        }
        break
      }
      case "bounce": {
        // stands on the lower of its two heights and jumps to the upper, squashing a little as it lands
        const jump = 0.3 * size
        copies.push({ left: centre.left, top: lane.y + (lane.h - size - jump) / 2 + jump, size })
        popIn()
        for (let at = POP; at < end; at += 0.6) {
          add(0, "y", 0, -jump, at, 0.25, "power2.out")
          add(0, "y", -jump, 0, at + 0.25, 0.25, "power2.in")
          add(0, "scale", 1, 0.92, at + 0.5, 0.05, "linear")
          add(0, "scale", 0.92, 1, at + 0.55, 0.05, "linear")
        }
        break
      }
      case "float":
        copies.push({ ...centre, size })
        popIn()
        swing(0, "y", -0.12 * size, 0.12 * size, 2.4, POP)
        swing(0, "rotate", -4, 4, 3.2, POP)
        break
      case "spin":
        copies.push({ ...centre, size })
        popIn()
        for (let at = 0; at < end; at += 1.5) add(0, "rotate", 0, 360, at, 1.5, "linear")
        break
      default:
        copies.push({ ...centre, size })
        popIn()
    }
    return { copies, tweens }
  }
```

  and export them: `return { clamp, EASE, backOut, easeOf, timeline, timing, cardMoves, arrowPath, numberText, barWidths, widestCount, seeded, seedOf, stickerSize, stickerMoves }`. Update the file's top comment: "…the arrow's geometry, a sticker's size and motion, and how numbers and bars are drawn."

- [ ] **Step 4: run** → PASS. If "never leaves its box" fails, the failure lists the first five frames that stray: fix the motion's geometry or its `STICKER_ROOM` entry, not the test's tolerance.

- [ ] **Step 5: mutation check** (on `timeline.js` against `graphics-kit.test.ts`): each `STICKER_ROOM` number lowered (`"fly-up": [1, 2]` → `[1, 1.5]`, `"fly-across"` `2` → `1.5`, `spin` → `[1, 1]`, `rain` across `turned(RAIN_TILT)` → `1`, rain down `2.5` → `1.5`); `stickerSize` drops `lane.h / down`; `TRAILS` strength `0.35` → `0.5`; a trail's `lag` → `0`; the fly's duration `when.last` → `until`; rain `RAIN = 8` → `7`; rain first fall `Math.min(period, until)` → `period`; rain `reach` dropped from `left`; bounce `+ jump` dropped; `seedOf` multiplier changed; `seeded` `>>> 0` removed from the return; spin `1.5` → `2`; `popIn` scale `0.4` → `0.5`. All caught.

---

## Task 5: drawing stickers and emoji icons (kit `kit.js`, `kit.css`, core `html.ts`)

**Files:**
- Modify: `apps/desktop/resources/graphics/kit.js`, `apps/desktop/resources/graphics/kit.css`
- Modify: `packages/core/src/graphics/kit/html.ts`, `packages/core/src/graphics/kit/version.ts`
- Test: `apps/desktop/src/main/graphics-kit.test.ts`, `packages/core/src/graphics/kit/html.test.ts`

- [ ] **Step 1: failing html test** — append to `html.test.ts`:

```ts
test("the page carries each emoji's picture file, by the emoji as the spec writes it", () => {
  expect(specIn(graphicHtml({ ...args, images: { "🚀": "1f680.png" } })).images).toEqual({ "🚀": "1f680.png" })
  expect(specIn(graphicHtml(args)).images).toEqual({})
})

test("a sticker takes the style's base colours, having no tone of its own", () => {
  const sticker = { kind: "sticker" as const, version: KIT_VERSION, box: spec.box, seconds: 3, emoji: "🚀", motion: "fly-up" as const, size: 0.2, why: "" }
  const html = graphicHtml({ ...args, spec: sticker, images: { "🚀": "1f680.png" } })
  expect(cssVar(html, "colour")).toBe(hexOf(graphicColours(palette, "base").colour))
  expect(specIn(html)).toMatchObject({ kind: "sticker", emoji: "🚀", motion: "fly-up", size: 0.2 })
})
```

- [ ] **Step 2: failing kit page tests** — in `graphics-kit.test.ts`, turn `built()` into a general `page()` and keep `built()` on top of it:

```ts
/** The kit's page for a spec, run in jsdom: text measured in Kanit's widths, pictures noted as they are waited for. */
async function page(spec: GraphicSpec, images: Record<string, string> = {}) {
  const measured: { node: Element; text: string }[] = []
  const logged: string[] = []
  const decoded: string[] = []
  const virtualConsole = new VirtualConsole()
  for (const level of ["warn", "error"]) virtualConsole.on(level, (...args: unknown[]) => logged.push(args.join(" ")))
  const html = graphicHtml({
    spec,
    render: { x: 0, y: 900, width: 1080, height: 700 },
    canvas: { width: 1080, height: 1920 },
    fps: 30,
    palette: HIGHLIGHT_STYLES["bold-white"].palette,
    font: { family: "Kanit", file: "Kanit-ExtraBold.ttf" },
    assets,
    images,
  })
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(window: typeof globalThis) {
      window.Range.prototype.getBoundingClientRect = function (this: Range) {
        const node = this.startContainer as Element
        measured.push({ node, text: node.textContent ?? "" })
        return { width: kanitWidth(node.textContent ?? "") * 100 } as DOMRect
      }
      for (const name of ["clientWidth", "clientHeight"]) Object.defineProperty(window.HTMLElement.prototype, name, { get: () => 1e6 })
      Object.defineProperty(window.document, "fonts", { value: Object.assign([], { ready: Promise.resolve() }) })
      window.HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        decoded.push(this.getAttribute("src") ?? "")
        return Promise.resolve()
      }
    },
  })
  await dom.window.__hf.buildReady.kit
  expect(logged).toEqual([])
  return { document: dom.window.document as Document, tl: dom.window.__timelines.main as Timeline, measured, decoded }
}

async function built(pieces: CardSpec["pieces"], seconds = 3, images: Record<string, string> = {}) {
  return page({ version: KIT_VERSION, box: { x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.8 }, seconds, tone: "accent", in: "pop", out: "fade", why: "", pieces }, images)
}
```

and add to `describe("the kit on its page", …)`:

```ts
  test("a sticker is its emoji's picture in the box, with no card, waited for before the timeline is handed over", async () => {
    const sticker: StickerSpec = { kind: "sticker", version: KIT_VERSION, box: { x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.8 }, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.15, why: "" }
    const { document, tl, decoded } = await page(sticker, { "🚀": "1f680.png" })
    expect(document.querySelector(".card")).toBeNull()
    const drawn = Array.from(document.querySelectorAll<HTMLImageElement>(".stickers img.sticker"))
    expect(drawn.map((node) => node.getAttribute("src"))).toEqual(["1f680.png", "1f680.png", "1f680.png"])
    expect(decoded).toEqual(["1f680.png", "1f680.png", "1f680.png"])
    // the sticker itself paints over its trails
    expect(drawn.map((node) => node.style.zIndex)).toEqual(["3", "2", "1"])
    expect(tl.duration()).toBe(3)
    tl.seek(0)
    expect(drawn[0]!.style.opacity).toBe("0")
    tl.seek(1.5)
    expect(drawn[0]!.style.opacity).toBe("1")
    expect(drawn[0]!.style.transform).toMatch(/^translate\(0px, -\d+(\.\d+)?px\)/)
    tl.seek(3)
    expect(document.querySelector<HTMLElement>(".stickers")!.style.opacity).toBe("0")
  })

  test("a rain is eight pictures", async () => {
    const rain: StickerSpec = { kind: "sticker", version: KIT_VERSION, box: { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.8 }, seconds: 3, emoji: "💸", motion: "rain", size: 0.15, why: "" }
    const { document } = await page(rain, { "💸": "1f4b8.png" })
    expect(document.querySelectorAll("img.sticker")).toHaveLength(8)
  })

  test("a card's icon is its emoji's picture; one with no picture is left off the card", async () => {
    const number = { kind: "number" as const, text: "ยอด", from: 0, to: 5, atS: 0.2, untilS: 1 }
    const withIcon = await built([number, { kind: "icon", icon: "⭐", atS: 0.2 }], 3, { "⭐": "2b50.png" })
    expect(withIcon.document.querySelector("img.icon")!.getAttribute("src")).toBe("2b50.png")
    expect(withIcon.decoded).toEqual(["2b50.png"])
    const without = await built([number, { kind: "icon", icon: "🦄", atS: 0.2 }])
    expect(without.document.querySelector(".icon")).toBeNull()
    // a name every object has is not a picture either
    const inherited = await built([number, { kind: "icon", icon: "constructor", atS: 0.2 }])
    expect(inherited.document.querySelector(".icon")).toBeNull()
  })
```

Replace the test `"draws every icon the plan offers"` with:

```ts
  test("draws a sticker and a card's icon from the pictures next to the page, never a drawing of its own", () => {
    expect(assets.kit).not.toMatch(/star: "M/)
    const css = readFileSync(join(DIR, "kit.css"), "utf8")
    // the shadow is on the layer, not the sticker: a filter on the sticker would turn with it when it spins
    expect(css).toMatch(/^\.stickers \{[^}]*filter: drop-shadow\(/m)
    expect(css).not.toMatch(/^\.sticker \{[^}]*filter/m)
    expect(css).toMatch(/^\.icon \{[^}]*object-fit: contain;/m)
  })
```

Update imports: `CardSpec`, `StickerSpec` from `@boxblack/core/graphics/plan` (drop `ICONS`).

- [ ] **Step 3: run** — `npx vitest run apps/desktop/src/main/graphics-kit.test.ts packages/core/src/graphics/kit/html.test.ts` → FAIL.

- [ ] **Step 4: `html.ts`** — the existing test at `html.test.ts:55` (`toEqual({ ...spec, render, canvas, fps: 30 })`) gains `images: {}`. `graphicHtml` args gain

```ts
  /** each emoji the spec draws, as the spec writes it, to the file name of its picture next to the page (imageFiles) */
  images?: Record<string, string>
```

destructure `images = {}` and set `const payload = { ...spec, render, canvas, fps, images }`. Update the doc comment: "…and the frame rate…, and the file of each emoji's picture, copied next to it like the font". Bump `KIT_VERSION` in `kit/version.ts` to `"kit-2026-09-25-1"`. (Task 11b bumped it again, to `"kit-2026-09-25-2"`, for the kit's new default share.)

- [ ] **Step 5: `kit.js`**:
  - Destructure: `const { clamp, EASE, backOut, easeOf, timeline, timing, cardMoves, arrowPath, numberText, barWidths, widestCount, seedOf, stickerSize, stickerMoves } = kitParts`.
  - Delete the `ICONS` object and its comment.
  - Right after the three `root.style.setProperty("--radius"|"--shadow-y"|"--shadow-blur", …)` lines, insert:

```js
  // the file of an emoji's picture next to the page; a name every object has ("constructor") is not one
  const picture = (name) => (Object.prototype.hasOwnProperty.call(S.images, name) ? S.images[name] : undefined)

  // a sticker is an emoji's picture moving inside the box (a rain, several of it): no card, no text to fit
  if (S.kind === "sticker") {
    const lane = { x: box.x, y: box.y, w: box.w, h: box.h }
    // seeded by everything that shapes a rain, so two rains of one emoji in a clip fall differently
    const seed = seedOf([S.emoji, S.seconds, S.size, S.box.x0, S.box.y0, S.box.x1, S.box.y1].join("|"))
    const plan = stickerMoves(S, when, lane, stickerSize(S, lane, Math.min(W, H)), seed)
    const layer = el("div", "stickers", stage)
    const nodes = plan.copies.map((copy, i) => {
      const node = el("img", "sticker", layer)
      node.alt = ""
      node.src = picture(S.emoji)
      // the first copy is the sticker, the rest its trails: it paints over them
      Object.assign(node.style, { left: copy.left + "px", top: copy.top + "px", width: copy.size + "px", height: copy.size + "px", zIndex: String(plan.copies.length - i) })
      return node
    })
    register(
      Promise.all(nodes.map(decoded)).then(() => {
        const tl = timeline(when.end)
        const move = mover(tl)
        for (const tween of plan.tweens) move(nodes[tween.copy], { [tween.name]: [tween.from, tween.to] }, tween.at, tween.duration, easeOf(tween.ease))
        move(layer, { opacity: [1, 0] }, when.outStart, when.out.duration)
        publish(tl)
      }),
    )
    return
  }
```

  - Card icons: before `const hasIcon`, add `const iconFile = (piece) => (piece.kind === "icon" ? picture(piece.icon) : undefined)` and change `hasIcon` to `const hasIcon = S.pieces.some((piece) => iconFile(piece))`. Update the comment above `iconSize` ("an icon is 14 % of the card's width…") to say "an icon (its emoji's picture)". Next to `const groups = []` add `const pictures = []` with `// the icons' pictures, waited for before the timeline is handed over`. Replace the whole `else if (piece.kind === "icon" && ICONS[piece.icon]) { … }` branch with:

```js
    } else if (iconFile(piece)) {
      const node = el("img", "icon", card)
      node.alt = ""
      node.src = iconFile(piece)
      pictures.push(node)
      moves.push({ add: (tl, move) => move(node, { opacity: [0, 1], scale: [0.4, 1], rotate: [-20, 0] }, at, 0.35, backOut(2)) })
```

  - In `build()`: replace `const motions = new Map()` and the inline `const move = (node, props, at, duration, ease) => { … }` with `const move = mover(tl)`; replace the three `window.__timelines…` / `tl.seek(0)` lines with `publish(tl)`.
  - At the end: `const ready = fontsIn.then(() => Promise.all(pictures.map(decoded))).then(build)` and replace the `ready.catch(…)` + `window.__hf…` lines with `register(ready)`.
  - Add these function declarations just above `function fit()` (declarations are hoisted, so the sticker branch's early `return` can use them):

```js
  /** Tweens of a node's opacity and transform on `tl`: each value moved by its own track, all of them written together after a draw. */
  function mover(tl) {
    const motions = new Map()
    return (node, props, at, duration, ease) => {
      let motion = motions.get(node)
      if (!motion) {
        const state = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }
        motion = { state, tracks: {} }
        motions.set(node, motion)
        tl.afterDraw(() => {
          node.style.opacity = String(clamp(state.opacity, 0, 1))
          node.style.transform = "translate(" + state.x + "px, " + state.y + "px) rotate(" + state.rotate + "deg) scale(" + state.scale + ")"
        })
      }
      for (const name of Object.keys(props)) {
        const track = motion.tracks[name] || (motion.tracks[name] = tl.track((value) => (motion.state[name] = value)))
        tl.tween(track, props[name][0], props[name][1], at, duration, ease)
      }
    }
  }

  /** Hands the timeline over, drawn at its start. */
  function publish(tl) {
    window.__timelines = window.__timelines || {}
    window.__timelines["main"] = tl
    tl.seek(0)
  }

  /** The render waits for every promise in window.__hf.buildReady before it binds the timeline. */
  function register(ready) {
    ready.catch((error) => console.error("BOXBLACK graphics kit:", error))
    window.__hf = window.__hf || {}
    window.__hf.buildReady = window.__hf.buildReady || {}
    window.__hf.buildReady.kit = ready
  }

  /** A picture captured before it is decoded comes out blank, so each is waited for. */
  function decoded(node) {
    if (typeof node.decode !== "function") return Promise.resolve()
    return node.decode().catch(() => console.warn("BOXBLACK graphics kit: the picture " + node.getAttribute("src") + " did not load"))
  }
```

  - Update the top comment: "…builds one graphic — a card of pieces, or a sticker (an emoji's picture that moves) — from window.__SPEC…".

- [ ] **Step 6: `kit.css`** — change the `.icon` rule to `.icon { position: absolute; right: 4%; top: 50%; width: var(--icon); height: var(--icon); margin-top: calc(var(--icon) / -2); object-fit: contain; }` (its comment: "an emoji's picture, 4 % in from the card's right edge…") and append:

```css
/* a sticker: an emoji's picture on the video, no card. The shadow, half the card's, is on the layer so that it does not
   turn with a sticker that spins, and a sticker and its trails throw one shadow together */
.stickers { position: absolute; left: 0; top: 0; width: var(--w); height: var(--h); filter: drop-shadow(0 calc(var(--shadow-y) / 2) calc(var(--shadow-blur) / 2) rgba(0, 0, 0, 0.35)); }
.sticker { position: absolute; display: block; }
```

  Update the comment at the top of `kit.css`: "one card, or one sticker, on a transparent frame…".

- [ ] **Step 7: run** → PASS, then the whole suite (`npm test`) and typecheck.

- [ ] **Step 8: mutation check** (`kit.js` against `graphics-kit.test.ts`): `S.kind === "sticker"` → `"stickers"`; `nodes.map(decoded)` → `[]`; `pictures.push(node)` removed; `iconFile` returns `S.images[piece.kind]`; `picture` reads `S.images[name]` without `hasOwnProperty`; `zIndex` removed; the layer fade removed; `publish(tl)` in the sticker branch removed. (`html.ts`): `images` left out of the payload; sticker tone `"base"` → `"accent"`. All caught.

---

## Task 6: the renderer copies the pictures (main `graphics-render.ts`)

**Files:**
- Modify: `apps/desktop/src/main/graphics-render.ts`
- Test: `apps/desktop/src/main/graphics-render.test.ts`

- [ ] **Step 1: failing tests** — in `graphics-render.test.ts` extend `setup(over)` with `emoji?: string[] | "unreadable"`:

```ts
  const emojiDir = join(dir, "emoji")
  if (Array.isArray(over.emoji)) {
    await mkdir(emojiDir, { recursive: true })
    for (const key of over.emoji) await writeFile(join(emojiDir, `${key}.png`), `png ${key}`)
  }
  // … in createGraphicsRenderer({ … }):
    emoji:
      over.emoji === undefined
        ? undefined
        : over.emoji === "unreadable"
          ? async () => {
              throw new Error("ENOENT: index.json")
            }
          : async () => ({ dir: emojiDir, keys: new Set(over.emoji as string[]) }),
```

and have `run` note what it found: add `files?: string[]; html?: string` to the `runs` entry type and, before `await writeFile(output, "mov")`, `entry.files = (await readdir(project)).sort(); entry.html = await readFile(join(project, "index.html"), "utf8")`. Add:

```ts
const STICKER: GraphicSpec = { kind: "sticker", version: "kit-1", box: { x0: 0.3, y0: 0.4, x1: 0.7, y1: 0.8 }, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "" }
const specOf = (html: string) => JSON.parse(Buffer.from(html.match(/atob\("([A-Za-z0-9+/=]*)"\)/)![1]!, "base64").toString("utf8"))

test("a sticker's picture sits next to its page, which names it by file", async () => {
  const { renderer, runs } = await setup({ emoji: ["1f680"] })
  const hash = renderer.hashOf(job({ spec: STICKER }))
  await expect(renderer.wait([job({ spec: STICKER })], "/d")).resolves.toEqual({ ready: [hash], failed: [] })
  expect(runs[0]!.files).toEqual(["1f680.png", "Kanit-ExtraBold.ttf", "index.html", "renders"])
  expect(specOf(runs[0]!.html!).images).toEqual({ "🚀": "1f680.png" })
})

test("a card's emoji icon is copied too; one the set has no picture for is left off the page", async () => {
  const { renderer, runs } = await setup({ emoji: ["2b50"] })
  const card = { ...spec, pieces: [{ kind: "number" as const, from: 0, to: 5, atS: 0 }, { kind: "icon" as const, icon: "⭐", atS: 0 }, { kind: "icon" as const, icon: "🦄", atS: 0 }] }
  await renderer.wait([job({ spec: card })], "/d")
  expect(runs[0]!.files).toContain("2b50.png")
  expect(specOf(runs[0]!.html!).images).toEqual({ "⭐": "2b50.png" })
})

test("a sticker whose emoji has no picture fails, alone: the renderer goes on", async () => {
  const { renderer, runs } = await setup({ emoji: [] })
  const hash = renderer.hashOf(job({ spec: STICKER }))
  await expect(renderer.wait([job({ spec: STICKER }), job()], "/d")).resolves.toEqual({ ready: [renderer.hashOf(job())], failed: [hash] })
  expect(renderer.failureOf(hash)).toContain("there is no picture for the emoji 🚀")
  expect(renderer.environmentProblem()).toBeNull()
  expect(runs).toHaveLength(1)
})

test("pictures that cannot be read, or copied, are the app's problem: no graphic fails for it, and a card with no emoji still renders", async () => {
  const unreadable = await setup({ emoji: "unreadable" })
  // a plain card never asks for the pictures
  await expect(unreadable.renderer.wait([job()], "/d")).resolves.toEqual({ ready: [unreadable.renderer.hashOf(job())], failed: [] })
  expect(unreadable.renderer.environmentProblem()).toBeNull()
  await unreadable.renderer.wait([job({ spec: STICKER })], "/d")
  expect(unreadable.renderer.environmentProblem()).toMatch(/^the app's emoji pictures could not be read/)
  expect(unreadable.renderer.failureOf(unreadable.renderer.hashOf(job({ spec: STICKER })))).toBeNull()

  const gone = await setup({ emoji: ["1f680"] })
  await rm(join(gone.dir, "emoji", "1f680.png"))
  await gone.renderer.wait([job({ spec: STICKER })], "/d")
  expect(gone.renderer.environmentProblem()).toMatch(/^the app's emoji picture 1f680\.png could not be copied/)
})

test("a picture is named by its file alone: a set whose files are paths fails the graphic before anything is copied", async () => {
  const { renderer, runs } = await setup({ emoji: ["../1f680"] })
  const hash = renderer.hashOf(job({ spec: STICKER }))
  await expect(renderer.wait([job({ spec: STICKER })], "/d")).resolves.toEqual({ ready: [], failed: [hash] })
  expect(renderer.failureOf(hash)).toContain("a graphic's picture must be a file name alone")
  expect(runs).toHaveLength(0)
})

test("a sticker's emoji, motion and size are each part of its hash, and so is the emoji set it draws from; the font and palette, which it never draws, are not", () => {
  const { hashOf } = createGraphicsRenderer({ graphicsDir: "/g", workDir: "/w", fontDir: "/f", assets: async () => ({ timeline: "", kit: "", css: "" }), pack: async () => null, ffmpeg: () => null, ffprobe: () => null, send: () => {} })
  const base = hashOf(job({ spec: STICKER }))
  for (const change of [{ emoji: "🛸" }, { motion: "float" as const }, { size: 0.25 }]) expect(hashOf(job({ spec: { ...STICKER, ...change } as GraphicSpec }))).not.toBe(base)
  expect(hashOf(job({ spec: STICKER, palette: HIGHLIGHT_STYLES["sale-yellow"].palette, font: { family: "Mali", file: "Mali-Bold.ttf" } }))).toBe(base)
  // a card still changes with its style
  expect(hashOf(job({ palette: HIGHLIGHT_STYLES["sale-yellow"].palette }))).not.toBe(hashOf(job()))
  const { why: _why, version: _version, ...drawn } = STICKER
  const j = job({ spec: STICKER })
  expect(base).toBe(createHash("sha256").update(JSON.stringify([drawn, j.canvas, j.fps, null, null, KIT_VERSION, EMOJI_SET.commit])).digest("hex").slice(0, 16))
})
```

(Imports: `createHash` from `node:crypto`, `EMOJI_SET` from `@boxblack/core/graphics/emoji`.)

- [ ] **Step 2: run** — `npx vitest run apps/desktop/src/main/graphics-render.test.ts` → FAIL.

- [ ] **Step 3: implement** — in `graphics-render.ts`:
  - Imports: `import { EMOJI_SET, imageFiles, type EmojiSet } from "@boxblack/core/graphics/emoji"` and `isSticker, piecesOf` from `@boxblack/core/graphics/plan`.
  - `GraphicsRenderDeps` gains:

    ```ts
      /** the emoji pictures stickers and card icons are drawn with (Resources/graphics/emoji); none, and a sticker cannot render */
      emoji?: () => Promise<EmojiSet>
    ```
  - `hashOf`: a sticker draws neither the font nor the palette, so a style change must not render it again:

```ts
    const { why: _why, version: _version, ...drawn } = job.spec
    const styled = isSticker(job.spec) ? [null, null] : [job.font, job.palette]
    return createHash("sha256").update(JSON.stringify([drawn, job.canvas, job.fps, ...styled, deps.kitVersion ?? KIT_VERSION, EMOJI_SET.commit])).digest("hex").slice(0, 16)
```

    and extend its comment: "…the emoji set its pictures come from; a sticker's hash leaves out the font and palette it never draws".
  - In `render()`, after the font-name check and before `const out = files(hash)`:

```ts
    // the pictures, like the font, are the app's: one that cannot be read or copied is no graphic's fault.
    // Only a graphic that draws an emoji asks for them, so a plain card renders on a machine whose pictures are gone
    const draws = isSticker(job.spec) || piecesOf(job.spec).some((piece) => piece.kind === "icon")
    const set =
      deps.emoji && draws
        ? await deps.emoji().catch((error: unknown) => {
            throw new EnvironmentError(`the app's emoji pictures could not be read (${(error as Error).message})`)
          })
        : null
    const images = set ? imageFiles(job.spec, set.keys) : {}
    if (isSticker(job.spec) && !Object.hasOwn(images, job.spec.emoji)) throw new Error(`there is no picture for the emoji ${job.spec.emoji}`)
    // the page names each picture by its file name, copied next to it: never a path that leads elsewhere
    for (const file of Object.values(images)) if (basename(file) !== file) throw new Error(`a graphic's picture must be a file name alone, not ${file}`)
```

    pass `images` to `graphicHtml({ …, images })`, and after the font's `copyFile`:

```ts
      for (const file of new Set(Object.values(images))) {
        await copyFile(join(set!.dir, file), join(project, file)).catch((error: unknown) => {
          throw new EnvironmentError(`the app's emoji picture ${file} could not be copied (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})`)
        })
      }
```

- [ ] **Step 4: run** → PASS; whole suite and typecheck.

- [ ] **Step 5: mutation check**: drop `EMOJI_SET.commit` from the hash; `styled` always `[job.font, job.palette]`; `draws` always true; drop the sticker "no picture" throw; `Object.hasOwn` → `images[…] === undefined`; the file-name check removed; `EnvironmentError` → `Error` on the read and on the copy (each separately); copy loop removed; `imageFiles(job.spec, set.keys)` → `{}`. All caught.

---

## Task 7: Claude picks stickers (core `graphics/direct.ts`)

**Files:**
- Modify: `packages/core/src/graphics/direct.ts`
- Test: `packages/core/src/graphics/direct.test.ts`

- [ ] **Step 1: fix the fixtures for the new schema, then write the failing tests** — in `direct.test.ts`:
  - `reply()`'s graphic gains `kind: "card", emoji: "", motion: "", size: 0` (the parsed reply type now has them).
  - Add `import { STICKER_MOTIONS, piecesOf } from "./plan.ts"` and `import { KIT_VERSION } from "./kit/version.ts"` if not there.
  - Add:

```ts
const KNOWN = new Set(["1f680", "2b50", "1f525", "1f6f8", "1f44d"])
const NUMBER = () => reply().graphics[0]!.pieces[0]!
// a box 0.4 tall: MAX_BOX.height is 0.45, and 0.8 − 0.35 comes out just over it in floating point
const sticker = (over: Partial<GraphicsReply["graphics"][number]> = {}): GraphicsReply => ({
  graphics: [{ ...reply().graphics[0]!, kind: "sticker", pieces: [], emoji: "🚀", motion: "fly-up", size: 0.2, box: [0.2, 0.4, 0.8, 0.8], why: "ยานอวกาศ", ...over }],
})

test("a sticker keeps its emoji, motion and size, and starts on its word like a card", () => {
  const { graphics, dropped } = acceptGraphics(sticker(), SENTENCES, FRAMED, new Set(), KNOWN)
  expect(dropped).toBe(0)
  expect(graphics).toEqual([
    {
      anchor: { kind: "speech", videoId: "v", sourceUs: 11_200_000, beatId: "b1" },
      spec: { kind: "sticker", version: KIT_VERSION, box: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.8 }, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "ยานอวกาศ" },
      edited: false,
      off: false,
    },
  ])
})

test("a sticker's emoji is stored plain: a skin tone or the emoji-style selector Claude adds is taken off", () => {
  expect((acceptGraphics(sticker({ emoji: " 👍🏽 " }), SENTENCES, FRAMED, new Set(), KNOWN).graphics[0]!.spec as { emoji: string }).emoji).toBe("👍")
})

test("a sticker whose emoji has no picture, is not one emoji, or moves in no known way is dropped", () => {
  for (const over of [{ emoji: "🦄" }, { emoji: "จรวด" }, { emoji: "🚀🚀" }, { emoji: "" }, { motion: "warp" }, { motion: "" }]) {
    expect(acceptGraphics(sticker(over), SENTENCES, FRAMED, new Set(), KNOWN), JSON.stringify(over)).toEqual({ graphics: [], dropped: 1 })
  }
})

test("with no pictures to check against, no sticker and no card icon is kept", () => {
  expect(acceptGraphics(sticker(), SENTENCES, FRAMED)).toEqual({ graphics: [], dropped: 1 })
  const icon = { ...NUMBER(), kind: "icon" as const, icon: "⭐" }
  const { graphics, dropped } = acceptGraphics(reply({ pieces: [NUMBER(), icon] }), SENTENCES, FRAMED)
  expect(piecesOf(graphics[0]!.spec).map((piece) => piece.kind)).toEqual(["number"])
  expect(dropped).toBe(1)
})

test("a sticker is a tenth to three tenths of the frame's short side; none given is a fifth", () => {
  const size = (answer: number) => (acceptGraphics(sticker({ size: answer, motion: "pop" }), SENTENCES, FRAMED, new Set(), KNOWN).graphics[0]!.spec as { size: number }).size
  expect(size(0.5)).toBe(0.3)
  expect(size(0.05)).toBe(0.1)
  expect(size(0.25)).toBe(0.25)
  expect(size(0)).toBe(0.2)
  expect(size(-1)).toBe(0.2)
  expect(size(Number.NaN)).toBe(0.2)
})

test("a box may be as tall as the cap says, floating point aside", () => {
  // 0.8 − 0.35 is 0.45000000000000007
  expect(acceptGraphics(sticker({ box: [0.2, 0.35, 0.8, 0.8] }), SENTENCES, FRAMED, new Set(), KNOWN).graphics).toHaveLength(1)
  expect(acceptGraphics(sticker({ box: [0.2, 0.34, 0.8, 0.8] }), SENTENCES, FRAMED, new Set(), KNOWN).graphics).toHaveLength(0)
})

test("a card with a label only, or a label and an emoji, is dropped: the highlight text already says as much; a pointer with its label stays", () => {
  const label = { ...NUMBER(), kind: "label" as const, text: "ป้าย" }
  const icon = { ...NUMBER(), kind: "icon" as const, icon: "⭐" }
  const arrow = { ...NUMBER(), kind: "arrow" as const, target: [0.5, 0.3] }
  const ring = { ...NUMBER(), kind: "ring" as const, target: [0.5, 0.3], size: 0.2 }
  expect(acceptGraphics(reply({ pieces: [label] }), SENTENCES, FRAMED, new Set(), KNOWN)).toEqual({ graphics: [], dropped: 1 })
  expect(acceptGraphics(reply({ pieces: [label, icon] }), SENTENCES, FRAMED, new Set(), KNOWN)).toEqual({ graphics: [], dropped: 1 })
  expect(acceptGraphics(reply({ pieces: [NUMBER(), label] }), SENTENCES, FRAMED, new Set(), KNOWN).graphics).toHaveLength(1)
  // an arrow or a ring says something the text cannot: where the thing is
  expect(acceptGraphics(reply({ pieces: [arrow, label] }), SENTENCES, FRAMED, new Set(), KNOWN).graphics).toHaveLength(1)
  expect(acceptGraphics(reply({ pieces: [ring, label, icon] }), SENTENCES, FRAMED, new Set(), KNOWN).graphics).toHaveLength(1)
  // but not alone, nor with only an emoji
  expect(acceptGraphics(reply({ pieces: [arrow] }), SENTENCES, FRAMED, new Set(), KNOWN)).toEqual({ graphics: [], dropped: 1 })
  expect(acceptGraphics(reply({ pieces: [arrow, icon] }), SENTENCES, FRAMED, new Set(), KNOWN)).toEqual({ graphics: [], dropped: 1 })
})

test("a card's icon is an emoji with a picture; an old icon name becomes its emoji; one with no picture is left out", () => {
  const icon = (text: string) => ({ ...NUMBER(), kind: "icon" as const, icon: text })
  const kept = (text: string) => acceptGraphics(reply({ pieces: [NUMBER(), icon(text)] }), SENTENCES, FRAMED, new Set(), KNOWN)
  expect(piecesOf(kept("⭐").graphics[0]!.spec)[1]).toEqual({ kind: "icon", icon: "⭐", atS: 0 })
  expect(piecesOf(kept("star").graphics[0]!.spec)[1]).toEqual({ kind: "icon", icon: "⭐", atS: 0 })
  expect(piecesOf(kept("👍🏽").graphics[0]!.spec)[1]).toEqual({ kind: "icon", icon: "👍", atS: 0 })
  expect(piecesOf(kept("🦄").graphics[0]!.spec)).toHaveLength(1)
  expect(kept("🦄").dropped).toBe(1)
})

test("a sentence gets one graphic, sticker or card", () => {
  const both = { graphics: [...reply().graphics, ...sticker().graphics] }
  const { graphics, dropped } = acceptGraphics(both, SENTENCES, FRAMED, new Set(), KNOWN)
  expect(graphics).toHaveLength(1)
  expect(graphics[0]!.spec.kind).toBeUndefined()
  expect(dropped).toBe(1)
})

test("planGraphics checks stickers against the pictures it is given, and tells Claude what room each size needs on this canvas", async () => {
  const withSet = fakeTransport(sticker())
  const planned = await planGraphics({ transport: withSet.transport, model: "m", brief: BRIEF, level: "heavy", sentences: SENTENCES, canvas, durationUs: 20_000_000, frames: {}, known: KNOWN })
  expect(planned.graphics[0]!.spec.kind).toBe("sticker")
  // 0.2 of the short side 1080 is 216 px: a fly-up needs 432 px of the 1920 px height, a fly-across 432 px of the 1080 px width
  expect(withSet.calls[0]!.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("ขนาด 0.2: fly-up สูง ≥ 0.23 · fly-across กว้าง ≥ 0.4 · rain สูง ≥ 0.29") })
  const without = await planGraphics({ transport: fakeTransport(sticker()).transport, model: "m", brief: BRIEF, level: "heavy", sentences: SENTENCES, canvas, durationUs: 20_000_000, frames: {} })
  expect(without).toEqual({ graphics: [], dropped: 1 })
})

test("the prompt names every motion the kit draws", () => {
  for (const motion of STICKER_MOTIONS) expect(GRAPHICS_PROMPT.system).toContain(`· ${motion} `)
})
```

  (`fakeTransport` in this file returns `{ transport, calls }` — adjust to its real shape.)

- [ ] **Step 2: run** — `npx vitest run packages/core/src/graphics/direct.test.ts` → the new tests FAIL, and so do older tests whose card is a label alone or carries an icon. Fix those old tests, not the rule:
  - In each test that builds `reply({ pieces: [label] })` or `[label, …]` without a number/bars/checks/pointer (around lines 106, 324, 372, 400, 413, 437, 447, 457, 490, 515, 531, 791), put `NUMBER()` first in `pieces`, read the label at index 1 (`piecesOf(…)[1]`) and shift every other index and length it asserts by one; keep what each test asserts about the label. A test whose card is `[label, arrow]` or `[label, ring]` (around 445, 455, 514) needs no number: a pointer with its label is still a card — leave its pieces and indexes as they are.
  - Every test with an `icon` piece now passes `new Set(), KNOWN` and expects the emoji: around line 436 (`{ icon: "fire" }` → pass `KNOWN` and expect `"🔥"`), line 371 (`[label, icon "money"]` — add `NUMBER()` first, put `1f4b0` in `KNOWN`, expect `"💰"` at index 2), line 525 (`["icon", "label"]` — with `KNOWN` and `NUMBER()` first, expect `["number", "icon", "label"]`).
  - The icon swap test (line ~217) becomes:

```ts
test("a card piece beyond the three-piece cap is swapped into the third slot instead of the whole graphic being dropped", () => {
  const icon = (glyph: string) => ({ ...NUMBER(), kind: "icon" as const, icon: glyph })
  // [icon, icon, icon, number]: the first three have nothing to anchor a card on their own
  const { graphics, dropped } = acceptGraphics(reply({ pieces: [icon("⭐"), icon("🔥"), icon("⭐"), NUMBER()] }), SENTENCES, FRAMED, new Set(), KNOWN)
  expect(piecesOf(graphics[0]!.spec).map((piece) => piece.kind)).toEqual(["icon", "icon", "number"])
  // the third icon is what gives way to the number; that is the one piece that does not survive
  expect(dropped).toBe(1)
})
```

- [ ] **Step 3: implement** in `direct.ts`:
  - `GRAPHICS_PROMPT_VERSION = "graphics-2026-09-25-stickers"`. (Task 11b revised the size, box and fly-up lines and bumped it to `graphics-2026-09-25-stickers-2`; the text below is the Task 7 version.)
  - Imports add `STICKER_MOTIONS, STICKER_SIZE, iconEmoji, type StickerMotion, type StickerSpec` from `./plan.ts`, `emojiKey, plainEmoji` from `./emoji.ts`, `type CueAnchor` from `../flair/plan.ts`; drop `ICONS`, `IconName`.
  - Replace `SYSTEM` with:

```ts
const SYSTEM = `คุณวาง "กราฟิกซ้อนภาพ" ชิ้นเล็กๆ บนวิดีโอสั้น ขึ้นตามจังหวะคำพูด กราฟิกมีสองชนิด
- การ์ด (card): การ์ดสีที่ประกอบจากชิ้นส่วนที่กำหนดให้ ใช้เมื่อคำพูดมีตัวเลข การเทียบ รายการ หรือของในภาพที่ควรชี้ ต้องมีชิ้น number, bars หรือ checks อย่างน้อยหนึ่งชิ้น หรือ arrow/ring คู่กับ label การ์ดที่มีแค่ป้ายหรืออีโมจิจะถูกตัดทิ้ง เพราะซ้ำกับข้อความเด่น
- สติกเกอร์ (sticker): อีโมจิ 3D หนึ่งตัวที่เคลื่อนไหวบนภาพ ไม่มีพื้นการ์ด ใช้เมื่อคำพูดพูดถึงของ การกระทำ หรืออารมณ์ที่เห็นเป็นภาพได้ชัด เช่น "เขาต้องไปด้วยยานอวกาศ" = 🚀 พุ่งขึ้น · "ได้เงินคืน" = 💸 โปรย

ข้อมูลที่ได้: brief ระดับความจัด ประโยคที่พูดทุกประโยคพร้อมเวลาและความยาวบนคลิปที่ตัดแล้ว ฉากที่เล่นตรงนั้น (คำบรรยาย ชนิด และ keepClear = แถบของภาพที่ห้ามบัง) ข้อความเด่นและซับที่ครองพื้นที่อยู่แล้ว และเฟรมของบางประโยคแนบท้าย — ประโยคที่ไม่มีเฟรม ดูภาพเองไม่ได้
keepClear และแถบข้อความเด่น [บน, ล่าง] = แถบเต็มความกว้าง สัดส่วนความสูงจากขอบบน
คำในประโยคถอดจากเสียง อาจสะกดผิด ให้อ่านความหมายจากทั้งประโยค

ใส่กราฟิกเฉพาะตอนที่ช่วยให้คนดูเข้าใจหรือเห็นภาพจริงๆ ประโยคธรรมดาไม่ต้องใส่ ห้ามใส่แค่ตกแต่ง ตอบเป็นรายการว่างได้
- ระดับกลาง: ราวหนึ่งอันต่อยี่สิบวินาที · ระดับจัดเต็ม: ใส่ได้ถี่ขึ้น ราวหนึ่งอันต่อสิบวินาที — จำนวนที่ใส่ได้จริงบอกไว้ท้ายรายการประโยค
- ประโยคที่มีข้อความเด่นอยู่แล้ว การ์ดต้องไม่พูดคำเดิมซ้ำ (ราคาที่เป็นข้อความเด่นแล้วไม่ต้องทำตัวเลขวิ่งอีก) แต่สติกเกอร์ที่เป็นภาพของสิ่งที่พูดใส่ได้ · ประโยคที่มีสื่อแทรกอยู่แล้วไม่ต้องใส่
- หนึ่งประโยคมีกราฟิกได้อันเดียว · กราฟิกสองอันต้องขึ้นห่างกันอย่างน้อย 4 วินาที และห้ามซ้อนเวลากันบนจอ แอปจะตัดอันที่ผิดกฎเหล่านี้ทิ้งเอง
- เล็ก ไม่กินทั้งจอ กรอบกว้าง 0.3–0.9 ของจอ สูง 0.08–0.35 (สติกเกอร์ที่ต้องการที่ เช่น fly-up สูงได้ถึง 0.4) · ห้ามทับ keepClear ของฉากนั้น ห้ามทับข้อความเด่นที่ขึ้นระหว่างกราฟิกอยู่บนจอ ทั้งของประโยคนั้นและประโยคถัดไป ห้ามทับพื้นที่ซับ · บนจอแนวตั้งวางไว้ครึ่งล่างเป็นหลัก · สติกเกอร์เคลื่อนที่อยู่ในกรอบเท่านั้น
- ประโยคที่ไม่มีเฟรม ห้ามใช้ arrow หรือ ring เพราะไม่รู้ว่าของอยู่ตรงไหน
- ในการ์ด icon ต้องมาคู่กับ number bars checks หรือ label · ลูกศรพุ่งจากขอบกรอบที่ใกล้เป้าที่สุดไปหาเป้า ให้วางกรอบใกล้ของที่ชี้แต่ไม่ทับ

ตอบต่อกราฟิก
- kind: card หรือ sticker
- at: เลขประโยค · word: คำในประโยคที่กราฟิกขึ้น คัดลอกตรงตัว ("" = ต้นประโยค) · seconds: อยู่นานกี่วินาที 1.5–6 (ถ้าภาพตัดไปช่วงอื่นก่อนครบ กราฟิกจะจบตรงนั้น แต่อยู่อย่างน้อย 1.5 วินาทีเสมอ)
- why: หนึ่งบรรทัดว่าทำไมตรงนี้
- box: [ซ้าย, บน, ขวา, ล่าง] ทศนิยม 0–1 นับจากมุมซ้ายบนของทั้งจอ (ไม่ใช่ของกรอบ) เช่น [0.08, 0.6, 0.92, 0.78]
- ทุกกราฟิกตอบทุกฟิลด์: สติกเกอร์ใส่ tone base, in pop, out fade, pieces [] · การ์ดใส่ emoji "", motion "", size 0

สติกเกอร์
- emoji: อีโมจิมาตรฐานหนึ่งตัวที่ใช้กันทั่วไปและตรงกับสิ่งที่พูด (ไม่ใช่ตัวอักษร ไม่ใช่หลายตัว ใช้ตัวที่มีใน Emoji 15.0 หรือเก่ากว่า)
- size: ขนาดเป็นสัดส่วนของด้านสั้นของจอ 0.1–0.3 · ที่ที่แต่ละท่าต้องมีในกรอบบอกไว้ท้ายรายการประโยค กรอบเล็กกว่านั้นแอปย่อสติกเกอร์ให้พอดี และ fly กลายเป็น pop
- motion: เลือกให้ตรงความหมาย
  · fly-up พุ่งจากขอบล่างถึงขอบบนของกรอบ (จรวด ยอดขึ้น เติบโต)
  · fly-across บินจากซ้ายไปขวา (เครื่องบิน รถ ส่งของ)
  · rain โปรยหลายอันตกลงมาทั่วกรอบ (เงิน หัวใจ ดาว)
  · bounce เด้งอยู่กับที่ (ตกใจ ดีใจ)
  · float ลอยขึ้นลงเบาๆ (บอลลูน เมฆ ความคิด)
  · spin หมุน (เหรียญ นาฬิกา โลก)
  · pop โผล่ขึ้นแล้วอยู่นิ่ง (อื่นๆ)

การ์ด
- tone ของกราฟิกคือสีของการ์ดทั้งใบ เลือกจากสีของสไตล์
  · base = สีหลัก ใช้กับกราฟิกทั่วไป
  · accent = สีเน้น ใช้กับกราฟิกที่สำคัญที่สุดในคลิป 1–2 อัน
  · alt = สีที่สอง สลับให้คลิปไม่จำเจ
- in: pop โผล่ขึ้น / rise เลื่อนขึ้น / fade จางเข้า · out: fade จางออก / drop หล่นลง / shrink หดเล็ก
- pieces: 1–3 ชิ้น แต่ละชิ้นตอบทุกฟิลด์ ฟิลด์ที่ชนิดนั้นไม่ใช้ให้ใส่ค่าว่าง/0/[]
  · number ตัวเลขวิ่ง: from, to, unit, text (ป้ายกำกับ), at (คำที่เริ่มวิ่ง), until (คำที่ถึงค่าสุดท้าย)
  · label ป้ายสั้นประกอบชิ้นอื่น: text, at
  · bars แถบเทียบ 2–4 แถบ: items [{text, value, at}] value ไม่ติดลบ, unit
  · checks รายการติ๊ก 2–5 ข้อ: items [{text, at}] ติ๊กทีละข้อตามคำ
  · arrow ลูกศรชี้ของในภาพ: target [x, y] ทศนิยม 0–1 นับจากมุมซ้ายบนของทั้งจอ (ไม่ใช่ของกรอบ) ดูจากเฟรมที่แนบ, at
  · ring วงกลมล้อมของในภาพ: target [x, y], size (เส้นผ่านศูนย์กลาง สัดส่วนความกว้างจอ 0.1–0.6), at
  · icon อีโมจิหนึ่งตัวบนการ์ด: icon (อีโมจิ), at
- at/until ของชิ้น และ at ของ items เป็นคำในประโยคนั้น คัดลอกตรงตัว ("" = ต้นกราฟิก) — คนละอย่างกับ at ของกราฟิกที่เป็นเลขประโยค
เขียนข้อความในกราฟิกเป็นภาษาไทยสั้นๆ ตัวเลขใช้เลขอารบิก`
```

  - Schema: in the graphic object add `kind: z.enum(["card", "sticker"]).default("card")`, `emoji: z.string().default("")`, `motion: z.string().default("")`, `size: z.number().default(0)`, and make `pieces: z.array(PieceSchema).default([])`. (`motion` is a plain string so one unknown motion drops one sticker, not the whole reply.)
  - `boxOf`: the height check becomes `height <= MAX_BOX.height + 1e-9` (comment: `// a box written at the cap, 0.35 to 0.8, comes out a hair over it in floating point`).
  - `CARD_KINDS` becomes `new Set<PieceKind>(["number", "bars", "checks"])` with the comment `/** A card carries one of these, or a pointer with its label: a label or an emoji alone says what the highlight text already says. */`, and add beside it:

```ts
const POINTER_KINDS = new Set<PieceKind>(["arrow", "ring"])
/** Whether these pieces make a card worth drawing: a number, bars or checks, or a pointer at something in the picture with a label to name it. */
const anchored = (pieces: GraphicPiece[]) => pieces.some((piece) => CARD_KINDS.has(piece.kind)) || (pieces.some((piece) => POINTER_KINDS.has(piece.kind)) && pieces.some((piece) => piece.kind === "label"))
```

    In `acceptGraphics`, the cap swap keeps looking for a `CARD_KINDS` piece past the cap, and the drop check becomes `if (pieces.length === 0 || !anchored(pieces))`.
  - Add:

```ts
/** A sticker's emoji, motion and size, when its emoji has a picture and its motion is one the kit draws. The emoji is stored plain (no skin tone, no emoji-style selector), as its picture is. */
function stickerOf(answer: GraphicsReply["graphics"][number], known: ReadonlySet<string> | null): Pick<StickerSpec, "emoji" | "motion" | "size"> | null {
  if (known === null) return null
  const emoji = plainEmoji(answer.emoji)
  const key = emojiKey(answer.emoji)
  if (emoji === null || key === null || !known.has(key) || !(STICKER_MOTIONS as readonly string[]).includes(answer.motion)) return null
  const size = Number.isFinite(answer.size) && answer.size > 0 ? Math.min(STICKER_SIZE.max, Math.max(STICKER_SIZE.min, answer.size)) : STICKER_SIZE.default
  return { emoji, motion: answer.motion as StickerMotion, size }
}
```

    (A fly with no room in its box becomes a pop when the graphic is read, in `graphicsInForce` — Task 8 — the way a drift on a short piece becomes a punch; the rule is not applied here.)
  - `pieceOf(answer, scope, framed, known: ReadonlySet<string> | null)`; the `icon` case becomes:

```ts
    case "icon": {
      // a name from before icons were emoji is still understood; the emoji is stored plain, as its picture is
      const glyph = plainEmoji(iconEmoji(answer.icon.trim()))
      const key = glyph === null ? null : emojiKey(glyph)
      return known !== null && glyph !== null && key !== null && known.has(key) ? { kind: "icon", icon: glyph, atS } : null
    }
```

  - `acceptGraphics(reply, sentences, framed, taken = new Set(), known: ReadonlySet<string> | null = null)`: drop `answer.pieces.length === 0` from the first check (the card path drops an empty card anyway); after `seconds` is worked out build `const anchor: CueAnchor = { kind: "speech", videoId: sentence.videoId, sourceUs: start.startUs, beatId: sentence.beatId }` and `const why = answer.why.trim()`, then:

```ts
    if (answer.kind === "sticker") {
      const sticker = stickerOf(answer, known)
      if (!sticker) {
        dropped++
        continue
      }
      filled.add(answer.at)
      graphics.push({ anchor, spec: { kind: "sticker", version: KIT_VERSION, box, seconds, ...sticker, why }, edited: false, off: false })
      continue
    }
```

    pass `known` to `pieceOf`, and push cards with `anchor` and `why`. Update the doc comment: stickers, the card rule ("a card needs a number, bars or checks, or a pointer with its label"), `known`.
  - `describe()` gains, before the budget line, what each sticker size needs of its box on this canvas (a size is a share of the short side, a box height a share of the height — Claude cannot work that out from the prompt alone):

```ts
  const short = Math.min(args.canvas.width, args.canvas.height)
  // rounded up to the hundredth, so a box Claude writes at the figure given is never a hair short; less a hair
  // first, since 432 / 1080 × 100 comes out 40.00000000000001 and would round up to 0.41
  const share = (px: number, side: number) => String(Math.ceil((px / side) * 100 - 1e-9) / 100)
  // the room each motion takes, from the table the kit itself keeps the sticker inside (STICKER_ROOM, core's copy of timeline.js's)
  const wide = (motion: StickerMotion, size: number) => share(STICKER_ROOM[motion][0] * size * short, args.canvas.width)
  const tall = (motion: StickerMotion, size: number) => share(STICKER_ROOM[motion][1] * size * short, args.canvas.height)
  const roomLines = [
    "ที่ที่สติกเกอร์ต้องมีในกรอบ (ขนาดนับจากด้านสั้นของจอ) กรอบเล็กกว่านี้ สติกเกอร์ถูกย่อให้พอดี",
    ...[0.1, 0.2, 0.3].map(
      (size) =>
        `ขนาด ${size}: fly-up สูง ≥ ${tall("fly-up", size)} · fly-across กว้าง ≥ ${wide("fly-across", size)} · rain สูง ≥ ${tall("rain", size)} · float สูง ≥ ${tall("float", size)} · bounce สูง ≥ ${tall("bounce", size)} · spin กว้าง ≥ ${wide("spin", size)} สูง ≥ ${tall("spin", size)}`,
    ),
  ]
```

    (import `STICKER_ROOM` from `./plan.ts` — Task 4 added it there as core's copy of the kit's table, kept equal by a test.)

    and insert `...roomLines, ""` into the returned lines right before `budgetLine`.
  - `planGraphics` args gain `/** the emoji the app has pictures of; without them no sticker or card icon is kept */ known?: ReadonlySet<string>` and end with `return acceptGraphics(reply.output, args.sentences, framed, taken, args.known ?? null)`.

- [ ] **Step 4: run** — `npx vitest run packages/core/src/graphics/direct.test.ts` → PASS; whole suite (`flair.test.ts` graphics tests will fail next — see Task 8 Step 1, which fixes their fixture; if you prefer the suite green now, do that fixture change here) and typecheck.

- [ ] **Step 5: mutation check**: `answer.kind === "sticker"` → `"card"`; `!known.has(key)` removed; STICKER_MOTIONS check removed; `plainEmoji` → `answer.emoji.trim()`; size clamp bounds swapped; `answer.size > 0` → `>= 0`; `MAX_BOX.height + 1e-9` → `MAX_BOX.height`; `CARD_KINDS` regains `"label"`; `anchored` drops the label requirement for pointers; icon `known.has(key)` removed; `iconEmoji` dropped from the icon case; `filled.add` in the sticker branch removed; `share` rounds down; `planGraphics` passes `null` always. All caught.

---

## Task 8: main — old icons upgraded, stickers planned and edited, patches checked, wiring

**Files:**
- Modify: `apps/desktop/src/main/graphics-cues.ts` (`graphicsInForce`)
- Modify: `apps/desktop/src/main/flair.ts` (`FlairDeps`, `askForGraphics`, `changedPiece`, `changedGraphic`, `setGraphic`)
- Modify: `apps/desktop/src/main/highlight-api.ts` (`checkedPiece`, `checkedPatch`)
- Modify: `apps/desktop/src/shared/api.ts` (`GraphicPatch`)
- Modify: `apps/desktop/src/main/index.ts`
- Test: `graphics-cues.test.ts`, `flair.test.ts`, `highlight-api.test.ts`

- [ ] **Step 1: flair fixture** — in `flair.test.ts` line ~1373, Claude's graphics answer must be a card that survives the new rule: `const LABEL = { kind: "number", text: "อวกาศ", from: 0, to: 3, unit: "", at: "", until: "", items: [], target: [], size: 0, icon: "" }` (rename it `NUMBER_PIECE` and update its users); fix whatever assertions then read the stored piece.

- [ ] **Step 2: failing tests**
  - `graphics-cues.test.ts`, using its own helpers `inForce(graphics, over)` (line ~229), `CUE`, `SPEC` (a card) and `speech(sourceUs, beatId)`; `inForce`'s `over` must be able to set `canvas` (default `PORTRAIT`) once Step 4 adds it:

```ts
const STICKER_SPEC: StickerSpec = { kind: "sticker", version: "k", box: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.8 }, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "" }

test("a card stored with an old icon name plays, shows and renders with its emoji, switched off or not", () => {
  const old: CardSpec = { ...SPEC, pieces: [...SPEC.pieces, { kind: "icon", icon: "fire", atS: 0 }] }
  const { kept, off } = inForce([{ ...CUE, spec: old }, { ...CUE, anchor: speech(15_000_000, "b1"), spec: old, off: true }])
  expect(piecesOf(kept[0]!.cue.spec).at(-1)).toEqual({ kind: "icon", icon: "🔥", atS: 0 })
  expect(piecesOf(off[0]!.cue.spec).at(-1)).toEqual({ kind: "icon", icon: "🔥", atS: 0 })
})

test("a card stored with only a label, or a label and an emoji, no longer plays unless the user made it theirs", () => {
  const labelOnly: CardSpec = { ...SPEC, pieces: [{ kind: "label", text: "ป้าย", atS: 0 }, { kind: "icon", icon: "⭐", atS: 0 }] }
  const { kept, dropped } = inForce([{ ...CUE, spec: labelOnly }])
  expect(kept).toEqual([])
  expect(dropped).toBe(1)
  // the user's own stays, and one switched off is not counted as lost
  expect(inForce([{ ...CUE, spec: labelOnly, edited: true }]).kept).toHaveLength(1)
  expect(inForce([{ ...CUE, spec: labelOnly, off: true }])).toMatchObject({ kept: [], dropped: 0 })
  // a pointer with its label is still a card
  const pointer: CardSpec = { ...SPEC, pieces: [{ kind: "label", text: "ตรงนี้", atS: 0 }, { kind: "arrow", target: { x: 0.5, y: 0.3 }, atS: 0 }] }
  expect(inForce([{ ...CUE, spec: pointer }]).kept).toHaveLength(1)
})

test("a fly with no room in its box to travel twice its size pops instead, on this canvas", () => {
  const motionOf = (spec: StickerSpec, canvas = PORTRAIT) => (inForce([{ ...CUE, spec }], { canvas }).kept[0]!.cue.spec as StickerSpec).motion
  // 0.2 of the short side 1080 is 216 px: a fly-up needs a box 432 px tall, 0.225 of 1920
  expect(motionOf({ ...STICKER_SPEC, box: { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.72 } })).toBe("pop")
  expect(motionOf({ ...STICKER_SPEC, box: { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.73 } })).toBe("fly-up")
  // and a fly-across a box 432 px wide, 0.4 of 1080: 0.7 − 0.3 is a hair under 0.4 in floating point, and still enough
  expect(motionOf({ ...STICKER_SPEC, motion: "fly-across", box: { x0: 0.3, y0: 0.5, x1: 0.69, y1: 0.7 } })).toBe("pop")
  expect(motionOf({ ...STICKER_SPEC, motion: "fly-across", box: { x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.7 } })).toBe("fly-across")
  // on a landscape canvas the short side is the height: 0.2 is 216 px again, 0.225 of 1080 for a fly-up
  expect(motionOf({ ...STICKER_SPEC, box: { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.73 } }, { width: 1920, height: 1080 })).toBe("fly-up")
  // the stored spec keeps what Claude chose
  expect(STICKER_SPEC.motion).toBe("fly-up")
})

test("a sticker with no clear place at its height moves into the tallest free stretch of the frame instead of covering the subtitles or being lost", () => {
  // a face from 0.3 to 0.6 and subtitles from 0.76: a 0.4-tall box fits nowhere, so a card would be dropped or sit on the subtitles
  const over = { keepClear: [{ fromY: 0.3, toY: 0.6 }], captionsFromY: 0.76 }
  const card = inForce([{ ...CUE, spec: { ...SPEC, box: { x0: 0.2, y0: 0.35, x1: 0.8, y1: 0.75 } } }], over)
  expect(card.kept[0]?.cue.spec.box.y1 ?? 1).toBeGreaterThan(0.76)
  const { kept, dropped } = inForce([{ ...CUE, spec: { ...STICKER_SPEC, box: { x0: 0.2, y0: 0.35, x1: 0.8, y1: 0.75 } } }], over)
  expect(dropped).toBe(0)
  // the stretch above the face, 0 to 0.3, less the gap kept off the face; wide as it was; tall enough to still fly
  expect(kept[0]!.cue.spec).toMatchObject({ box: { x0: 0.2, y0: 0, x1: 0.8, y1: 0.28 }, motion: "fly-up" })
  // nothing free that is at least MIN_STICKER_BAND tall: lost, and counted
  const wall = inForce([{ ...CUE, spec: STICKER_SPEC }], { keepClear: [{ fromY: 0.05, toY: 0.72 }], captionsFromY: 0.76 })
  expect(wall).toMatchObject({ kept: [], dropped: 1 })
})
```

    (`inForce`'s `over` already carries the keep-clear bands and `captionsFromY` in some form — use the names it has; if it takes a `keepClearIn` function, build one from the bands.)
  - `flair.test.ts` (next to the `setGraphic` tests at ~1640; the service comes from `withGraphics(graphics, extra)` at ~1635 — pass `emoji: async () => ({ dir: "/e", keys: new Set(["1f680", "1f6f8", "2b50", "1f525"]) })` through `extra`):

```ts
const STICKER_CUE = (sourceUs: number): GraphicCue => ({ anchor: { ...speech(sourceUs), beatId: "beat-1" }, spec: { kind: "sticker", version: "k", box: { x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.8 }, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "" }, edited: false, off: false })

test("a sticker's emoji and motion are changed by hand, which makes it the user's; the emoji is stored plain", async () => {
  // store STICKER_CUE(s(18.08)) the way the neighbouring setGraphic tests store a graphic
  await flair.setGraphic(folder, cue.anchor, { emoji: " 🛸 ", motion: "float" })
  const stored = (await outlines.get(folder))!.flair!.graphics![0]!
  expect(stored.spec).toMatchObject({ kind: "sticker", emoji: "🛸", motion: "float", size: 0.2 })
  expect(stored.edited).toBe(true)
  await flair.setGraphic(folder, cue.anchor, { motion: "warp" as never })
  expect((await outlines.get(folder))!.flair!.graphics![0]!.spec).toMatchObject({ motion: "float" })
  await flair.setGraphic(folder, cue.anchor, { emoji: "👍🏽" })
  expect((await outlines.get(folder))!.flair!.graphics![0]!.spec).toMatchObject({ emoji: "👍" })
})

test("pictures that cannot be read leave Claude with no emoji to choose from, and the rest of the plan goes on", async () => {
  // build the service with emoji: async () => { throw new Error("ENOENT") } and Claude answering a sticker and a number card
  // plan as the neighbouring "graphics: a second call" tests do, then:
  expect((await outlines.get(folder))!.flair!.graphics!.map((graphic) => graphic.spec.kind)).toEqual([undefined])
})

test("an emoji with no picture is refused before anything is stored", async () => {
  const before = await outlines.get(folder)
  await expect(flair.setGraphic(folder, cue.anchor, { emoji: "🦄" })).rejects.toThrow("there is no picture for the emoji 🦄")
  await expect(flair.setGraphic(folder, cue.anchor, { emoji: "จรวด" })).rejects.toThrow("there is no picture for the emoji จรวด")
  await expect(flair.setGraphic(folder, cardCue.anchor, { pieces: { 1: { icon: "🦄" } } })).rejects.toThrow("there is no picture for the emoji 🦄")
  expect(await outlines.get(folder)).toEqual(before)
})

test("a card's emoji icon is changed by hand; its other pieces keep theirs", async () => {
  // a card with [number, icon ⭐] stored as cardCue
  await flair.setGraphic(folder, cardCue.anchor, { pieces: { 1: { icon: "🔥" } } })
  expect(piecesOf((await outlines.get(folder))!.flair!.graphics!.find((g) => g.anchor.sourceUs === cardCue.anchor.sourceUs)!.spec)[1]).toEqual({ kind: "icon", icon: "🔥", atS: 0 })
})

test("Claude's stickers are planned against the pictures the app has", async () => {
  claude.graphics = { graphics: [{ ...GRAPHICS.graphics[0]!, kind: "sticker", pieces: [], emoji: "🚀", motion: "pop", size: 0.2 }] }
  // plan as the neighbouring "graphics: a second call" tests do, then:
  expect((await outlines.get(folder))!.flair!.graphics!.map((graphic) => graphic.spec.kind)).toEqual(["sticker"])
})
```

    (`cue`, `cardCue`, `claude`, `folder`, `outlines` follow the neighbouring tests' setup; write each test self-contained in that style.)
  - `highlight-api.test.ts`:

```ts
test("a graphic's emoji, motion and card icon reach the flair service as the screen sends them", async () => {
  const { calls, api } = recorder()
  await api.setGraphic("/p", SPEECH, { emoji: "🚀", motion: "float", pieces: { 1: { icon: "⭐", extra: 1 } } } as never)
  expect(calls).toEqual([["setGraphic", "/p", SPEECH, { emoji: "🚀", motion: "float", pieces: { 1: { icon: "⭐" } } }]])
})

test("an emoji, a motion or an icon the screen could not have sent is refused", async () => {
  const { calls, api } = recorder()
  const long = "x".repeat(101)
  for (const patch of [{ emoji: 5 }, { emoji: long }, { motion: "warp" }, { motion: 1 }, { pieces: { 0: { icon: 5 } } }, { pieces: { 0: { icon: long } } }]) {
    await expect(api.setGraphic("/p", SPEECH, patch as never), JSON.stringify(patch)).rejects.toThrow()
  }
  expect(calls).toEqual([])
})
```

- [ ] **Step 3: run** — `npx vitest run apps/desktop/src/main/graphics-cues.test.ts apps/desktop/src/main/flair.test.ts apps/desktop/src/main/highlight-api.test.ts` → FAIL.

- [ ] **Step 4: implement**
  - `shared/api.ts`: import `type StickerMotion` from `@boxblack/core/graphics/plan`;

```ts
export interface GraphicPatch {
  off?: boolean
  seconds?: number
  /** a sticker's emoji, which must have a picture */
  emoji?: string
  /** a sticker's motion */
  motion?: StickerMotion
  /** by piece index: the texts and numbers of that piece, and a card icon's emoji */
  pieces?: Record<number, { text?: string; from?: number; to?: number; unit?: string; items?: { text: string; value?: number }[]; icon?: string }>
}
```

  - `highlight-api.ts`: import `STICKER_MOTIONS, type StickerMotion` from `@boxblack/core/graphics/plan`. In `checkedPiece` destructure `icon` too, refuse `icon !== undefined && !isText(icon)`, and return `...(icon !== undefined ? { icon } : {})`. In `checkedPatch` destructure `emoji, motion`, refuse `(emoji !== undefined && !isText(emoji)) || (motion !== undefined && !(STICKER_MOTIONS as readonly unknown[]).includes(motion))`, and return `...(emoji !== undefined ? { emoji } : {}), ...(motion !== undefined ? { motion: motion as StickerMotion } : {})`. Update the doc comment of `checkedPatch`: "…its length, a sticker's emoji and motion, and the words, numbers and icon of its pieces by index".
  - `plan.ts` (core) gains the read-time rule for a fly, next to `enforceGraphics`:

```ts
/**
 * The motion a sticker really plays: a fly across a box with no room to travel twice its size pops
 * instead, as a drift on a short piece punches. Sizes are shares of the canvas's short side, boxes
 * of its width and height. A hair under, in floating point, is still enough.
 */
export function settledMotion(spec: StickerSpec, canvas: { width: number; height: number }): StickerMotion {
  const size = spec.size * Math.min(canvas.width, canvas.height)
  // a stored motion named like an object's own property ("constructor") is no motion: it takes a pop's room
  const [across, down] = Object.hasOwn(STICKER_ROOM, spec.motion) ? STICKER_ROOM[spec.motion] : STICKER_ROOM.pop
  if (spec.motion === "fly-up" && (spec.box.y1 - spec.box.y0) * canvas.height < down * size - 1e-6) return "pop"
  if (spec.motion === "fly-across" && (spec.box.x1 - spec.box.x0) * canvas.width < across * size - 1e-6) return "pop"
  return spec.motion
}
```

    and `direct.ts` exports its `anchored` as `cardAnchored` (same body).
  - `graphics-cues.ts` `graphicsInForce`: import `upgradeSpec, settledMotion, isSticker`, `cardAnchored` from `@boxblack/core/graphics/direct`, `KEEP_CLEAR_GAP` from `@boxblack/core/graphics/framing`; its input gains `canvas: { width: number; height: number }` (`highlights.ts` `graphicsOn` passes the one it has). Add:

```ts
/** A sticker moved into a free stretch of the frame needs at least this much of its height. */
const MIN_STICKER_BAND = 0.08

/**
 * The tallest stretch of the frame's height clear of every band, and of the subtitles when they are
 * on, kept the same gap off the bands that a dodge keeps; null when none is MIN_STICKER_BAND tall.
 */
function tallestFreeBand(never: Band[], subtitles: Band | null): Band | null {
  const taken = [...never, ...(subtitles ? [subtitles] : [])].sort((a, b) => a.fromY - b.fromY)
  let best: Band | null = null
  let fromY = 0
  const consider = (toY: number) => {
    const band = { fromY: fromY === 0 ? 0 : fromY + KEEP_CLEAR_GAP, toY: toY === 1 ? 1 : toY - KEEP_CLEAR_GAP }
    if (band.toY - band.fromY >= MIN_STICKER_BAND && (best === null || band.toY - band.fromY > best.toY - best.fromY)) best = band
  }
  for (const band of taken) {
    consider(Math.max(fromY, band.fromY))
    fromY = Math.max(fromY, band.toY)
  }
  consider(1)
  return best
}
```

    and change the loop to:

```ts
  for (const stored of input.graphics) {
    // a card planned before icons were emoji plays, shows and renders with its icons' emoji
    const upgraded = upgradeSpec(stored.spec)
    const cue = upgraded === stored.spec ? stored : { ...stored, spec: upgraded }
    // a card of a label alone (an emoji beside it or not) says what the highlight text already says: one
    // Claude made no longer plays; one the user made theirs stays
    if (!isSticker(cue.spec) && !cue.edited && !cardAnchored(cue.spec.pieces)) {
      if (!cue.off) gone++
      continue
    }
    const where = input.place(cue.anchor)
    // … as now down to `const never = …` …
    let box = dodgeBands(cue.spec.box, never, subtitles)
    // a sticker has no words to lose: rather than sit on the subtitles or be lost, it takes the tallest free stretch
    if (isSticker(cue.spec) && (box === null || (subtitles !== null && covers(box, subtitles)))) {
      const band = tallestFreeBand(never, subtitles)
      box = band === null ? null : { ...cue.spec.box, y0: band.fromY, y1: band.toY }
    }
    if (box === null && !cue.off) {
      gone++
      continue
    }
    const placedBox = box ?? cue.spec.box
    // a fly with no room in the box it really plays in pops instead; the stored spec keeps what Claude chose
    const spec = isSticker(cue.spec) ? { ...cue.spec, box: placedBox, motion: settledMotion({ ...cue.spec, box: placedBox }, input.canvas) } : { ...cue.spec, box: placedBox }
    const moved = spec.box === cue.spec.box && (!isSticker(spec) || spec.motion === cue.spec.motion) ? cue : { ...cue, spec }
    const at = { cue: moved, atUs: where.atUs, durationUs }
    // … the rest as now
```

    (`covers` is the file's own helper.) Update the doc comment of `graphicsInForce` with the three new rules.
  - `flair.ts`:
    - imports: `emojiKey, type EmojiSet` from `@boxblack/core/graphics/emoji`; `isSticker, STICKER_MOTIONS` from `@boxblack/core/graphics/plan`.
    - `FlairDeps` gains `/** the emoji the app has pictures of: what Claude's stickers and icons, and the user's, are held to */ emoji?: () => Promise<EmojiSet>`.
    - `askForGraphics`: pass `known` to `planGraphics`, where

    ```ts
        // pictures that cannot be read leave Claude nothing to choose a sticker or an icon from; the cards still come
        const known = deps.emoji ? await deps.emoji().then((set) => set.keys, () => new Set<string>()) : undefined
    ```
    - `changedPiece`: add `if (piece.kind === "icon" && change.icon !== undefined && change.icon.trim() !== "") next.icon = change.icon.trim()` and mention icons in its comment.
    - `changedPiece`'s icon line stores the emoji plain: `const icon = change.icon === undefined ? null : plainEmoji(iconEmoji(change.icon)); if (piece.kind === "icon" && icon) next.icon = icon` (import `plainEmoji` from `@boxblack/core/graphics/emoji`, `iconEmoji` from plan).
    - `changedGraphic`, sticker branch:

```ts
  if (isSticker(graphic.spec)) {
    // stored plain, as Claude's are: its picture shows no skin tone
    const emoji = patch.emoji === undefined ? null : plainEmoji(patch.emoji)
    const motion = patch.motion !== undefined && (STICKER_MOTIONS as readonly string[]).includes(patch.motion) ? patch.motion : graphic.spec.motion
    return { ...graphic, off, spec: { ...graphic.spec, seconds, motion, ...(emoji ? { emoji } : {}) }, edited: true }
  }
```

    - `setGraphic`, before `amend`:

```ts
      // an emoji with no picture would render as nothing: refused before anything is stored
      const typed = patch === null ? [] : [patch.emoji, ...Object.values(patch.pieces ?? {}).map((change) => change.icon)].flatMap((glyph) => (glyph !== undefined && glyph.trim() !== "" ? [glyph.trim()] : []))
      if (typed.length > 0) {
        const known = deps.emoji ? (await deps.emoji()).keys : new Set<string>()
        for (const glyph of typed) {
          const key = emojiKey(glyph)
          if (key === null || !known.has(key)) throw new Error(`there is no picture for the emoji ${glyph}`)
        }
      }
```

  - `index.ts`: import `readEmojiSet, type EmojiSet` from `@boxblack/core/graphics/emoji`; next to `let kit`:

```ts
  // read once too: the pictures never change while the app runs. A read that fails is not kept, so the next ask reads again
  let emojiSet: Promise<EmojiSet> | undefined
  const emoji = () =>
    (emojiSet ??= readEmojiSet(join(resourcesDir, "graphics", "emoji")).catch((error: unknown) => {
      emojiSet = undefined
      throw error
    }))
```

    and pass `emoji` to `createGraphicsRenderer({ … })` and `createFlairService({ … })`.

- [ ] **Step 5: run** → PASS; whole suite and typecheck.

- [ ] **Step 5b: carried over from Task 6's review** (Task 6 built more than the plan said: the renderer has a scoped `emojiProblem`, `machineReady()`, `environmentProblem(jobs?)`, `EmojiPicturesError` messages ending ": reinstall BOXBLACK"; index.ts's `graphicsReady` uses `machineReady()`):
  - Wire `emoji` into `createGraphicsRenderer` in index.ts (Step 4 above) — until then every emoji-drawing graphic is held back as "the app's emoji pictures are missing".
  - `timeline.ts` write pre-check (~355–357, the loop that runs when `graphicsReady()` is false): when it throws for a job not yet rendered, use the emoji problem only for a job that draws an emoji (`drawsEmoji`); a plain card gets `unfit(<machine only>) ?? notInstalled`. Test: pack missing + an emoji problem + a plain card not rendered → "not installed".
  - The two fakes of `environmentProblem` in highlights.test.ts (~511) and timeline.test.ts (~518) copy the renderer's rule: make them call one shared helper exported from graphics-render.ts (e.g. `problemFor(machine, emoji, jobs)`) so they cannot drift.

- [ ] **Step 6: mutation check**: `upgradeSpec` call removed from `graphicsInForce`; the label-only drop skips `!cue.edited`; it counts `off` cards as gone; `settledMotion` `- 1e-6` removed; `settledMotion` uses `canvas.width` for the short side; the free-band fallback removed; `tallestFreeBand` ignores `subtitles`; `KEEP_CLEAR_GAP` dropped from the band; `MIN_STICKER_BAND` → `0`; `setGraphic` skips `known.has`; `emojiKey(glyph) === null` check removed; `changedGraphic` ignores `patch.emoji`; `plainEmoji` → `trim()` in `changedGraphic`; the motion check removed (the `warp` case); `changedPiece` icon line removed; `highlight-api` emoji `isText` check removed; motion check removed; icon returned dropped; `askForGraphics` passes `known: undefined`; its `.then(…, () => new Set())` → rethrow. All caught.

---

## Task 9: the sheet edits emoji and motion (renderer)

**Files:**
- Modify: `apps/desktop/src/renderer/src/edit/GraphicSheet.tsx`, `apps/desktop/src/renderer/src/i18n.ts`
- Test: `apps/desktop/src/renderer/src/screens/EditScreen.test.tsx`

- [ ] **Step 1: failing tests** — in `EditScreen.test.tsx` near the other sheet tests:

```ts
const STICKER: GraphicView = {
  ...GRAPHIC,
  summary: "สติกเกอร์ 🚀 พุ่งขึ้น",
  spec: { kind: "sticker", version: "1", box: { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.8 }, seconds: 3, emoji: "🚀", motion: "fly-up", size: 0.2, why: "ยานอวกาศ" },
}

test("a sticker's emoji and motion are changed in its sheet, which sends only what changed", async () => {
  const { api, sheet } = await editGraphic(STICKER)
  const emoji = within(sheet).getByRole("textbox", { name: t("graphics.emoji") })
  expect(emoji).toHaveProperty("value", "🚀")
  const motion = within(sheet).getByRole("combobox", { name: t("graphics.motion") }) as HTMLSelectElement
  expect(motion.value).toBe("fly-up")
  expect(Array.from(motion.options, (option) => option.textContent)).toEqual(["โผล่ขึ้น", "ลอย", "เด้ง", "หมุน", "พุ่งขึ้น", "บินผ่าน", "โปรย"])
  expect(saveButton()).toHaveProperty("disabled", true)
  await retype(emoji, "🛸")
  await userEvent.selectOptions(motion, "float")
  await userEvent.click(saveButton())
  expect(calls(api, "setGraphic")).toStrictEqual([["setGraphic", FOLDER, STICKER.anchor, { emoji: "🛸", motion: "float" }]])
})

test("an emptied emoji is no change; a save refused for its emoji says so, and any other failure says what it always did", async () => {
  const refused = { setGraphic: async () => Promise.reject(new Error("there is no picture for the emoji 🦄")) }
  const { sheet } = await editGraphic(STICKER, refused)
  const emoji = within(sheet).getByRole("textbox", { name: t("graphics.emoji") })
  await userEvent.clear(emoji)
  expect(saveButton()).toHaveProperty("disabled", true)
  await userEvent.type(emoji, "🦄")
  await userEvent.click(saveButton())
  expect(await within(sheet).findByRole("alert")).toHaveProperty("textContent", t("graphics.emojiUnknown"))
  cleanup()
  // the graphic gone meanwhile, an emoji typed or not: not the emoji's fault
  const gone = { setGraphic: async () => Promise.reject(new Error("there is no graphic at that place")) }
  const { sheet: other } = await editGraphic(STICKER, gone)
  await retype(within(other).getByRole("textbox", { name: t("graphics.emoji") }), "🛸")
  await userEvent.click(saveButton())
  expect(await within(other).findByRole("alert")).toHaveProperty("textContent", t("graphics.saveFailed"))
})

test("the flair tab lists a sticker like a card, by what it shows", async () => {
  renderScreen(withGraphics({ graphics: [STICKER] }))
  await ready()
  await openFlair()
  expect(screen.getByText("สติกเกอร์ 🚀 พุ่งขึ้น")).toBeTruthy()
  expect(graphicButton("graphics.editLabel", STICKER.summary)).toBeTruthy()
})

test("a card's emoji icon has a field of its own", async () => {
  const withIcon: GraphicView = { ...COUNTER, spec: { ...CARD_SPEC, pieces: [...piecesOf(COUNTER.spec), { kind: "icon", icon: "⭐", atS: 0 }] } }
  const { api, sheet } = await editGraphic(withIcon)
  const icon = within(sheet).getByRole("textbox", { name: t("graphics.emoji") })
  expect(icon).toHaveProperty("value", "⭐")
  await retype(icon, "🔥")
  await userEvent.click(saveButton())
  expect(calls(api, "setGraphic")).toStrictEqual([["setGraphic", FOLDER, withIcon.anchor, { pieces: { 1: { icon: "🔥" } } }]])
})
```

  (How `editGraphic`'s `overrides` make `setGraphic` reject: follow the existing save-failure test; if the harness passes `RendererApi` overrides differently, use its way.) Update the existing test "each piece is named in Thai, and one that only follows the picture has nothing to type into": an icon piece now has a textbox named `t("graphics.emoji")` under the legend `"อีโมจิ"`; arrows and rings still have nothing to type into. The existing save-failure test (`graphics.saveFailed` on a rejected save with words typed) still holds: only a rejection whose message contains "there is no picture for the emoji" (errors cross IPC wrapped, see Step 2a) reads as the emoji's fault.

- [ ] **Step 2: run** — `npx vitest run apps/desktop/src/renderer/src/screens/EditScreen.test.tsx` → FAIL.

- [ ] **Step 2a: carried over from Task 8's review**
  - Errors crossing IPC arrive wrapped: `"Error invoking remote method 'api:setGraphic': Error: there is no picture for the emoji 🦄"`. The sheet must match with `/there is no picture for the emoji\b/` (or `.includes`), not `startsWith`, as `aiFailure` in `EditScreen.tsx` already does; the tests' fake rejects with the wrapped form.
  - `GraphicView.spec` carries the motion the sticker really plays (a fly-up with no room in its box plays as pop); Task 8 added `GraphicView.storedMotion` (the motion as stored). The motion select shows and compares against `storedMotion ?? spec.motion`, and when `spec.motion !== storedMotion` the sheet says under the select "กรอบตรงนี้ไม่พอให้พุ่ง จึงเล่นเป็นโผล่ขึ้น" (i18n `graphics.motionPops`). Test both.

- [ ] **Step 2b: the two kinds of problem on screen** (from Task 6's review): the renderer's problem text now ends in its own remedy (": reinstall BOXBLACK" for the emoji pictures). `graphics.problem` (flair tab, i18n ~194) and `settings.graphicsPackProblem` (settings, ~469) append renderer/ffmpeg advice that is wrong for the emoji one (a pack reinstall is ~100 MB and does not help). Have main tell them apart: the preview's and settings' problem becomes `{ text: string; kind: "machine" | "emoji" }` (or a second field `graphicsProblemKind`), and the renderer shows `graphics.problemEmoji` = "เรนเดอร์กราฟิกที่ใช้อีโมจิไม่ได้: {problem} — รูปอีโมจิในแอปเสีย ติดตั้ง BOXBLACK ใหม่" for the emoji kind, keeping the old texts for the machine kind. Tests in EditScreen.test.tsx and the settings screen test for both kinds.

- [ ] **Step 3: i18n** — in `i18n.ts`: `"graphics.kind.icon": "อีโมจิ"`; `"flair.graphicHint"` now names both kinds, e.g. `"สติกเกอร์อีโมจิ 3D ที่ขยับตามคำพูด และการ์ดตัวเลข แถบเทียบ รายการ ลูกศร"` (keep whatever else it says about the renderer); and add (`graphics.problemEmoji` from Step 2b as well)

```ts
  "graphics.emoji": "อีโมจิ 1 ตัว",
  "graphics.emojiHint": "กด Ctrl+⌘+Space เพื่อเปิดแป้นอีโมจิ",
  "graphics.motion": "ท่า",
  "graphics.motion.pop": "โผล่ขึ้น",
  "graphics.motion.float": "ลอย",
  "graphics.motion.bounce": "เด้ง",
  "graphics.motion.spin": "หมุน",
  "graphics.motion.fly-up": "พุ่งขึ้น",
  "graphics.motion.fly-across": "บินผ่าน",
  "graphics.motion.rain": "โปรย",
  "graphics.emojiUnknown": "บันทึกไม่สำเร็จ แอปไม่มีรูปของอีโมจินี้ ลองตัวอื่น",
```

- [ ] **Step 4: `GraphicSheet.tsx`**:
  - Imports: `isSticker, piecesOf, STICKER_MOTIONS, type StickerMotion` from `@boxblack/core/graphics/plan`; `Select` from `../ui/Select.tsx`.
  - `PieceDraft` gains `icon?: string`; `change`'s field union gains `"icon"`.
  - `changeOf`: add `const icon = draft.icon?.trim(); if (piece.kind === "icon" && icon && icon !== piece.icon) change.icon = icon`.
  - `editable`: `piece.kind === "icon" || piece.text !== undefined || …` and its comment: "An arrow or a ring follows the picture: it has nothing to type."
  - `/** How long an emoji may be typed: one emoji with its joiners and tones fits. */ const EMOJI_MAX = 16`.
  - `onSave` now answers with what went wrong, or null: `onSave: (anchor: CueAnchor, patch: GraphicPatch) => Promise<string | null>`. In `screens/EditScreen.tsx`, where `GraphicSheet` gets its `onSave`, the handler calls `api.setGraphic(…)` and returns `null` on success and `error instanceof Error ? error.message : String(error)` on failure (it refreshes the preview on success as it does now). `/** The one save failure the sheet can explain: the main process refuses an emoji it has no picture for. */ const NO_PICTURE = /there is no picture for the emoji\b/` (a regex: the message arrives wrapped by IPC).
  - In the component:

```tsx
  const sticker = isSticker(graphic.spec) ? graphic.spec : null
  const pieces = piecesOf(graphic.spec)
  const [emoji, setEmoji] = useState(sticker?.emoji ?? "")
  // the motion as stored: the view's spec carries the one it really plays, a cramped fly playing as pop (Step 2a)
  const storedMotion = sticker ? (graphic.storedMotion ?? sticker.motion) : null
  const [motion, setMotion] = useState<StickerMotion | "">(storedMotion ?? "")
  const [failed, setFailed] = useState<"saveFailed" | "emojiUnknown" | null>(null)
  // …
  const typedEmoji = emoji.trim()
  const patch: GraphicPatch = {
    ...(length !== null && clampSeconds(length) !== graphic.spec.seconds ? { seconds: clampSeconds(length) } : {}),
    ...(sticker && typedEmoji !== "" && typedEmoji !== sticker.emoji ? { emoji: typedEmoji } : {}),
    ...(sticker && motion !== "" && motion !== storedMotion ? { motion } : {}),
    ...(Object.keys(changes).length > 0 ? { pieces: changes } : {}),
  }
  const save = async () => {
    setSaving(true)
    setFailed(null)
    const error = await onSave(graphic.anchor, patch)
    if (error === null) {
      onClose()
      return
    }
    setSaving(false)
    setFailed(NO_PICTURE.test(error) ? "emojiUnknown" : "saveFailed")
  }
```

    after the seconds `Field`:

```tsx
        {sticker && (
          <>
            <Field label={t("graphics.emoji")} hint={t("graphics.emojiHint")}>
              <input maxLength={EMOJI_MAX} value={emoji} onChange={(event) => setEmoji(event.target.value)} />
            </Field>
            <Field label={t("graphics.motion")}>
              <Select value={motion} onChange={(value) => setMotion(value as StickerMotion)}>
                {STICKER_MOTIONS.map((name) => (
                  <option key={name} value={name}>
                    {t(`graphics.motion.${name}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
```

    inside a piece's fieldset, before the `piece.text` field:

```tsx
              {piece.kind === "icon" && (
                <Field label={t("graphics.emoji")} hint={t("graphics.emojiHint")}>
                  <input maxLength={EMOJI_MAX} value={draft?.icon ?? piece.icon ?? ""} onChange={(event) => change(index, "icon", event.target.value)} />
                </Field>
              )}
```

    and the alert shows `t(failed === "emojiUnknown" ? "graphics.emojiUnknown" : "graphics.saveFailed")` when `failed !== null`.

- [ ] **Step 5: run** → PASS; whole suite and typecheck.

- [ ] **Step 6: mutation check**: `typedEmoji !== ""` removed; `motion !== storedMotion` removed; `NO_PICTURE.test(error)` → `true`; the pops hint shown always; `changeOf` icon line removed; `editable` loses the icon case; EditScreen's handler returns `null` on failure. All caught.

---

## Task 10: the kit in real Chrome (`graphics-kit-check.mjs`)

**Files:**
- Modify: `apps/desktop/scripts/graphics-kit-check.mjs`

- [ ] **Step 1**: import `imageFiles, readEmojiSet` from `../../../packages/core/src/graphics/emoji.ts` and `piecesOf` from `../../../packages/core/src/graphics/plan.ts`. Add cases — one per motion, portrait, style `bold-white`:

```js
const sticker = (name, emoji, motion, box, size = 0.2) => ({ name, style: "bold-white", canvas: portrait, spec: { kind: "sticker", version: KIT_VERSION, box, seconds: 3, emoji, motion, size, why: "" } })
// in CASES:
  sticker("sticker-fly-up", "🚀", "fly-up", { x0: 0.3, y0: 0.35, x1: 0.7, y1: 0.8 }),
  sticker("sticker-fly-across", "✈️", "fly-across", { x0: 0.08, y0: 0.6, x1: 0.92, y1: 0.75 }, 0.15),
  sticker("sticker-rain", "💸", "rain", { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.8 }, 0.15),
  sticker("sticker-bounce", "😱", "bounce", { x0: 0.35, y0: 0.55, x1: 0.65, y1: 0.8 }),
  sticker("sticker-float", "🎈", "float", { x0: 0.35, y0: 0.5, x1: 0.65, y1: 0.8 }),
  sticker("sticker-spin", "🪙", "spin", { x0: 0.35, y0: 0.55, x1: 0.65, y1: 0.8 }),
  sticker("sticker-pop", "🎉", "pop", { x0: 0.35, y0: 0.6, x1: 0.65, y1: 0.8 }),
```

  and an icon on an existing card case (e.g. add `{ kind: "icon", icon: "🔥", atS: 0.2 }` to one number card). In `build()`: `const set = await readEmojiSet(join(RESOURCES, "graphics", "emoji"))` once (make `build` async and await it at its call site), `const images = imageFiles(spec, set.keys)`, targets from `piecesOf(spec)`, pass `images` to `graphicHtml`, and copy each `images` file from `set.dir` next to `index.html`. `serve()` types gain `".png": "image/png"`. The report adds, for stickers, the number of `img.sticker` and whether every one `complete && naturalWidth > 0`, and leaves out the "font at register" line (a sticker draws no text, so its font never loads — that is not a failure).

- [ ] **Step 2: run it** with the installed pack:

```bash
node apps/desktop/scripts/graphics-kit-check.mjs --pack "$HOME/Library/Application Support/BOXBLACK/hyperframes/2026-09-24" --out <scratchpad>/kit-check-m24 --times 0.2,1,2,2.6,2.96 sticker-fly-up sticker-fly-across sticker-rain sticker-bounce sticker-float sticker-spin sticker-pop
```

  Expected per case: no warnings, `steady: true`, every picture loaded; PNGs at 0.2/1/2/2.6/2.96 s. Look at them (Read the PNGs): the rocket rises from the box's bottom, faster as it goes, with two fainter copies clearly behind it, and is near the top and fading at 2.6 s; the plane crosses; eight bills fall; the coin's shadow stays below it as it spins; nothing is cut at the render box's edge; at 2.96 s (the last frame drawn, where the fade ends) nothing is left. Fix the kit if not.

- [ ] **Step 3**: also run the card cases to see nothing changed for cards (`node … kanit-sale-yellow mali-cute-pink short-late` plus the icon case): icons show as 3D emoji at the card's right.

- [ ] **Step 4: one real HyperFrames render**, the way the app does it — the check above drives the page in puppeteer, not through `hyperframes render`, so this is the first time the pack serves the PNG and waits on the pictures. With the folders `build()` wrote for `sticker-fly-up` and the icon card, and the pack at `$P="$HOME/Library/Application Support/BOXBLACK/hyperframes/2026-09-24"` (find the node, hyperframes and chrome-headless-shell paths under it as `graphics-pack.ts` does), run each in a contained home as `runHyperframes` does (`HOME=<scratchpad>/hf-home`, `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_NO_UPDATE_CHECK=1`, `HYPERFRAMES_NO_AUTO_INSTALL=1`, `HYPERFRAMES_BROWSER_PATH=<chrome>`, `HYPERFRAMES_FFMPEG_PATH`/`HYPERFRAMES_FFPROBE_PATH` = the app's `resources/bin` tools):

```bash
"$NODE" "$HYPERFRAMES" render <scratchpad>/kit-check-m24/sticker-fly-up --format mov --fps 30 --workers 2 --quiet --frames-cache-dir off --player-ready-timeout 20000 -o <scratchpad>/kit-check-m24/sticker-fly-up.mov
```

  Expected: a `.mov` with `yuva444p12le` (ffprobe), 90 frames; `ffmpeg -ss 1.5 -i … -frames:v 1 -pix_fmt rgba frame.png` shows the rocket over transparency, not a blank frame (a blank frame means the picture was captured before it decoded, or not served). Never run `hyperframes feedback`.

---

## Task 11: the real test on 0917

- [ ] **Step 1**: back up 0917 (`cp -R "…/com.lveditor.draft/0917" <scratchpad>/0917-before-stickers`), note `ls ~/Movies/CapCut/BOXBLACK/graphics`, and ask the user to close CapCut. Start the dev app as in M23 (`--remote-debugging-port`), graphics switch on, level "จัดเต็ม".
- [ ] **Step 2**: on 0917 press "ให้ AI จัดลูกเล่น". Read the stored outline: which graphics Claude chose (kind, emoji, motion, box, why). Expect at least one sticker where speech names something visual, and no label-only card. If Claude picked no sticker, put one into the stored outline by hand (a `kind: "sticker"` cue on a spoken word of 0917, `edited: true` so a re-plan leaves it) so the render and the write are still exercised on a sticker.
- [ ] **Step 3**: wait for the renders (flair tab shows "พร้อม"); read each poster. Write to CapCut. Check the draft: one graphics overlay track, the `.mov` files under `~/Movies/CapCut/BOXBLACK/graphics`, bin items present.
- [ ] **Step 4**: ask the user to open 0917 in CapCut and look (they judge whether the stickers match what they had in mind, e.g. a rocket flying up on "ยานอวกาศ"). Record what they say.
- [x] **Step 5**: after the user closes CapCut, restore 0917 from the backup (move the written draft to `~/.Trash`, copy the backup back), `diff -r` against the backup → identical. Quit only the test app instance. Set the graphics switch back to what the user had.

**Result (2026-09-25):** Claude chose 🚀 fly-up on "อวกาศ" and 🪐 float on "ครับ", both at the minimum size 0.1, and kept the user's edited countdown card; all three rendered (~2.7 s each) and were written (`graphicCount 3, graphicsSkipped 0`). The user looked in CapCut and judged the stickers too small and the rocket's flight too short: dodging the face (keepClear 0.25–0.6) and the subtitles left the rocket a chest band 0.64–0.76 tall, so it hopped ~85 px. Two decisions followed, both taken by the user: stickers are bigger (0.2–0.3, 0.25 by default), and moving stickers may pass over faces. 0917 restored, identical to the backup.

---

## Task 11b: bigger stickers, and a rocket that crosses the frame

Added after the live test. **Files:** core `graphics/plan.ts` (+ test), `graphics/direct.ts` (+ test), main `graphics-cues.ts` (+ test), kit `timeline.js`, core `kit/version.ts`, `graphics-kit.test.ts`, `scripts/graphics-kit-check.mjs`.

- [x] **Step 1**: `STICKER_SIZE = { min: 0.2, max: 0.3, default: 0.25 }`; `CROSSING_MOTIONS` (fly-up, fly-across, rain) and `crossesKeepClear(motion)` in `plan.ts`. `settledMotion` unchanged.
- [x] **Step 2**: `direct.ts` — a crossing sticker's box may be up to 0.8 tall (`CROSSING_BOX_MAX_HEIGHT`, accepted to 0.85 as slack; `boxOf` takes the cap); the size line says 0.2–0.3, 0.25 when unsure, never shrink to fit; the box line lets fly-up/fly-across/rain cross keepClear; the fly-up line says the app stretches the box to its free stretch; room lines drop fly-up and cap rain at 0.8; `GRAPHICS_PROMPT_VERSION = "graphics-2026-09-25-stickers-2"`.
- [x] **Step 3**: `graphics-cues.ts` — a crossing sticker's `never` is the highlight text only (no keepClear); `tallestFreeBand` replaced by `freeBands` + `tallestOf`, computed once per sticker; after the dodge and the tallest-band fallback a stored fly-up takes the full height of the free stretch it overlaps most (else the tallest), x kept, then `settledMotion` as before; the stored cue object is returned untouched when nothing changed.
- [x] **Step 4**: kit `DEFAULT_SHARE = 0.25`, `KIT_VERSION = "kit-2026-09-25-2"`; the kit-check script's cases at the new sizes (spin box widened to 0.3–0.7 so a spin at 0.25 still has room).
- [x] **Step 5**: `npm test` 135 files, 1971 passed, 3 skipped; typecheck clean. Mutations: `graphics-cues.ts` 10 (9 caught, 1 equivalent: a placed box can overlap at most one free stretch, so "most overlap" and "first overlap" agree); `direct.ts` 6 of 6 caught. Second live test on 0917 (2026-09-25): Claude chose 👨‍🚀 pop at 0.22 and 🚀 fly-up at 0.25 (box 0.36–0.75, stretched to 0.35–0.74 between the highlight text and the subtitles: about 750 px over 3 s, past the right shoulder), kept the countdown card; written (`graphicCount 3`), the user looked in CapCut and closed it without objection; 0917 restored, identical. Spec review ✅ (five stale comments/fixtures fixed after it). Code-quality review: one Important (the prompt's room-line header still said to reduce the size while the size line said never to) and six Minor (float-exact identity compare, `freeBands` computed twice, cap constants not derived from one slack, `between()` name, a literal pin, a comment); all fixed, re-review ✅.

---

## Task 12: docs, version, DMG

- [x] **Step 1**: `docs/specs/2026-09-25-sticker-graphics-design.md` gets §13 "ผลที่ได้" (the live test, test counts, review). `docs/specs/2026-09-17-capcut-timeline-manager-design.md` §6 gains the M24 line; §7 unchanged except anything left open.
- [x] **Step 2**: memory — update `prodeck2-design-decisions.md` (M24: user picked Fluent 3D over flat/AI-drawn, label-only cards dropped, emoji icons; pictures ship in the app, the pack unchanged) and `hyperframes-spike-facts.md` if the real render taught anything new.
- [x] **Step 3**: `apps/desktop/package.json` version `0.3.0`. `npm test` and `npm run typecheck` green; note the counts. (135 files, 1,971 passed, 3 skipped; typecheck clean.)
- [ ] **Step 4**: `npm run dist -w @boxblack/desktop` (the customer release check must pass, emoji check included). Check the DMG holds `Contents/Resources/graphics/emoji/` with 1,597 entries. Hand the DMG to the user to install; after they say it is installed, compare `app.asar`'s sha256 with the build's and read the installed version (0.3.0).

---

## Self-review (done while writing)

- Spec coverage: §3.1 two kinds + label-only drop → Tasks 1, 7; emoji icons → 1, 5, 7, 8, 9; §3.2 motions → 4, 5, 10; §3.3 size/box/time/quota → 4 (size, room), 7 (clamp, cramped fly), existing `graphicsInForce`/`enforceGraphics` unchanged; §3.4 UI → 1 (summary), 9; §4 data → 1, 8; §4.1 keys → 2; §5 pictures + script + release check → 3; §6 render → 5, 6; §7 prompt/accept → 7; §8 app → 8, 9; §9 tests → every task; §11 files → file map; §12 order → task order.
- Changes from the spec, decided while planning and in the plan review of 2026-09-25 (the spec is updated to match): `index.json` carries `{ version, keys }` without English names (nothing reads them); a fly-up does not tilt (an emoji faces its own way — 🚀 already points up and to the right) and reaches the top on the last frame drawn, still moving as it fades, its trails a fixed 0.12/0.24 s behind; every motion runs to the end rather than standing still through the fade; a spin is shrunk only when its box has no room for its turn, a bounce jumps 0.3 of its size; a sticker's size is a share of the canvas's short side (a share of the width blurred on landscape); the fly→pop rule is applied when a graphic is read (`graphicsInForce`), like drift→punch, so a motion the user picks by hand is held to it too; a sticker with no clear place moves into the tallest free stretch of the frame before it is dropped; the picture set's commit is pinned in code (`EMOJI_SET`) so the render hash and the release check know it without reading files; a sticker's hash leaves out the font and palette; the pictures are read only for a graphic that draws an emoji, and a set that cannot be read leaves Claude an empty set rather than failing the plan; emoji are stored plain (no skin tone, no FE0F). Product decisions taken by the user in that review: a stored label-only card that Claude made no longer plays (the user's own does); a pointer (arrow or ring) with its label is still a card.
- Types used across tasks: `CardSpec`, `StickerSpec`, `GraphicSpec`, `isSticker`, `piecesOf`, `iconEmoji`, `upgradeSpec`, `STICKER_MOTIONS`, `STICKER_SIZE`, `LEGACY_ICONS` (Task 1), `settledMotion` (Task 8); `EMOJI_SET`, `EmojiSet`, `emojiKey`, `plainEmoji`, `keyOfCodepoints`, `readEmojiSet`, `imageFiles` (Task 2); `acceptGraphics(…, known)`, `cardAnchored`, `planGraphics({ known })` (Task 7); `GraphicPatch.emoji/.motion/pieces[n].icon` (Task 8); kit `easeOf`, `seeded`, `seedOf`, `stickerSize`, `stickerMoves` (Task 4) used by `kit.js` (Task 5); `GraphicSheet.onSave` answering `string | null` (Task 9).
