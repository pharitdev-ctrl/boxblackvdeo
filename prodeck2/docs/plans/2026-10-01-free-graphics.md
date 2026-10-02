# Free Graphics Implementation Plan (0.7.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude may put a motion graphic anywhere in the clip, not only on emphasis points, with a level of its own. Highlight text stays on screen beside it, unless a graphic tied to a point covers that point's own text. The app checks every graphic's room against highlight text, faces and other graphics. A new per-video pass records where things are in the picture, so graphics can sit beside a face and point at still objects. Release 0.7.0.

**Architecture:**
- **Planning (layer 1).** A new planning call (`packages/core/src/graphics/motion/free.ts`) replaces `planMotion`. It is given:
  - every word of the cut, numbered;
  - the points;
  - the highlight text groups, with times and bands;
  - the scenes on the cut, with their objects;
  - the subtitle band;
  - the user's own graphics.

  It answers graphics that start on a word number, with an optional point, a lowest level, a box, seconds, why and idea. Main admits each answer through the same room rules placement uses, and stores the ones that pass.
- **Placement.** `graphicsInForce` gains a second path for "free" graphics (a cue with `from`).
  - No dodging. A graphic is gone if it covers another point's text.
  - Its play is cut to 1.5 s if it covers a face or a shown thing.
  - A later graphic that overlaps an earlier one in time and box is dropped.
  - It replaces its own point's text only when its box covers that text.
  - Legacy graphics (no `from`) keep today's path unchanged.
- **Writing (layer 2).** The brief gains lines about the highlight text (replace, or do not repeat), the subtitles over the stage, and stages too small for text. `MOTION_VERSION` does not change, so 0.5.x graphics are not made stale.
- **Objects pass.** A separate Claude call per video (`packages/core/src/vision/objects.ts`) records boxes of things per existing scene. It has its own cache, so the vision insight, its scenes and the outline are untouched. It runs after vision in the prepare stage, and from a button for videos analysed before 0.7.0.
- **Screen.** The post page gets six tabs:
  - "ข้อความและเทคนิค" (highlight text, zooms, cutaways);
  - a new "กราฟิก" tab, which lists graphics in time order like the sound tab.

  The AI menu thinks again about each of the two separately.

**Tech Stack:** TypeScript on Node 26, Electron 44, React, zod 4, vitest. There is no git: "commit" means `npm test` green and `npm run typecheck` clean from the repo root.

**Spec:** `docs/specs/2026-10-01-free-graphics-design.md` (Thai, approved 2026-10-01). §4 and §9 were corrected after reading the code: the objects pass and the "ข้อความและเทคนิค" tab, both chosen by the user.

---

## How to run this plan

**Order** (in waves; within a wave no two implementers own the same file):
- **Wave 1:** Task 1 (core: graphic types and the free plan) and Task 2 (core: the objects pass).
- **Wave 2:**
  - Task 3 (main: running and storing the objects pass, the prepare API), after Task 2.
  - Task 4 (main: placement), after Tasks 1 and 2.
- **Wave 3:** Task 5 (main: planning, writing, works and rethink), after Tasks 1, 3 and 4; and Task 6a (the renderer's prepare line, Task 6 Step 7 with the `prepare.*` texts of Step 1), after Task 3.
- **Wave 4:** Task 6b (the rest of Task 6), after Tasks 4, 5 and 6a.
- In wave 2, Tasks 3 and 4 both touch `shared/api.ts`: Task 3 only the analysis API, the event and `FootageClip`-related types; Task 4 only `GraphicView`. Neither reformats the file.
- **Task 7** is the controller's: version, live test, docs.
- An implementer whose tests break because of another task's work in progress waits and runs them again, rather than fixing them.

**Briefs and rules:**
- Implementers get their brief as a file in `docs/plans/2026-09-30-freeform-motion-notes/prompts/` (prefix `r070-`).
- The common rules apply:
  - tests first;
  - no app, no build, no real Claude;
  - no `~/Movies`, no `~/Library`, no CapCut draft;
  - comments in plain English prose with no em-dashes;
  - user-facing text in Thai, in `i18n.ts` only;
  - nothing deleted outright (`mv <path> ~/.Trash/<name>-1001`).

**Reviews** read frozen snapshots (`snap.sh`).

**Prompts.** The two prompts Claude is given are in this plan, written by the controller. Implementers copy them verbatim.

## Files

| File | Responsibility | Task |
|---|---|---|
| `packages/core/src/graphics/plan.ts` | `GraphicCue.from`, `MotionSpec.replacesText`, the new constants | 1 |
| `packages/core/src/graphics/motion/free.ts` (new) | `FREE_PLAN_PROMPT`, `describeFreeClip`, `FreePlanSchema`, `acceptFreePlan`, `planFreeGraphics` | 1 |
| `packages/core/src/graphics/motion/write.ts` | `motionBrief` gains the text, subtitle and small-stage lines | 1 |
| `packages/core/src/vision/objects.ts` (new) | `OBJECTS_PROMPT`, `ObjectsReplySchema`, `acceptObjects`, `locateObjects`, `SceneObjects` | 2 |
| `packages/core/src/planner/footage.ts` | `FootageClip.objects?` | 2 |
| `apps/desktop/src/main/objects.ts` (new) | cache key, `locateVideos` (frames, call, store), `objectsFor` | 3 |
| `apps/desktop/src/main/analysis.ts`, `footage.ts`, `settings-api.ts`, `shared/api.ts`, `index.ts` | run after vision, load with footage, the two API methods, the event | 3 |
| `apps/desktop/src/main/graphics-cues.ts` | keep boxes, scenes on the cut, the free placement path, `admitFree`, covering, replaces, stale, views | 4 |
| `apps/desktop/src/main/highlights.ts`, `timeline.ts` | `replaced` from `replaces`; nothing else changes there | 4 |
| `apps/desktop/src/main/flair.ts`, `motion-write.ts` | `planGraphics` on the free plan, legacy-to-free on redo and edit, the brief inputs | 5 |
| `apps/desktop/src/main/post-plan.ts`, `emphasis.ts`, `highlight-api.ts`, `shared/api.ts` | works split: rethink `techniques` and `graphics`; `plannedOn.techniques` | 5 |
| `apps/desktop/src/renderer/src/edit/*`, `screens/PostScreen.tsx`, `screens/PrepareScreen.tsx`, `i18n.ts` | the tabs, the graphic list, the AI menu, the prepare line and button | 6 |

## Names shared across tasks

```ts
// packages/core/src/graphics/plan.ts (Task 1)
import type { FlairLevel } from "../flair/catalogue.ts"

export interface GraphicCue {
  anchor: CueAnchor
  spec: GraphicSpec
  edited: boolean
  off: boolean
  /** the emphasis point it tells the story of; on a legacy graphic, the point it was made for */
  pointId?: string
  /** the lowest level it plays at; absent on a graphic planned before 0.7.0 (a legacy one), which plays by its point's importance and always takes its point's text's place */
  from?: FlairLevel
}

export interface MotionSpec {
  // ...every field it has now, plus:
  /** written to show in place of its point's highlight text; absent on a legacy graphic */
  replacesText?: boolean
}
// PreviousFragment gains `replacesText?: boolean`, and isPrevious accepts it (undefined or a boolean).

export const isFree = (cue: GraphicCue): boolean => cue.from !== undefined

/** The shortest a free graphic plays. GRAPHIC_MIN_US (1.5 s) stays for legacy graphics and for the sounds' room floor. */
export const FREE_GRAPHIC_MIN_US = 800_000
/** The longest a graphic that covers a face or a shown thing plays. */
export const COVER_MAX_US = 1_500_000
/** The top of the frame kept for the social app's bar. */
export const TOP_KEPT = 0.07
/** A stage shorter than this many pixels holds no 44 px text with its margins. */
export const TEXT_STAGE_MIN_PX = 124
```

```ts
// packages/core/src/vision/objects.ts (Task 2)
export const OBJECT_KINDS = ["keep", "point"] as const
export interface SceneObject {
  what: string
  kind: (typeof OBJECT_KINDS)[number]
  /** shares of the source frame from its top-left */
  box: { x0: number; y0: number; x1: number; y1: number }
  still: boolean
}
/** One entry per scene of the insight it was made for, in the same order. */
export interface SceneObjects {
  version: string // OBJECTS_VERSION when made
  scenes: SceneObject[][]
}
export const OBJECTS_VERSION = "objects-2026-10-01"
```

```ts
// apps/desktop/src/main/graphics-cues.ts (Task 4)
export interface PlacedGraphic {
  // ...as now, plus (set on free graphics only):
  /** its box covers its own point's highlight text while it plays */
  covering?: boolean
  /** it plays in place of its point's text: covering, written and fresh */
  replaces?: boolean
  /** its box covers a face or a shown thing, so its play was cut to COVER_MAX_US */
  coversKeep?: boolean
}
```

```ts
// apps/desktop/src/shared/api.ts (Tasks 3, 4, 5)
// GraphicView gains:
from: FlairLevel | null          // null on a legacy graphic
replaces: boolean
coversKeep: boolean
// DesktopApi gains (Task 3):
videosWithoutObjects(folder: string): Promise<string[]>
locateObjects(folder: string, videoIds: string[]): Promise<void>
// AppEvent gains (Task 3):
{ type: "objects"; folder: string; videoId: string; status: { state: "running" } | { state: "done" } | { state: "failed"; error: string } }
// RETHINK_WORKS becomes ["techniques", "graphics", "sounds", "subtitles"] (Task 5)
// StoredEmphasis.plannedOn gains techniques?: number | null (Task 5)
// EmphasisView.changed gains techniques: boolean (Task 5)
```

---

### Task 1: Core: graphic types, the free plan, the brief lines

**Files:**
- Modify: `packages/core/src/graphics/plan.ts`, `plan.test.ts` (or the nearest existing test of `isPrevious`)
- Create: `packages/core/src/graphics/motion/free.ts`, `free.test.ts`
- Modify: `packages/core/src/graphics/motion/write.ts`, `write.test.ts`
- Modify: `packages/core/package.json` exports (`./graphics/motion/free`)

- [ ] **Step 1: types and constants.** Add the fields and constants in "Names shared across tasks" to `plan.ts`. `isPrevious` accepts `replacesText` undefined or boolean and refuses any other value. Test both.
- [ ] **Step 2: the prompt.** Copy `FREE_PLAN_PROMPT` verbatim from the block at the end of this task. Set `FREE_PLAN_PROMPT_VERSION = "free-plan-2026-10-01b"` (b: the tie rule reworded after review, 2026-10-01) and `FREE_PLAN_PROMPT: SystemPrompt = { system, version }`. Test that every reply field name appears as `\n- ${field}: ` in it.
- [ ] **Step 3: `describeFreeClip(clip: FreeClip): string`.** The input type is:
  ```ts
  export interface FreeClip {
    brief: Brief
    level: FlairLevel
    portrait: boolean
    /** the top of the subtitle band, or null with subtitles off */
    captionsFromY: number | null
    words: { text: string; atUs: number }[]
    points: { atUs: number; importance: Importance; type: EmphasisType; text: string; reason: string }[]
    texts: { startUs: number; endUs: number; point: number | null; band: { fromY: number; toY: number }; text: string }[]
    scenes: { startUs: number; endUs: number; kind: string; description: string; keepClear: { fromY: number; toY: number } | null; objects: SceneObject[] | null }[]
    own: { startUs: number; endUs: number; box: GraphicBox; idea: string; off: boolean }[]
  }
  ```
  `point` in `texts` is 1-based, matching the `points` list. The text has these lines, in this order. Each list says `ไม่มี` when empty. `clock` is the one in `flair/direct.ts`, and every number is printed with at most 2 decimals.
  - `brief`, `- ประเภทวิดีโอ: ${videoType ?? "ไม่ระบุ"}`, `- คำสั่งเพิ่มเติม: ${instructions.trim() || "ไม่ระบุ"}`
  - `ระดับที่ผู้ใช้เลือก: ${level}`
  - `จอ ${portrait ? "แนวตั้ง" : "แนวนอน"} · ${captionsFromY === null ? "ไม่มีซับ" : `ซับ: แถบ [${captionsFromY}, 1] อยู่ข้างหน้ากราฟิก`}`
  - `คำพูด`, then `${i+1}. ${clock(atUs)} ${text}`
  - `จุดเน้น`, then `[${i+1}] ${clock(atUs)} (${pointLabel(importance, type)}) “${text}”${reason ? ` — ${reason}` : ""}`
  - `ข้อความเด่น`, then `- ${clock(startUs)}–${clock(endUs)} ${point ? `จุด ${point}` : "ไม่มีจุด"} แถบ [${fromY}, ${toY}] “${text}”`
  - `ฉาก`, then:
    - `- ${clock(startUs)}–${clock(endUs)} ${kind} · ${description} · ${keepClear ? `keepClear [a, b]` : "keepClear ไม่มี"}`;
    - when `objects` is not null, a second line `    ของ: ${objects.map(o => `${o.kind} “${o.what}” [x0, y0, x1, y1]${o.still ? " นิ่ง" : ""}`).join(" · ") || "ไม่มี"}`;
    - when it is null, `    ของ: ไม่ได้จด`.
  - `กราฟิกที่ผู้ใช้ใส่เอง`, then `- ${clock(startUs)}–${clock(endUs)} [x0, y0, x1, y1] ${idea}${off ? " (ปิดไว้)" : ""}`

  Test: the exact text of a small clip with every list filled, then with every list empty.
- [ ] **Step 4: the schema and `acceptFreePlan`.**
  ```ts
  export const FreePlanSchema = z.object({
    graphics: z.array(z.object({
      word: z.number().int(),
      until: z.number().int().default(0),
      seconds: z.number(),
      point: z.number().int().default(0),
      from: z.enum(FLAIR_LEVELS),
      box: z.array(z.number()),
      why: z.string().default(""),
      idea: z.string().default(""),
    })),
  })
  export interface PlannedFree { word: number; point: number | null; from: FlairLevel; seconds: number; box: GraphicBox; why: string; idea: string }
  export function acceptFreePlan(reply: FreePlan, clip: Pick<FreeClip, "words" | "points">): { graphics: PlannedFree[]; dropped: number }
  ```
  Numbers in the reply are 1-based. In what is returned, `word` and `point` are 0-based. Each answer goes through these rules:
  - **Dropped, and counted in `dropped`:**
    - a `word` out of range;
    - a box that is not 4 finite numbers with `0 <= x0 < x1 <= 1` and `y0 < y1 <= 1`;
    - a box whose top is above the kept band, i.e. `y0 < TOP_KEPT - 0.005`;
    - an empty idea, once it is made one line and cut to 400 graphemes with `clipText`;
    - a second answer on the same word.
  - **Becomes null:** a `point` of 0 or out of range.
  - **`until`:**
    - An `until` of 0, out of range or before `word` is taken as none.
    - Otherwise the graphic must last until that word: `landsS = (words[until-1].atUs - words[word-1].atUs) / 1e6 + 1` (one second to read and leave).
  - **`seconds`:**
    - `asked` is the answer's seconds, or 3 when not finite.
    - It becomes `max(asked, landsS)`, clamped to `[FREE_GRAPHIC_MIN_US / 1e6, GRAPHIC_MAX_S]` and rounded to the millisecond.
  - **`why`** is trimmed.

  A stand-in reply with no list returns nothing dropped. Tests cover each rule.
- [ ] **Step 5: `planFreeGraphics(args)`.**
  - **Args:** `{ transport, model, clip: FreeClip, frames: { label: string; path: string }[], prompt?: SystemPrompt, signal? }`.
  - **Content:** one text part with `describeFreeClip(clip)`, then, for each frame that can be read, a text part with its label followed by the JPEG. A frame that cannot be read is left out, as `planMotion` does today.
  - **The call:** `transport.generate` with `system`, `schema: FreePlanSchema`, `maxTokens: 16_000` and `signal`. It returns `acceptFreePlan(reply.output, clip)`.
  - **No words:** with `clip.words` empty it makes no call and returns `{ graphics: [], dropped: 0 }`.
  - Tests use a fake transport.
- [ ] **Step 6: brief lines.** `motionBrief(args)` gains three optional arguments, each adding one line before `- What to draw:` when given:
  - `text?: { replaces: string } | { pairs: true }`:
    - replaces: `- Highlight text: this graphic shows in place of the highlight text "${replaces}", which does not show while it plays. Carry its key words in the graphic, short and exact.`
    - pairs: `- Highlight text: the highlight text of this moment shows elsewhere on screen. Do not repeat its words.`
  - `captionsFromPx?: number` (the stage's own y where the subtitles start, `0 <= px < H`):
    `- Subtitles cover the stage from y = ${px} px to its bottom, in front of the graphic. Keep every text, number and the focal point above y = ${px}.`
  - When `stage.height < TEXT_STAGE_MIN_PX`:
    `- The stage is too small for text: draw shapes only, with no text.`

  `MOTION_WRITE_PROMPT_VERSION` becomes `"motion-write-2026-10-01b"`. `MOTION_VERSION` does not change. Test the exact brief with each line and with none.
- [ ] **Step 7.** Run `npm test` and `npm run typecheck`.

```text
FREE_PLAN_PROMPT:
คุณออกแบบ "โมชันกราฟิก" ให้วิดีโอสั้นทั้งคลิป เลือกว่าช่วงไหนควรมีกราฟิก คิดไอเดียของแต่ละชิ้น และวางกรอบบนจอ โมชันกราฟิกคือภาพเคลื่อนไหวที่วาดเฉพาะช่วงนั้น วางซ้อนบนวิดีโอ และขยับตามจังหวะคำพูด ขั้นถัดไปจะมีนักออกแบบเขียนแอนิเมชันจริงจากไอเดียของคุณ นักออกแบบเห็นแค่ไอเดีย คำที่พูดพร้อมเวลา และขนาดกรอบ ไม่เห็นวิดีโอ

ข้อมูลที่ได้: brief · ระดับที่ผู้ใช้เลือก · คำพูดทุกคำของคลิปที่ตัดแล้วพร้อมเลขคำและเวลา · จุดเน้นพร้อมความสำคัญ · ข้อความเด่นแต่ละกลุ่มพร้อมช่วงเวลาที่ขึ้น แถบบนจอ และเลขจุดของมัน · แถบซับ · ฉากพร้อมช่วงเวลา keepClear และของในภาพ (ถ้าจดไว้) · กราฟิกที่ผู้ใช้ใส่เอง · เฟรมของบางช่วงแนบท้าย
พิกัดทั้งหมดเป็นสัดส่วน 0–1 นับจากมุมซ้ายบนของจอ · แถบ [บน, ล่าง] = เต็มความกว้าง · กรอบ [ซ้าย, บน, ขวา, ล่าง]
คำพูดถอดจากเสียง อาจสะกดผิด ให้อ่านความหมายจากทั้งประโยค

ใส่ตรงไหน
- ข้อความเด่นยังขึ้นตามปกติ กราฟิกเป็นตัวเสริม ไม่ต้องดีกว่าตัวหนังสือ ใส่ได้ทุกช่วงของคลิปที่ภาพช่วยให้คนดูเข้าใจหรือรู้สึกตามได้ ไม่ต้องอยู่บนจุดเน้น
- เหมาะ: ตัวเลขหรือสถิติ (ตัวเลขวิ่ง มาตรวัด วงแหวนเปอร์เซ็นต์) · การเทียบ (แท่งเทียบ ก่อนกับหลัง) · ขั้นตอนหรือรายการ (เส้นเวลา รายการติ๊ก) · การเคลื่อนที่หรือการเปลี่ยนแปลง · ของ การกระทำ คำเตือน หรืออารมณ์ที่วาดเป็นภาพได้ · ภาพประกอบเล็ก ๆ ที่เข้ากับคำพูด เช่น จรวดเล็กลอยข้างคำว่า "อวกาศ"
- ห้าม: รูปถ่าย โลโก้ หน้าคนจริง อีโมจิ · หนึ่งชิ้นมีเรื่องเดียว
- ระดับ: ทุกชิ้นบอกระดับต่ำสุดที่เล่น light = เฉพาะช่วงที่สำคัญที่สุด · medium = เพิ่มชิ้นที่ช่วยเสริมชัด · heavy = ใส่เต็มที่ คำตอบเดียวใช้ได้ทุกระดับ จึงให้ระดับต่ำสุดที่แต่ละชิ้นควรเล่น และใส่ให้ระดับที่ผู้ใช้เลือกเต็มอย่างน้อยเท่าที่ระดับนั้นขอ

ข้อความเด่น
- ชิ้นที่เล่าเรื่องของจุดเน้นไหน ให้บอกเลขจุด ชิ้นนั้นต้องเริ่มในช่วงของจุดนั้น คือช่วงที่ข้อความเด่นของจุดขึ้น หรือช่วงที่จุดนั้นเล่นถ้าจุดไม่มีข้อความเด่น
- ชิ้นที่ผูกจุดวางทับแถบข้อความเด่นของจุดตัวเองได้ เมื่อทับ ข้อความนั้นจะไม่ขึ้น และกราฟิกต้องพาคำสำคัญของจุดมาด้วย สั้น ๆ ตรงตัว ใช้เมื่อไม่มีที่ว่างอื่น
- ห้ามทับแถบข้อความเด่นอื่นที่ขึ้นอยู่ช่วงเดียวกับกราฟิก

กรอบ
- ไม่มีขนาดขั้นต่ำ ให้ใหญ่เท่าที่ไอเดียต้องการและที่ว่างมี · กรอบที่สูงไม่ถึง 0.07 ของจอใส่ตัวหนังสือไม่ได้ ให้เป็นภาพล้วน
- เว้น 0.07 บนสุดของจอไว้ให้แถบเมนูของแอปโซเชียล
- เลือกที่ว่างที่เหมาะเองจากหน้าคน ข้อความเด่น และซับของช่วงนั้น ไม่ต้องอยู่ครึ่งล่าง
- ซับอยู่ข้างหน้ากราฟิก กรอบทับแถบซับได้ แต่ตัวหนังสือ ตัวเลข และจุดสนใจของกราฟิกต้องอยู่นอกแถบซับ
- ของชนิด keep (หน้าคน ของที่โชว์ ตัวหนังสือในภาพ) หรือแถบ keepClear ของฉากที่ไม่ได้จดของ ห้ามทับ ยกเว้นชิ้นที่ขึ้นจอรวมไม่เกิน 1.5 วินาที
- ชี้หรือวางข้างของในภาพได้เฉพาะของชนิด point ที่นิ่ง ใช้กรอบของเป็นตำแหน่ง และไอเดียต้องบอกว่าชี้อะไร อยู่ตรงไหนของกรอบ
- กราฟิกสองชิ้นขึ้นพร้อมกันได้ถ้ากรอบไม่ทับกัน ถ้ากรอบทับกัน ชิ้นแรกต้องจบก่อนชิ้นถัดไปขึ้น · กราฟิกที่ผู้ใช้ใส่เองก็เช่นกัน

ตอบต่อกราฟิก เรียงตามเวลา
- word: เลขคำที่กราฟิกเริ่มขึ้น · เลือกคำที่มาก่อนคำสำคัญเล็กน้อย เพื่อให้ขึ้นทันก่อนถึงจังหวะหลัก
- until: เลขคำสุดท้ายที่ไอเดียใช้เป็นจังหวะ แอปจะให้อยู่ถึงคำนี้แล้วเผื่อเวลาให้อ่านและออกเอง · 0 = ไอเดียไม่ผูกกับคำไหนหลังคำเริ่ม
- seconds: อยากให้อยู่นานกี่วินาที 0.8–6 นับจากคำเริ่ม ถ้าคำใน until มาช้ากว่านั้น แอปยืดให้ · ชิ้นที่ทับของชนิด keep ไม่เกิน 1.5
- point: เลขจุดเน้นที่ชิ้นนี้เล่าเรื่อง · 0 = ไม่ผูกจุด
- from: ระดับต่ำสุดที่เล่น "light" "medium" หรือ "heavy"
- box: [ซ้าย, บน, ขวา, ล่าง]
- why: หนึ่งบรรทัดว่าทำไมตรงนี้
- idea: วาดอะไรและขยับอย่างไร เป็นภาษาไทย หนึ่งถึงสองประโยค ชัดพอให้นักออกแบบลงมือได้โดยไม่ต้องเดา
  · บอกของที่อยู่ในภาพ สิ่งที่ขยับ และคำพูดคำไหนเป็นจังหวะของอะไร โดยยกคำมาใส่ในเครื่องหมายคำพูด
  · ข้อความหรือตัวเลขที่ต้องขึ้นบนกราฟิกให้เขียนมาตรงตัว สั้น ๆ ตัวเลขใช้เลขอารบิก
  · ใช้ได้เฉพาะสิ่งที่วาดเองได้: เส้น รูปทรง ไอคอนง่าย ๆ และตัวหนังสือ
  · ไม่ต้องระบุสี นักออกแบบใช้ชุดสีของสไตล์ที่ผู้ใช้เลือก
  · ตัวอย่าง: ตัวเลขวิ่งจาก 0 ถึง 28,000 หยุดพอดีคำว่า "สองหมื่นแปดพัน" แล้วหน่วย "กม./ชม." เด้งขึ้น มีเข็มวัดความเร็วกวาดตามตัวเลข
  · ตัวอย่าง: จรวดเล็กวาดด้วยเส้นลอยขึ้นข้างหน้าคนตอนพูด "อวกาศ" แล้วหายไปด้านบน (ภาพล้วน กรอบเล็ก)
  · ตัวอย่าง: ลูกศรโค้งชี้ลงที่แก้วบนโต๊ะ (ของชนิด point ที่นิ่ง กรอบ [0.62, 0.55, 0.8, 0.7]) พร้อมป้าย "แก้วเก็บความเย็น" เด้งข้างลูกศรตอนพูด "แก้วใบนี้"
```

### Task 2: Core: the objects pass

**Files:**
- Create: `packages/core/src/vision/objects.ts`, `objects.test.ts`
- Modify: `packages/core/src/vision/index.ts` (exports), `packages/core/src/planner/footage.ts` (`FootageClip.objects?: SceneObjects | null`, optional, so no literal elsewhere has to change)

- [ ] **Step 1: types, version and prompt.**
  - Add the types and `OBJECTS_VERSION` from "Names shared across tasks".
  - Copy `OBJECTS_PROMPT` verbatim from the block below, as `OBJECTS_PROMPT: SystemPrompt = { system, version: OBJECTS_VERSION }`.
  - A server override is not supported for this prompt.
- [ ] **Step 2: schema and `acceptObjects`.**
  ```ts
  export const ObjectsReplySchema = z.object({
    scenes: z.array(z.object({
      scene: z.number().int(),
      objects: z.array(z.object({ what: z.string(), kind: z.enum(OBJECT_KINDS), box: z.array(z.number()), still: z.boolean().default(false) })).default([]),
    })),
  })
  export function acceptObjects(reply: ObjectsReply, sceneNumbers: number[]): Map<number, SceneObject[]>
  ```
  - `sceneNumbers` are the 1-based scene numbers this batch was asked about.
  - An entry for a scene not asked about is ignored.
  - A box that is not 4 finite numbers with `0 <= x0 < x1 <= 1` and `0 <= y0 < y1 <= 1` drops that object.
  - `what` is trimmed and cut to 60 graphemes. An empty one drops the object.
  - At most 6 objects are kept per scene, in the order given.
  - A scene asked about with no entry maps to `[]`.

  Tests cover each rule.
- [ ] **Step 3: `locateObjects(args)`.**
  - **Args:** `{ transport, model, frames: FrameImage[], scenes: Scene[], batchSize: number, signal?, onProgress? }`.
  - **Batches.** It batches frames as `describeVideo` does, at most `batchSize` per call. For each batch, the scenes asked about are those overlapping its window, from its first frame to the next batch's first frame.
  - **Content of each call:**
    - first, the text `ฉาก`, then one line per scene asked about: `${n}. ${sec(startUs)}–${sec(endUs)} วินาที · ${description}`, where `n` is the 1-based index into `scenes` and `sec` gives 1 decimal;
    - then each frame as `ภาพที่ ${i} · เวลา ${s} วินาที` followed by its JPEG, as `describeVideo` labels them.
  - **The call:** `maxTokens: 8000`, `schema: ObjectsReplySchema`.
  - **Merging.** A scene asked about by two batches keeps the first batch's objects, and the second batch only adds objects whose `what` is new.
  - **Return:** `{ version: OBJECTS_VERSION, scenes }`, with `scenes.length === scenes.length` (`[]` where nothing was found). A batch that throws fails the whole call.
  - **No scenes:** it makes no call and returns `{ version, scenes: [] }`.
  - Tests use a fake transport.
- [ ] **Step 4.** Run `npm test` and `npm run typecheck`.

```text
OBJECTS_PROMPT:
คุณดูภาพจากวิดีโอทีละช่วง แล้วจดตำแหน่งของในภาพของแต่ละฉาก เพื่อให้แอปวางกราฟิกไม่บังของสำคัญ และชี้ของที่อยู่นิ่งได้

ได้รับ: รายการฉากที่แบ่งไว้แล้ว (เลขฉาก ช่วงเวลา คำบรรยาย) และภาพของช่วงนั้นพร้อมเวลา

ตอบต่อฉาก
- scene: เลขฉากตามรายการ
- objects: ของในฉากนั้น ไม่เกิน 6 อัน เรียงจากสำคัญมากไปน้อย แต่ละอัน:
  - what: ของนั้นคืออะไร ภาษาไทยสั้น ๆ
  - kind: "keep" = ส่วนที่ห้ามมีอะไรไปบัง ได้แก่ ใบหน้าคน ของหรือสินค้าที่กำลังโชว์ ตัวหนังสือที่อยู่ในภาพ · "point" = ของที่เห็นชัดและกราฟิกชี้ได้ เช่น สินค้าบนโต๊ะ ป้าย เครื่องมือ (หน้าคนเป็น keep เสมอ)
  - box: [ซ้าย, บน, ขวา, ล่าง] เป็นสัดส่วน 0–1 ของภาพ นับจากมุมซ้ายบน ให้ครอบทุกเฟรมของฉากนั้น ถ้าคนหรือของขยับให้กรอบกว้างพอ
  - still: true เมื่อของอยู่ที่เดิมตลอดฉาก
- ไม่ต้องจดลำตัว มือ ฉากหลัง หรือข้าวของทั่วไปที่ไม่มีใครพูดถึง · ฉากที่ไม่มีของที่ต้องจด ให้ objects เป็นรายการว่าง
เขียน what เป็นภาษาไทย
```

### Task 3: Main: running and storing the objects pass; the prepare API

**Files:**
- Create: `apps/desktop/src/main/objects.ts`, `objects.test.ts`
- Modify: `apps/desktop/src/main/analysis.ts` (+test), `footage.ts` (+test), `settings-api.ts`, `shared/api.ts`, `index.ts`, `license-api.ts` (+test), `renderer/test/fake-api.ts`

- [ ] **Step 1: the cache and its key.**
  - The objects cache is a `MediaCache<SceneObjects, ObjectsKey>` in `join(userData, "insights-objects")`, made in `index.ts` next to the insights cache.
  - `ObjectsKey` is `VisionKey & { objects: string; scenes: string }`:
    - `objects` is `OBJECTS_VERSION`;
    - `scenes` is the first 16 hex characters of the sha256 of `JSON.stringify(insight.scenes.map(s => [s.startUs, s.endUs, s.description]))`.

    An insight described again, with other scenes, therefore misses its old objects instead of reading them with the wrong indices.
  - `objectsFor(deps, videoPath, insightKey, insight)` reads the entry, or answers null.
  - Test a hit, a miss after the scenes change, and a miss after `OBJECTS_VERSION` changes.
- [ ] **Step 2: `locateVideos(args)`.** For each video with a fitting insight (`fittingInsight` in `footage.ts`):
  1. It skips the video when objects are already cached, emitting `done`.
  2. Otherwise it extracts frames with the vision settings in force (`visionSampling(frameEveryS)`, as `analysis.ts` passes them, and `extractFrames`), and calls `locateObjects` with batch size 30 (the vision `estimate.ts` constant).
  3. It stores the result with `entry.put` and deletes the frames in `finally`.

  It emits `running`, `done` or `failed` per video through a callback, and runs one video at a time. A video with no fitting insight is `failed` with `the pictures of this video are not analysed yet`. Tests use fakes for frames and transport.
- [ ] **Step 3: after vision.**
  - In `analysis.ts` `start`, once `describeVideos` has finished, the same job runs `locateVideos` for the videos it described or read. It sends `{ type: "objects", folder, videoId, status }` events.
  - A failure of this pass is sent as the event and does not change the analysis outcome.
  - `analysis-finished` is sent after it.
  - The vision statuses, and so "วิเคราะห์แล้ว", do not wait for it: they are already done when it starts.
  - Test the event order and that a failing pass leaves `outcome: "done"`.
- [ ] **Step 4: footage.** `loadFootage` adds `objects: await objectsFor(...)` to each clip, or null without an insight. `CutClip` gets it through `FootageClip`. Test that an old insight with no objects entry loads with `objects: null`.
- [ ] **Step 5: the API.**
  - `videosWithoutObjects(folder)` lists the project's analysed videos (`analysedVideos`) that have no objects entry.
  - `locateObjects(folder, videoIds)`:
    - takes the analysis service's one-job lock: it throws `an analysis is already running` while one runs, and a start throws the same while it runs;
    - runs `locateVideos` with the same events, then sends `analysis-finished` with `outcome: "done"`, or `"cancelled"` when `cancelAnalysis` stopped it;
    - checks the folder and the ids as `startAnalysis` does.
  - Add both to `DesktopApi`, `API_METHODS`, `settings-api.ts` and `fake-api.ts`. Add `locateObjects` to `LICENSED_METHODS` and its pinned list.
  - Tests cover the lock and the refusals.
- [ ] **Step 6.** Run `npm test` and `npm run typecheck`.

### Task 4: Main: placement of free graphics

**Files:**
- Modify: `apps/desktop/src/main/graphics-cues.ts` (+test), `highlights.ts` (+test), `timeline.ts` (+test only if a replaced test changes), `shared/api.ts` (`GraphicView.from`, `GraphicView.replaces`)

Legacy graphics (no `from`) keep every rule they have now: the point filter at the level, dodging, `GRAPHIC_MIN_US`, and always replacing their point's text when written and fresh. Every existing test of them must stay green unchanged.

- [ ] **Step 1: keep boxes on the cut.**
  ```ts
  export function keepBoxesIn(plan: CutPlan, clips: CutClip[], span: Span): GraphicBox[]
  ```
  It walks the cuts as `keepClearsIn` does. For each scene overlapping the span:
  - with objects (`clip.objects?.scenes[index]`), the boxes of its `keep` objects;
  - without objects for that clip, its `keepClear` band as `{ x0: 0, y0: fromY, x1: 1, y1: toY }`;
  - with neither, nothing.

  Test: a clip with objects, a clip without, and a scene with no band.
- [ ] **Step 2: scenes on the cut, for the request.**
  ```ts
  export function scenesOnCut(plan: CutPlan, clips: CutClip[]): FreeClip["scenes"]
  ```
  Each scene of each kept piece, with its timeline span (the part of the scene the piece plays), kind, description, keepClear and `objects` (null when the clip has none). Consecutive entries of the same scene are merged into one. Test with two pieces of one scene and a cut between scenes.
- [ ] **Step 3: room rules, shared by admission and placement.**
  ```ts
  export interface FreeRoom {
    /** bands of highlight text on screen in the span, with the point each group was made for */
    textIn: (span: Span) => { band: Band; pointId?: string }[]
    keepIn: (span: Span) => GraphicBox[]
  }
  export function roomOf(cue: GraphicCue, span: Span, room: FreeRoom): { gone: true } | { gone: false; covering: boolean; coversKeep: boolean }
  ```
  - **gone:** its box covers (on the y axis, as `covers` does) the band of a text group of another point, or of a group with no point.
  - **covering:** it is tied (`pointId`), and its box covers a band of its own point's text in the span.
  - **coversKeep:** its box overlaps a keep box in two dimensions (both axes overlap, with a positive area).
  - Subtitles are never considered.
  - `GraphicBox` overlap is a new small helper, `boxesOverlap(a, b)`, tested on its edges: touching is not overlapping.
- [ ] **Step 4: the free path in `graphicsInForce`.**
  - **Input.** It gains:
    - `room: FreeRoom` (Step 3);
    - `pointPlaced: (pointId) => boolean`, true when the point is on this cut at any importance (the filter at "heavy").
  - **Filtering.** A free cue is skipped, not counted:
    - when `FLAIR_LEVELS.indexOf(cue.from) > FLAIR_LEVELS.indexOf(flair.level)`;
    - or when it is tied to a point that is not placed.
  - **Length.** Its length is found as now, with `FREE_GRAPHIC_MIN_US` in place of `GRAPHIC_MIN_US` for the room floor.
  - **Room.** Then `roomOf` on its stored box (not moved):
    - gone: counted in `gone`, as a graphic with no room is now, unless it is off;
    - `coversKeep`: `durationUs = min(durationUs, COVER_MAX_US)`.
  - **Order and overlap.**
    - `enforceGraphics` runs over legacy and free together, as now.
    - Afterwards, among free graphics only and in time order, one whose span overlaps an earlier kept graphic's span (legacy or free) and whose box overlaps that one's box (`boxesOverlap`) is dropped and counted.
    - A legacy graphic is never dropped for a free one.
    - A free graphic's minimum length after `enforceGraphics` is `FREE_GRAPHIC_MIN_US`. Change `enforceGraphics` to take the floor per cue: `isFree(cue) ? FREE_GRAPHIC_MIN_US : GRAPHIC_MIN_US`.
  - **Stale.** `withWordsNow` stays as it is, and for a free cue adds: `spec.html !== null && spec.replacesText !== covering`.
  - **Replaces.** `replaces = covering && hasJob(graphic)`.
  - **Fields.** `covering`, `replaces` and `coversKeep` are set on free placed graphics only.
  - **Off.** The off list follows the same rules, so a switched-off graphic says what it would do switched on.

  Tests:
  - the level hides a free graphic at a lower level and shows it at its own;
  - a free graphic tied to a point that was cut away is hidden;
  - another point's text makes it gone, and its own point's text makes it covering;
  - a keep box cuts its play to 1.5 s, and a keepClear band does the same for a clip without objects;
  - two free graphics overlapping in time and box drop the later one, while overlapping in time only keeps both;
  - a free graphic never moves a legacy one;
  - `replacesText` written true and covering now false makes it stale, and the other way round too;
  - an 0.9 s free graphic plays, and the same length on a legacy one does not.
- [ ] **Step 5: replaced text.**
  - `replacesText(graphic)` answers `graphic.replaces === true` for a free graphic, and keeps today's rule for a legacy one.
  - `replacedPoints` and `isReplaced` are unchanged, so the preview, the write and the subtitles' hidden words all follow.
  - Wire the new inputs in `highlights.ts` `graphicsOn`:
    - `room.textIn` from the same `bands`, each with its group's `pointId`;
    - `room.keepIn` from `keepBoxesIn`;
    - `pointPlaced` from `pointFilter(placed, "heavy")`.

  Tests in `highlights.test.ts`:
  - a free graphic beside its point's text leaves the group shown;
  - one over it marks the group `replaced`;
  - a legacy one still replaces.
- [ ] **Step 6: views.** `graphicViews` sets:
  - `from: cue.from ?? null`;
  - `replaces: graphic.replaces ?? replacesText(graphic)`;
  - `coversKeep: graphic.coversKeep === true`.

  Add the three fields to `GraphicView` and to the fake api's fixtures where a `GraphicView` literal is built. Test.
- [ ] **Step 7: admission.**
  ```ts
  export function admitFree(cues: GraphicCue[], placedOf: (cue: GraphicCue) => { atUs: number; durationUs: number } | null, room: FreeRoom, others: { span: Span; box: GraphicBox }[]): { admitted: GraphicCue[]; dropped: number }
  ```
  It is used by Task 5 on Claude's answers, in time order. For each cue:
  - It is dropped:
    - when it has no place;
    - when `roomOf` says gone;
    - when it is tied and its start is outside every span of its own point's text groups;
    - when it overlaps in time and box any of `others` (the user's own graphics) or an earlier admitted cue.
  - **coversKeep:** `spec.seconds` becomes `min(seconds, COVER_MAX_US / 1e6)`.

  Tests cover each rule.
- [ ] **Step 8.** Run `npm test` and `npm run typecheck`.

### Task 5: Main: planning, writing, works and rethink

**Files:**
- Modify: `apps/desktop/src/main/flair.ts` (+`flair-plan.test.ts`, `flair.test.ts` where they pin planning), `motion-write.ts` (+test), `post-plan.ts` (+test), `emphasis.ts` (+test), `highlight-api.ts` (+test), `shared/api.ts`
- Move to the Trash once unused: `planMotion`, `acceptMotionPlan`, `MotionPlanReplySchema` and `MOTION_PLAN_PROMPT` in `packages/core/src/graphics/motion/direct.ts`, with their tests, and the exports that name them. Helpers still used elsewhere (`motionWords`, `framesToAttach`, `describePoints` if still used) stay. Say in the report what moved.

- [ ] **Step 1: `planGraphics` on the free plan.** Keep its shape and its results (`{ count, dropped, skipped? }`). Inside:
  1. **The clip.** Build the `FreeClip`:
     - `words` from `wordsOnCutAt(spoken)` (the same numbering as the sound plan);
     - `points` from `placedPoints` in playing order;
     - `texts` from `textBands` with every point shown, as today, each with its group's text (lines joined by a space) and its point's 1-based number;
     - `scenes` from `scenesOnCut`;
     - `own` from the user's edited graphics placed with `graphicsInForce` at "heavy", including those switched off;
     - `captionsFromY` as today;
     - `level` from `view.flair.level`.
  2. **Frames.** The frames are today's per-point frames (`graphicFrames`). The label of each is `เฟรมที่ ${clock(atUs)}`.
  3. **Call and cues.** Call `planFreeGraphics`. Turn each planned graphic into a cue:
     - `anchor`: the word's anchor;
     - `pointId`: the point's id, or none;
     - `from`;
     - `spec`: `{ kind: "motion", version: MOTION_VERSION, box, seconds, why, idea, words: wordsFrom(anchor, seconds), html: null }`;
     - `edited: false`, `off: false`.
  4. **Admission.** Run `admitFree` with the room of this cut and the user's graphics as `others`.
  5. **Storing.** Store in one `amend`:
     - The user's edited graphics stay.
     - Every graphic Claude made before (legacy or free) is replaced by the admitted ones.
     - An admitted cue at the same place as one of the user's (`samePlace`) is dropped.
     - Composed sounds tied to graphics that went go with them, with `withoutTiedTo`, as now.
     - The CapCut cue cleanup (`withoutSoundsOn`) stays as it is.
  6. **Writing.** Write the unwritten graphics in force at the chosen level, as now.

  `dropped` is the plan's drops plus the admission's plus the failed writes. Tests:
  - the request has every word;
  - answers become cues with `from` and an optional point;
  - admission drops are counted;
  - the user's graphics stay;
  - tied sounds follow;
  - legacy graphics are replaced by a new plan.
- [ ] **Step 2: legacy turns free when written again.**
  - In `placedToWrite`, a legacy cue (no `from`) is stored as free before it is written:
    - `from` from its point's importance (`key` → light, `secondary` → medium, `extra` → heavy; no point → heavy);
    - `spec.box` set to the box it plays in now (the dodged one).
  - It is then placed again with the free rules. If it is gone there, the redo or edit fails with `this graphic has no place on the clip now`, the message that exists today.
  - Test with a legacy graphic redone and edited.
- [ ] **Step 3: the brief inputs.**
  - `PieceToWrite` gains `text?: { replaces: string } | { pairs: true }` and `captionsFromPx?: number`, passed through to `motionBrief`.
  - In `writeGraphic`, for the placed free graphic:
    - `text` is `{ replaces: <its point's text> }` when `covering`, else `{ pairs: true }`;
    - `captionsFromPx` is the stage's y of `SUBTITLE_ROOM_FROM_Y` when subtitles are on and the box reaches below it: `round((captionsFromY - y0) / (y1 - y0) * stageHeight)`, clamped to at least 0.
  - **What is stored.** `afterWriting` and `afterEdit` store `replacesText: covering`. `fragmentHeld`, `keptBefore` and `steppedBack` carry it with the fragment, so an undo brings back the one it was written with.
  - **The data the writer needs.** `placedToWrite` and `planGraphics` need the point's text and the subtitle state. Get them from `graphicJobs` by having it also return, per kept and off graphic, `pointText?: string` (its point's groups' text). Extend the existing return rather than adding a call.
  - Tests:
    - a covering graphic's brief has the replace line with the text;
    - a beside one has the pairs line;
    - a box over the subtitles has the subtitle line;
    - a 100 px stage has the shapes-only line;
    - the stored `replacesText` follows `covering`.
- [ ] **Step 4: works and rethink.**
  - **`RETHINK_WORKS`** becomes `["techniques", "graphics", "sounds", "subtitles"]`, and `RETHOUGHT` becomes:
    ```ts
    { techniques: ["text", "techniques"], graphics: ["graphics"], sounds: ["sounds"], subtitles: ["subtitles"] }
    ```
  - **`workTwo` for a whole plan** runs text, techniques, then graphics, as now.
  - **Rethink.**
    - "techniques" runs text and techniques only.
    - "graphics" runs graphics only.
    - Each puts the sounds behind (`plannedOn(folder, "sounds", null)`), as the old graphics rethink did.
  - **`plannedOn`.**
    - `StoredEmphasis.plannedOn` gains `techniques?: number | null`.
    - A whole plan stores both "techniques" and "graphics".
    - Each rethink stores its own.
    - `EmphasisView.changed.techniques` reads `plannedOn.techniques ?? plannedOn.graphics`, so an outline from before 0.7.0 keeps its banner state.
  - **API.** `highlight-api.ts` accepts the new work. `rethinkPost` stays licensed.
  - Tests:
    - each rethink's states and `plannedOn`;
    - the old outline's banner;
    - the API refusal of an unknown work.
- [ ] **Step 5.** Run `npm test` and `npm run typecheck`.

### Task 6: Renderer: the tabs, the graphic list, the AI menu, the prepare line

**Files:**
- Modify: `apps/desktop/src/renderer/src/edit/postTabs.ts` (+test), `BeatPanel.tsx`, `BeatSidebar.tsx`, `byBeat.ts` (+test), `GraphicsTab.tsx` (renamed to `TechniquesTab.tsx`), `FlairTab.tsx`, `AiMenu.tsx`, `PlanStrip.tsx`, `WriteButton.tsx` (+test), `writeEnd.ts` (+test), `screens/PostScreen.tsx` (+test), `screens/PrepareScreen.tsx` (+test), `room/ClipRoom.tsx` (+test), `i18n.ts`, `styles/edit.css`
- Create: `apps/desktop/src/renderer/src/edit/GraphicTab.tsx`, `edit/GraphicList.tsx`

- [ ] **Step 1: texts.** Change and add these in `i18n.ts`, exactly:

  | Key | Text |
  |---|---|
  | `post.tab.techniques` (new) | ข้อความและเทคนิค |
  | `post.tab.graphics` | กราฟิก |
  | `post.ai.rethink.techniques` (new) | คิดใหม่: ข้อความและเทคนิค |
  | `post.ai.rethink.graphics` | คิดใหม่: กราฟิก |
  | `edit.flairGraphics` | กราฟิก · ตามเวลา |
  | `graphics.none` | ยังไม่มีกราฟิกในช่วงนี้ กดคิดใหม่: กราฟิก ในเมนู AI |
  | `graphics.ofPoint` (new) | เล่าเรื่องของจุด “{text}” |
  | `graphics.from.light` (new) | เล่นตั้งแต่ระดับเบา |
  | `graphics.from.medium` (new) | เล่นตั้งแต่ระดับกลาง |
  | `graphics.from.heavy` (new) | เล่นเฉพาะจัดเต็ม |
  | `graphics.replaces` (new) | ขึ้นแทนข้อความเด่น |
  | `graphics.coversKeep` (new) | ทับหน้าคนหรือของ จึงขึ้นแค่ 1.5 วิ |
  | `prepare.objects` (new) | วิเคราะห์ภาพใหม่เพื่อให้กราฟิกชี้ของได้ · {count} วิดีโอ |
  | `prepare.objectsRun` (new) | วิเคราะห์ภาพใหม่ |
  | `prepare.objectsGoing` (new) | กำลังจดตำแหน่งของในภาพ {done} จาก {total} |
  | `prepare.objectsFailed` (new) | จดตำแหน่งของไม่สำเร็จ · {error} |

  - Every other text that says "กราฟิกและเทคนิค" (for example `inserts.pickHint`, `write.doneGraphicsSkipped`, `write.doneGraphicsAllSkipped`, `flair.lost`, `post.planHint`, the toasts in `writeEnd.ts`) names the tab that now holds the thing: "ข้อความและเทคนิค" for highlight text, zooms and cutaways, and "กราฟิก" for graphics.
  - A test lists every key that contains "กราฟิกและเทคนิค" and expects none.
- [ ] **Step 2: tabs.**
  - `POST_TABS` becomes `["cut", "emphasis", "techniques", "graphics", "sound", "subtitles"]`.
  - `TAB_OF_WORK` maps `text` and `techniques` to `"techniques"`, and `graphics` to `"graphics"`.
  - **Badges.**
    - The techniques tab counts text, zoom and insert.
    - The graphics tab counts graphic.
    - `MARKS` in `BeatSidebar` follow: techniques `["text", "zoom", "insert"]`, graphics `["graphic"]`.
  - **Tab bodies.**
    - `TechniquesTab` is today's `GraphicsTab` without the graphics part of `TechniqueList`.
    - Its banner uses `changed.techniques` and rethinks `"techniques"`.
  - Update the tests that pin five tabs, their names and their badges.
- [ ] **Step 3: the graphic tab.** `GraphicTab` holds:
  - the `flair.graphic` switch with its hint;
  - the banner on `changed.graphics` that rethinks `"graphics"`;
  - `graphicsProblem` / `graphicsWaitForPack`, as today;
  - `GraphicList`.
- [ ] **Step 4: the graphic list.** `GraphicList` is the graphics rows of today's `TechniqueList`, moved unchanged in behaviour (state lines, buttons, edit field, asking and field rules, rewrite marks, the retry button), in time order (`atUs`), with these lines in the body, in this order:
  1. the idea (`flair-what`);
  2. the last edit;
  3. why;
  4. for a tied graphic, `graphics.ofPoint` with the point's text (from `pointLabel`'s source), else nothing; a legacy graphic keeps `FromPoint`;
  5. `graphics.from.${from}` for a free graphic, nothing for a legacy one;
  6. `graphics.replaces` when `replaces`;
  7. `graphics.coversKeep` when `coversKeep` (Task 4);
  8. the state;
  9. the edit failure;
  10. edited.

  Tests: each line in each case, the order, and the buttons as today's tests pin them, moved to the new tab.
- [ ] **Step 5: the AI menu.**
  - It lists, in this order: emphasis, techniques, graphics, sounds, subtitles.
  - Techniques and graphics need points, as graphics do today.
  - `ClipRoom.rethink` accepts `"techniques"`.
  - `PlanStrip` is unchanged except that it learns the new work from `RETHINK_WORKS`.
  - Update the menu tests.
- [ ] **Step 6: the write sheet and the end toasts.** No count changes: `preview.graphics` is already at the level. The toasts name the right tab (Step 1).
- [ ] **Step 7: the prepare line.**
  - On mount, and after every `analysis-finished` of this folder, `PrepareScreen` reads `api.videosWithoutObjects(folder)`.
  - When some of the ticked analysed videos are listed and nothing runs, it shows a notice with `prepare.objects` and a button `prepare.objectsRun`. The button calls `api.locateObjects(folder, thoseIds)`.
  - While `objects` events run, it shows `prepare.objectsGoing`. A `failed` event shows `prepare.objectsFailed` with the error in plain words (`lastLines` style).
  - The button is disabled while CapCut runs, while writing or planning, or while another job runs, as Start is.
  - Tests cover each state.
- [ ] **Step 8.** Run `npm test` and `npm run typecheck`.

### Task 7 (controller): version, checks, the live test, docs

- [ ] **Step 1.** Run the gate: `npm test`, `npm run typecheck`. Run the mutation check on the room rules (`roomOf`, `admitFree`, the free path) and on `acceptFreePlan` / `acceptObjects`, by the usual script, never alongside another vitest run.
- [ ] **Step 2.** Set `apps/desktop/package.json` version to `0.7.0` with the Edit tool. Run `npm run dist -w @boxblack/desktop`. Check the version, that `Resources/graphics` holds only `host.js`, and the DMG size.
- [ ] **Step 3: live test** on the test profile (`r044/app`, `r050/ui.mjs`, which skips `about:` pages), with real Claude, on 0917.

  **Prepare page:**
  - the objects line shows for 0917;
  - the button runs the pass;
  - the line goes;
  - the objects cache entry exists.

  **Post page:**
  1. Think graphics again at heavy.
  2. Count the graphics per level against the 3 of 0.5.1.
  3. Check that highlight text and graphics do not collide in the rendered posters.
  4. Check that a tied graphic covering its text replaces it, and that a graphic over the face plays 1.5 s or less.
  5. Redo one legacy graphic and see it turn free.
  6. Check the tabs at 900 px.

  **CapCut:**
  1. Back up 0917, write, and ask the user to open it in CapCut and look.
  2. The user closes CapCut with Cmd+Q.
  3. Restore 0917, then check that it is identical.
- [ ] **Step 4: docs.**
  - Add the 0.7.0 entry to the main spec.
  - Update the spec's status line.
  - Update memory.
