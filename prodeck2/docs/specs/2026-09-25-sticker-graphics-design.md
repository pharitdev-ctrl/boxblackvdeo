# M24 · สติกเกอร์อีโมจิ 3D ในกราฟิกซ้อนภาพ — design

> **สถานะ (2026-09-30): ถูกแทนที่ในรุ่น 0.5.0** สติกเกอร์อีโมจิ 3D และท่าขยับทั้งเจ็ดของเอกสารนี้ถูกถอดออกจากแอปแล้ว กราฟิกตอนนี้ Claude ออกแบบและเขียนแอนิเมชันเองทีละชิ้น ดู `docs/specs/2026-09-30-freeform-motion-design.md` ส่วนที่ยังใช้อยู่คือตัวเรนเดอร์ (HyperFrames) การวางกราฟิกบนเฟรมให้พ้นหน้าและข้อความ และการเขียนลงดราฟต์ กราฟิกแบบเดิมที่โปรเจกต์เก่าเก็บไว้ถูกล้างครั้งเดียวตอนเปิดด้วย 0.5.0 โดยสำรองไฟล์ไว้ที่ `outlines-before-050`

วันที่ 2026-09-25 · ต่อจาก M23 (กราฟิกซ้อนภาพ, 0.2.0)

## 1. ที่มา

ลองกราฟิกกับโปรเจกต์ `0925 (1)` (คลิป 22 วินาที เล่าเรื่องขึ้นอวกาศ) แล้วได้การ์ด 3 ใบที่มีแค่ป้ายข้อความกับไอคอนแบน
("บินเองได้ไหม?" ⚠ · "เตรียมขึ้นอวกาศ" ↑ · "ว้าว สุดยอด!" ★) ซึ่งซ้ำกับข้อความเด่นที่มีอยู่แล้วและไม่ตรงกับที่ผู้ใช้นึกไว้

ผู้ใช้: *"พูด 'เขาต้องไปด้วยยานอวกาศเท่านั้น' กราฟิกที่แสดงก็เป็นยานอวกาศที่กำลังพุ่งจากด้านล่างขึ้นด้านบน"*

สาเหตุ: ชุดชิ้นส่วนของ M23 ทำได้แต่ **การ์ดข้อมูล** (ตัวเลขวิ่ง แถบเทียบ รายการติ๊ก ชี้จุด) คลิปที่ไม่มีตัวเลขหรือรายการจึงเหลือแต่ป้าย
สิ่งที่ผู้ใช้ต้องการคือ **ภาพประกอบเคลื่อนไหว** ของสิ่งที่พูดถึง ซึ่งเป็นกราฟิกอีกประเภท

## 2. สิ่งที่ผู้ใช้เลือก

| เรื่อง | ทางเลือก | ที่เลือก |
|---|---|---|
| รูปมาจากไหน | อีโมจิแบน (Twemoji/OpenMoji) · อีโมจิ 3D (Fluent) · AI วาดใหม่ทุกครั้ง · Claude เขียน SVG | **Fluent Emoji 3D** (Microsoft, MIT) ดูจากรูปเทียบบนเฟรมจริงของ 0925 (1) |
| การ์ดที่มีแค่ป้าย | ตัดทิ้ง · ยังใช้ได้แต่เลือกทีหลัง · อีโมจิ 3D บนการ์ด | **ตัดทิ้ง + อีโมจิ 3D แทนไอคอนแบนบนการ์ด** |
| การ์ดป้ายที่เก็บไว้แล้ว (เช่น 3 ใบใน 0925 (1)) | ตัดทิ้งเลย · เก็บจนกว่าจะจัดลูกเล่นใหม่ | **ตัดทิ้งเลย** — ใบที่ AI ทำและผู้ใช้ไม่ได้แก้ หายจากพรีวิวทันที ใบที่ผู้ใช้แก้เองยังอยู่ (รีวิวแผน 2026-09-25) |
| การ์ดลูกศร/วงกลมชี้ + ป้ายชื่อ (ไม่มีตัวเลข) | ยังใช้ได้ · ตัดทิ้งด้วย | **ยังใช้ได้** — ลูกศร/วงกลมบอกสิ่งที่ข้อความบอกไม่ได้ (รีวิวแผน 2026-09-25) |
| ขนาดสติกเกอร์ (ลองจริงบน 0917 AI เลือก 0.1 ตลอด เห็นเป็นจุด) | ขยายใหญ่ขึ้น · ใช้ได้แล้ว | **ขยายใหญ่ขึ้น** — 0.2–0.3 ปริยาย 0.25 ตัวชุดยังย่อให้พอดีกรอบแคบเอง (ลองจริง 2026-09-25) |
| สติกเกอร์ที่เคลื่อนที่บินผ่านหน้าคนได้ไหม (จรวดใน 0917 ติดแถบอก 0.64–0.76 พุ่งได้ ~85 px) | ผ่านหน้าได้ · หลบหน้าเสมอ | **ผ่านหน้าได้** — fly-up fly-across rain ไม่หลบ keepClear แต่ยังหลบข้อความเด่นและซับ และ fly-up ถูกยืดให้สูงเต็มช่วงว่างที่กรอบอยู่ (ลองจริง 2026-09-25) |

ค่าปริยายที่ผมเลือก (แก้ได้): ท่าเคลื่อนไหว 7 ท่า · สติกเกอร์อยู่ในกรอบที่ AI ให้เท่านั้น · โควตารวมกับการ์ด · ไม่เอาสีผิวอื่นนอกจากมาตรฐาน

## 3. พฤติกรรม

### 3.1 กราฟิก 2 ชนิด

| | การ์ด (M23) | สติกเกอร์ (ใหม่) |
|---|---|---|
| ใช้เมื่อ | พูดถึงตัวเลข การเทียบ รายการ | พูดถึงของ การกระทำ หรืออารมณ์ที่มีอีโมจิตรง |
| ต้องมี | `number` / `bars` / `checks` อย่างน้อย 1 ชิ้น หรือ `arrow`/`ring` คู่กับ `label` · `label` และ `icon` เป็นส่วนประกอบ · **การ์ดที่มีแค่ป้าย (มีอีโมจิด้วยหรือไม่ก็ตาม) ถูกตัดทิ้งตอนรับคำตอบ และใบที่เก็บไว้แล้วซึ่ง AI ทำและผู้ใช้ไม่ได้แก้ ไม่เล่นอีก (`graphicsInForce` นับเป็น dropped)** | อีโมจิ 1 ตัว + ท่า 1 ท่า เก็บแบบ plain (ไม่มีสีผิว ไม่มี FE0F) |
| หน้าตา | การ์ดสีตามสไตล์ข้อความเด่น | รูป Fluent 3D ลอยบนวิดีโอ ไม่มีกรอบ มี drop-shadow บาง ๆ ไม่ใช้สีจากพาเลต |
| ไอคอน | `icon` รับอีโมจิตัวไหนก็ได้ วาดเป็น Fluent 3D · ชื่อเก่า 12 ชื่อ map ตอนอ่าน | — |

ประโยคธรรมดาไม่ใส่อะไร (เหมือน M23 แต่ AI ไม่มีทางหนีไปใส่การ์ดป้ายอีก)

### 3.2 ท่าเคลื่อนไหว (`motion`)

| ท่า | ชื่อไทย | การเคลื่อนที่ในกรอบ (`box`) | ตัวอย่าง |
|---|---|---|---|
| `fly-up` | พุ่งขึ้น | กรอบถูกยืดตอนอ่านให้สูงเต็มช่วงว่างของจอที่กรอบอยู่ (ระหว่างข้อความเด่นและซับ ผ่านหน้าคนได้) · ขอบล่างของสติกเกอร์เริ่มที่ขอบล่างกรอบ ถึงขอบบนกรอบพอดีที่เฟรมสุดท้ายที่วาด (ยังเคลื่อนอยู่ระหว่างจางออก) เร่งขึ้นเรื่อย ๆ (p²) ไม่เอียง (อีโมจิหันทางของมันเองอยู่แล้ว) มีเงาตาม 2 ชั้น ตามหลัง 0.12 และ 0.24 วิ | จรวด ยอดขาย ราคาขึ้น |
| `fly-across` | บินผ่าน | ซ้ายไปขวาเต็มความกว้างกรอบ ถึงขอบขวาที่เฟรมสุดท้าย กลางความสูง โยกขึ้นลงเบา ๆ มีเงาตาม 2 ชั้น | เครื่องบิน รถ |
| `rain` | โปรย | 8 ชิ้น ขนาด 0.5–1.0 เท่า ตำแหน่ง x และจังหวะสุ่มแบบ seed ตกจากขอบบนถึงขอบล่างกรอบ วนซ้ำ คาบ 1.4–2.0 วิ | เงิน หัวใจ ดาว |
| `bounce` | เด้ง | อยู่กลางกรอบ กระโดดขึ้น 0.3 เท่าของขนาด ทุก 0.6 วิ ย่อลงตอนแตะพื้น | ตกใจ ดีใจ |
| `float` | ลอย | อยู่กลางกรอบ ขึ้นลง 0.12 เท่าของขนาด คาบ 2.4 วิ เอียง ±4° | บอลลูน เมฆ |
| `spin` | หมุน | อยู่กลางกรอบ หมุนรอบละ 1.5 วิ เงาอยู่บนเลเยอร์ไม่หมุนตาม | เหรียญ นาฬิกา โลก |
| `pop` | โผล่ขึ้น | อยู่กลางกรอบ เข้าแบบ pop แล้วนิ่ง | ทั่วไป |

- ทุกท่า **เข้า** ในตัวเอง (pop ยกเว้น `fly-*` และ `rain` ที่โผล่มาพร้อมเคลื่อนที่) และ**จางออก** 0.3 วิก่อนเฟรมสุดท้ายเสมอ ไม่มี `in`/`out` ให้เลือก · ทุกท่าเคลื่อนไหวต่อจนจบ ไม่หยุดนิ่งระหว่างจางออก
- seed ของ `rain` = อีโมจิ + วินาที + ขนาด + กรอบ → เรนเดอร์ซ้ำได้ผลเดิม hash เดิม และโปรยสองอันในคลิปเดียวกันไม่ซ้ำลาย
- ทุกท่ามี "ที่ที่ต้องใช้" ในกรอบ (`STICKER_ROOM` ใน timeline.js และสำเนาใน core `plan.ts` ที่เทสต์ผูกให้เท่ากัน เช่น fly-up สูง 2 เท่า, spin กว้าง/สูง √2 เท่า, rain กว้าง 1.16 เท่า สูง 2.5 เท่า ให้เม็ดใหญ่สุดตกได้อย่างน้อยเท่าตัว) ตัวชุดย่อสติกเกอร์ให้พอดีเสมอ · prompt และกฎ fly → pop อ่านตารางจาก core
- `fly-up` ต้องมีกรอบสูงอย่างน้อย 2 เท่าของสติกเกอร์ · `fly-across` ต้องมีกรอบกว้างอย่างน้อย 2 เท่า · ไม่ถึงกลายเป็น `pop` **ตอนอ่าน** (`graphicsInForce` ผ่าน `settledMotion` แบบ drift → punch ของซูม) จึงใช้กับท่าที่ผู้ใช้เลือกเองด้วย สเปกที่เก็บไว้ไม่เปลี่ยน

### 3.3 ขนาด ตำแหน่ง เวลา จำนวน

- `size` = สัดส่วนของ**ด้านสั้น**ของจอ 0.2–0.3 ปริยาย 0.25 (รูป 256 px: 0.3 ของ 1080 คือ 324 px เริ่มเบลอเล็กน้อย ยอมรับได้ · นับจากความกว้างจะเบลอบนจอแนวนอน · เดิม 0.1–0.3 แต่ตอนลองจริง AI เลือก 0.1 ตลอด ราว 108 px เห็นเป็นจุด) · ตัวชุดย่อลงให้พอดีกรอบเสมอ prompt บอกไม่ต้องลดขนาดเพื่อให้พอกรอบ · prompt บอกต่อจอว่าแต่ละขนาดต้องมีกรอบสูง/กว้างเท่าไร (`describe()` คำนวณจาก canvas เพราะ size กับ box คนละหน่วย ไม่บอกของ fly-up เพราะแอปยืดกรอบให้เอง)
- `box` เหมือนการ์ด (กว้าง ≥ 0.18 สูง 0.08–0.45 เผื่อทศนิยม +1e-9) ยกเว้นสติกเกอร์ที่เคลื่อนที่ (fly-up fly-across rain) สูงได้ถึง 0.8 (รับถึง 0.85 เผื่อปัด) · สติกเกอร์**เคลื่อนที่อยู่ในกรอบเท่านั้น** · กรอบของการ์ดและสติกเกอร์ที่อยู่กับที่ (pop float bounce spin) ถูกเลื่อนหนี keepClear ข้อความเด่น และซับ ด้วย `dodgeBands` เดิม · สติกเกอร์ที่เคลื่อนที่หลบเฉพาะข้อความเด่นและซับ **ผ่านหน้าคนได้** (ผู้ใช้เลือกหลังลองจริง) · `fly-up` ถูกยืดตอนอ่านให้สูงเต็มช่วงว่าง (`freeBands`) ที่กรอบซ้อนมากที่สุด ไม่มีที่ซ้อนใช้ช่วงที่สูงที่สุด แนวซ้ายขวาคงเดิม แล้วจึงใช้กฎ fly → pop
- ถ้าเลื่อนแล้วไม่มีที่ หรือต้องทับซับ สติกเกอร์ (ซึ่งไม่มีข้อความให้เสีย) ย้ายไปแถบว่างที่สูงที่สุดของจอ (`tallestOf(freeBands(…))` = ช่วงสูงสุดจาก `freeBands` ระหว่างขอบจอ keepClear (เฉพาะท่าที่อยู่กับที่) ข้อความเด่น และซับ เว้น gap เท่า dodge สูง ≥ 0.08) แล้วใช้กฎ fly → pop อีกครั้ง · ไม่มีแถบว่างเลยจึงตัดทิ้ง
- เวลา 1.5–6 วิ ตัดตามปลายชิ้น เหมือนการ์ด (`graphicsInForce` เดิม)
- โควตา ไม่ซ้อน ไม่ทับสื่อแทรก: `enforceGraphics` เดิม ไม่แยกชนิด (ระยะห่าง 4 วิ ถูกเอาออก 2026-09-26)

### 3.4 ในแอป

- แถบลูกเล่น: แถวเดียวกับการ์ด สรุป "สติกเกอร์ 🚀 พุ่งขึ้น" · ไอคอนบนการ์ดสรุปเป็น "อีโมจิ 🚀"
- แผ่นแก้ไข (`GraphicSheet`) ของสติกเกอร์: ช่องอีโมจิ (1 ตัว) · เลือกท่า · ความยาว · ของการ์ด: ช่อง `icon` เป็นช่องอีโมจิ
  อีโมจิที่ไม่มีรูป main ปฏิเสธตอนบันทึก ("ไม่มีรูปอีโมจินี้") แผ่นแสดงข้อผิดพลาดเหมือนการบันทึกล้มเหลวอื่น
- ปิด ลบ เรนเดอร์ใหม่ เหมือนเดิม

## 4. โครงข้อมูล (`packages/core/src/graphics/plan.ts`)

```ts
export const STICKER_MOTIONS = ["pop", "float", "bounce", "spin", "fly-up", "fly-across", "rain"] as const
export type StickerMotion = (typeof STICKER_MOTIONS)[number]
export const STICKER_SIZE = { min: 0.2, max: 0.3, default: 0.25 }
/** Motions that pass over what the picture keeps clear (a face, a product); still kept off the highlight text and the subtitles. */
export const CROSSING_MOTIONS: ReadonlySet<StickerMotion> = new Set(["fly-up", "fly-across", "rain"])
export function crossesKeepClear(motion: string): boolean

interface GraphicBase { version: string; box: GraphicBox; seconds: number; why: string }
export interface CardSpec extends GraphicBase { kind?: "card"; tone: Tone; in: GraphicIn; out: GraphicOut; pieces: GraphicPiece[] }
export interface StickerSpec extends GraphicBase { kind: "sticker"; emoji: string; motion: StickerMotion; size: number }
export type GraphicSpec = CardSpec | StickerSpec
export const isSticker = (spec: GraphicSpec): spec is StickerSpec => spec.kind === "sticker"

// GraphicPiece.icon?: string — อีโมจิ (เดิม IconName) · ชื่อเก่าใน LEGACY_ICONS ถูกแปลงตอนอ่าน · ICONS เดิมเหลือไว้เป็นชนิด IconName ของ map นี้
export const LEGACY_ICONS: Record<IconName, string> = { star: "⭐", heart: "❤️", check: "✅", cross: "❌", warning: "⚠️", money: "💰",
  clock: "⏰", fire: "🔥", up: "⬆️", down: "⬇️", gift: "🎁", cart: "🛒" }
```

- `kind` ไม่มี = การ์ด (ไฟล์ outline เก่าอ่านได้ ไม่ต้องแปลง ไม่ถูกเขียนทับ)
- `upgradeSpec(spec)` ใน `graphics-cues.ts` แปลงชื่อไอคอนเก่าเป็นอีโมจิตอนอ่านจาก outline ก่อนวาง/เรนเดอร์/สรุป
- `GraphicPatch` เพิ่ม `emoji?: string`, `motion?: StickerMotion` (ใช้กับสติกเกอร์) · `pieces[n].icon?: string` (ไอคอนการ์ด)

### 4.1 อีโมจิ → ไฟล์ (`packages/core/src/graphics/emoji.ts`)

```ts
/** คีย์ของอีโมจิ: codepoint ตัวพิมพ์เล็กคั่นด้วย "-" ตัด FE0F และสีผิว 1F3FB–1F3FF คง ZWJ (200d); null เมื่อไม่ใช่อีโมจิตัวเดียว */
export function emojiKey(glyph: string): string | null
```

- `"🚀"` → `1f680` · `"🧑🏽‍🚀"` → `1f9d1-200d-1f680` · `"❤️"` → `2764` · `"ab"` / `"🚀🚀"` / `""` → null
- ชุดที่มี: `index.json` `{ version: "<commit เต็ม>", keys: string[] }` อ่านครั้งเดียวใน main (`readEmojiSet` ปฏิเสธถ้า version ไม่ตรง `EMOJI_SET.commit` ที่ปักในโค้ด)
  ส่งให้ core เป็น `known: Set<string>` (accept) และให้ renderer ไม่ต้อง (main ตรวจตอนบันทึก)

## 5. รูปอีโมจิ (`apps/desktop/resources/graphics/emoji/`)

- ที่มา: `github.com/microsoft/fluentui-emoji` โฟลเดอร์ `assets/<ชื่อ>/3D/*.png` และ `assets/<ชื่อ>/Default/3D/*.png` (คนสีผิวมาตรฐาน)
  ที่ commit ตายตัว · นับได้ 1,285 + 310 = **1,595 ไฟล์ ≈ 54 MB** PNG 256×256 · MIT
- ชื่อไฟล์ = `emojiKey` ของ `metadata.json → unicode` เช่น `1f680.png`, `1f9d1-200d-1f680.png` + `index.json` + `FLUENT-EMOJI-LICENSE`
- สคริปต์ `apps/desktop/scripts/fetch-fluent-emoji.mts` (รันครั้งเดียวตอนพัฒนา ไม่รันตอน build): tree API ครั้งเดียว →
  โหลด metadata + PNG ที่ commit นั้น (ขนานไม่เกิน 8) → ตรวจครบ 1,595 → เขียน index และ license · ใช้ User-Agent เบราว์เซอร์แบบ notices generator
- ส่งกับแอปผ่าน `extraResources` ที่มีอยู่ (`resources/graphics` → `graphics`) · **ชุดเรนเดอร์ (pack) ไม่แตะ** ไม่ต้อง build/อัปโหลดใหม่ · DMG โตจาก ~149 เป็น ~203 MB และ zip อัปเดตโตเท่ากัน ยอมรับ: แลกกับการไม่ต้อง build/อัปโหลด pack ใหม่ (ซึ่งต้องโหลด fontconfig ผ่านเบราว์เซอร์อีก) ย้ายเข้า pack ได้ตอน rebuild ครั้งหน้า
- `release-check.ts` เพิ่มข้อ: มี `emoji/index.json` และจำนวนไฟล์ PNG เท่ากับ `keys.length`
- ไม่เอา: สีผิวอื่น (1,550 ไฟล์) · สไตล์ Color/Flat/High-contrast · อีโมจิที่ Fluent ไม่มี (Emoji 15.1 ขึ้นไป) → prompt บอกให้ใช้อีโมจิมาตรฐานทั่วไป

## 6. เรนเดอร์

### 6.1 หน้า HTML (`packages/core/src/graphics/kit/html.ts`)

- `graphicHtml` รับ `images: Record<string, string>` (คีย์อีโมจิ → ชื่อไฟล์ PNG ที่ต้องใช้: สติกเกอร์ 1 ไฟล์ หรือไอคอนของการ์ด) ใส่ลง payload
  เป็น `window.__SPEC.images` · kit.js สร้าง `<img src="<file>">` จากตรงนั้น (ชื่อไฟล์ล้วน) · ไฟล์ถูกก๊อปไปวางข้าง `index.html` เหมือนฟอนต์
  (`graphics-render.ts`: ตรวจ `basename(file) === file` แล้ว `copyFile` จาก `emojiDir`; ก๊อปไม่ได้ = `EnvironmentError` เหมือนฟอนต์)
- ชุดรูปเป็น dep แยกของ renderer: `emoji: () => Promise<EmojiSet>` (`{ dir, keys }` จาก `readEmojiSet`) ไม่ปนกับ `GraphicAssets` ของ kit
- commit ของชุดรูปปักในโค้ด (`EMOJI_SET.commit` ใน `graphics/emoji.ts`) hash และ release-check ใช้ค่านั้นโดยไม่ต้องอ่านไฟล์

### 6.2 ชุด (`resources/graphics/timeline.js`, `kit.js`, `kit.css`)

- `timeline.js` เพิ่ม `stickerMoves(spec, when, lane, unit)` (pure): คืนรายการ `{ copy, name, from, to, at, duration, ease }` ต่อชิ้น (rain มี 8 copy)
  พร้อม `stickerSize(spec, lane, W)` และ `seeded(seed)` (PRNG mulberry32) · ทดสอบได้ว่าทุกเฟรมสติกเกอร์อยู่ในกรอบ และ rain ซ้ำได้ผลเดิม
- `kit.js`: `S.kind === "sticker"` → ไม่สร้างการ์ด สร้าง `<img class="sticker">` (× copy) ในกรอบ แล้ว `move()` ตาม `stickerMoves` ·
  ชิ้น `icon` ของการ์ด → `<img class="icon" src>` แทน SVG path (ขนาด/ตำแหน่งเดิม 14 % ของความกว้างการ์ด)
- `kit.css`: `.sticker { position: absolute; filter: drop-shadow(0 var(--shadow-y) var(--shadow-blur) rgba(0,0,0,.35)); }` · `.icon` เป็น `img`
- ขอบเรนเดอร์ `renderBox` เดิม (8 % + พื้น 80/128 px) พอสำหรับเงาและ overshoot ของ pop/bounce
- `KIT_VERSION` bump · `hashOf` เพิ่ม `EMOJI_SET.commit` (เปลี่ยนชุดรูป = เรนเดอร์ใหม่) · สติกเกอร์ไม่วาดฟอนต์และพาเลต hash จึงไม่รวมสองอย่างนั้น (เปลี่ยนสไตล์ข้อความเด่นไม่ต้องเรนเดอร์สติกเกอร์ใหม่) · ภาพตัวอย่าง (poster) กลางไฟล์เหมือนเดิม
- renderer อ่านชุดรูปเฉพาะงานที่วาดอีโมจิ (สติกเกอร์ หรือการ์ดที่มี icon) การ์ดธรรมดาเรนเดอร์ได้แม้รูปหาย · อ่านไม่ได้/ก๊อปไม่ได้ = `EnvironmentError` เหมือนฟอนต์ · ชื่อไฟล์รูปต้องเป็นชื่อล้วน (`basename`) เหมือนฟอนต์
- `graphics-kit-check.mjs` เพิ่มตัวอย่างสติกเกอร์ทุกท่า + การ์ดที่มีไอคอนอีโมจิ

## 7. ตอนเลือกจุด (`packages/core/src/graphics/direct.ts`)

- คำสั่งใหม่ (`GRAPHICS_PROMPT_VERSION = "graphics-2026-09-25-stickers-2"`): อธิบาย 2 ชนิด · การ์ดต้องมี number/bars/checks ·
  สติกเกอร์ = ของ/การกระทำ/อารมณ์หลักที่พูดถึง ไม่ใส่กับคำอุทาน เลือกท่าให้ตรงความหมาย · ใช้อีโมจิมาตรฐานทั่วไป 1 ตัว ไม่ใช้ธง · ห้ามใส่แค่ตกแต่ง ไม่ต้องใส่ให้ครบจำนวน ·
  size 0.2–0.3 ไม่แน่ใจใช้ 0.25 ไม่ต้องลดขนาดให้พอกรอบ · fly-up fly-across rain บินผ่านหน้าคนได้ กรอบ fly-across/rain สูงได้ถึง 0.8 · fly-up บอกแค่แนวซ้ายขวาและช่วงที่อยู่ แอปยืดกรอบให้เอง
- schema ตอบต่อกราฟิก: `kind: "card" | "sticker"` (ปริยาย card) · สติกเกอร์: `at, word, seconds, why, box, emoji, motion, size` ·
  การ์ด: เหมือนเดิม ชิ้น `icon.icon` เป็นอีโมจิ
- `acceptGraphics(reply, sentences, framed, taken, known)`:
  - สติกเกอร์: `emojiKey(emoji)` อยู่ใน `known` · เก็บ `plainEmoji` · `motion` อยู่ใน `STICKER_MOTIONS` · `size` clamp 0.2–0.3 (ไม่ให้ = 0.25) · `box` ตาม `boxOf` เดิม เพดานสูง 0.85 สำหรับท่าที่เคลื่อนที่ (`crossesKeepClear`) 0.45 สำหรับที่เหลือ ·
    ไม่ผ่าน = ทิ้งทั้งอัน นับ dropped (กฎ fly → pop อยู่ตอนอ่าน ไม่ใช่ที่นี่)
  - การ์ด: ไม่มี number/bars/checks และไม่มี arrow/ring คู่ label = ทิ้งทั้งอัน (`cardAnchored`) · ชิ้น `icon` ที่อีโมจิไม่มีรูป = ทิ้งชิ้นนั้น · icon เก็บแบบ plain
- `describe()` บอกต่อจอว่าสติกเกอร์ขนาด 0.2/0.25/0.3 ต้องมีกรอบสูง/กว้างเท่าไรสำหรับแต่ละท่า ยกเว้น fly-up (ปัดขึ้นทศนิยม 2 ตำแหน่ง · เกินเพดานกรอบ 0.4 หรือ 0.8 สำหรับ rain เป็น —)
- `existingGraphics` สรุปของผู้ใช้ด้วย `summaryOf` ใหม่ (สติกเกอร์อ่านได้)

## 8. ในแอป

- `graphics-cues.ts` `graphicsInForce` (รับ `canvas` เพิ่ม): `upgradeSpec` · การ์ดที่ไม่ `cardAnchored` และผู้ใช้ไม่ได้แก้ = ไม่เล่น นับ dropped · สติกเกอร์: dodge (ท่าที่เคลื่อนที่ไม่หลบ keepClear) → ถ้าไม่มีที่/ทับซับ ใช้ช่วงว่างที่สูงที่สุดจาก `freeBands` → fly-up ยืดเต็มช่วงว่างที่ซ้อน → `settledMotion` (fly → pop) · `summaryOf` รองรับสติกเกอร์ + `MOTION_NAMES` ไทย · `ICON_NAMES` เดิมทิ้ง (สรุปเป็นตัวอีโมจิเอง) · `images` คำนวณใน renderer (`imageFiles`) ไม่ใช่ใน `graphicJob`
- `flair.ts`: `askForGraphics` ส่ง `known` ให้ `planGraphics` (อ่านชุดรูปไม่ได้ = ส่งเซตว่าง แผนการ์ดยังไป) · `setGraphic` รับ patch สติกเกอร์ (`emoji`, `motion`, `seconds`) และไอคอนการ์ด เก็บอีโมจิแบบ plain ·
  อีโมจิไม่มีรูป → throw "there is no picture for the emoji …" ก่อนเขียนอะไร · เปลี่ยนแล้ว `edited: true` เหมือนเดิม
- `api.ts`: `GraphicSpec` union ผ่านไป renderer ตามเดิม · `GraphicPatch` เพิ่มฟิลด์ · `highlight-api.ts` ตรวจฟิลด์ใหม่
- renderer: `FlairTab` แถวเดิม · `GraphicSheet` แยกฟอร์มตาม `isSticker` `onSave` ตอบข้อความผิดพลาดหรือ null (`EditScreen` ส่งต่อ) แผ่นแยกแสดง "ไม่มีรูปอีโมจินี้" เฉพาะเมื่อ main ปฏิเสธด้วยเหตุนั้น · `i18n.ts` เพิ่มชื่อท่า ป้ายช่อง ("อีโมจิ 1 ตัว" + วิธีเปิดแป้นอีโมจิ) ข้อความผิดพลาด แก้ `flair.graphicHint` ให้พูดถึงสติกเกอร์ และ `graphics.problem` บอกให้ติดตั้งแอปใหม่ถ้าเป็นเรื่องรูป

## 9. ทดสอบ

- core: `emojiKey` (ตัด FE0F/สีผิว, ZWJ, ไม่ใช่อีโมจิ) · `acceptGraphics` (สติกเกอร์ผ่าน/ทิ้ง, fly → pop, การ์ดไม่มีตัวเลขทิ้ง, ไอคอนอีโมจิ, `known`) ·
  `graphicHtml` มี images · `upgradeSpec` map ชื่อเก่า
- kit (`graphics-kit.test.ts` โหลด timeline.js): `stickerMoves` ทุกท่าอยู่ในกรอบทุกเฟรม · rain seed เดิมผลเดิม seed ต่างผลต่าง · `stickerSize` ย่อพอดีกรอบ
- main: `hashOf` เปลี่ยนตาม emoji.version · render ก๊อป PNG และ `EnvironmentError` เมื่อไม่มี · `summaryOf` · `setGraphic` ปฏิเสธอีโมจิที่ไม่มี
- renderer: `GraphicSheet` สติกเกอร์ (เปลี่ยนท่า/อีโมจิ/ความยาว ส่ง patch ถูก) · แถวใน `FlairTab`
- scripts: `release-check` ข้อใหม่ · `fetch-fluent-emoji` ทดสอบส่วน pure (ตั้งชื่อไฟล์จาก unicode, เลือกโฟลเดอร์ Default)
- mutation check (`scratchpad/mutate.py`) ทุกไฟล์ที่แตะ · ลองจริงบน 0917 เท่านั้น (สำรอง/คืน) · 0925 (1) อ่านอย่างเดียว

## 10. ไม่อยู่ในขอบเขต

สีผิวอื่น · สไตล์อีโมจิอื่น · รูปของผู้ใช้เอง · AI วาดรูปใหม่ · สติกเกอร์หลายตัวต่ออัน (นอกจาก rain) · เส้นทางที่ออกนอกกรอบ · ท่าที่อยู่กับที่ผ่าน keepClear ·
ท่าที่ AI กำหนดเอง · โควตาแยกชนิด · เสียงประกอบสติกเกอร์ (เสียงมาจาก M10 อยู่แล้ว) · เปิด outline ที่มีสติกเกอร์ด้วยแอป 0.2.0 (ไม่รองรับการถอยเวอร์ชัน `summaryOf` เก่าอ่าน `pieces` ไม่ได้) ·
แอปที่รูปหายไปจาก Resources (ติดตั้งเสีย): สติกเกอร์ที่เก็บไว้เรนเดอร์ไม่ได้และแจ้งเป็น environment problem ให้ติดตั้งแอปใหม่

## 11. ไฟล์ที่แตะ

- core: `graphics/plan.ts`, `graphics/emoji.ts` (ใหม่), `graphics/direct.ts`, `graphics/kit/html.ts`, `graphics/kit/version.ts`
- desktop main: `graphics-cues.ts`, `graphics-render.ts`, `flair.ts` (ส่ง `known`, ตรวจตอนบันทึก), `highlights.ts` (ส่ง canvas), `highlight-api.ts` (ตรวจ patch), `index.ts` (อ่าน index.json ส่งต่อ)
- desktop shared: `api.ts`
- desktop renderer: `edit/GraphicSheet.tsx`, `screens/EditScreen.tsx` (onSave ส่งข้อความผิดพลาด), `i18n.ts`
- resources: `graphics/timeline.js`, `graphics/kit.js`, `graphics/kit.css`, `graphics/emoji/` (ใหม่ 1,595 PNG + index.json + license)
- scripts: `fetch-fluent-emoji.mts` (ใหม่), `graphics-kit-check.mjs`, `release-check.ts`
- docs: สเปกนี้ · สเปกหลัก §6/§7 · memory `prodeck2-design-decisions.md`
- `apps/desktop/package.json` → 0.3.0

## 12. ลำดับทำ

0. สคริปต์โหลดรูป + รูป + license + release-check
1. core: ชนิดข้อมูล `LEGACY_ICONS` `emojiKey` + เทสต์
2. `timeline.js`: `stickerMoves` `stickerSize` `seeded` + เทสต์
3. `kit.js`/`kit.css`/`html.ts`/`graphics-render.ts`: สติกเกอร์ ไอคอนอีโมจิ ก๊อป PNG hash + เทสต์ + kit-check
4. `direct.ts`: คำสั่ง schema accept + เทสต์
5. `graphics-cues.ts`/`flair.ts`/`index.ts`/`api.ts`: upgrade สรุป job ตรวจตอนบันทึก + เทสต์
6. renderer: `GraphicSheet` `FlairTab` `i18n` + เทสต์
7. mutation check · ลองจริง 0917 · docs · 0.3.0 · `npm run dist` · ติดตั้ง

## 13. ผลที่ได้ (2026-09-25)

- ทำตามแผน `docs/plans/2026-09-25-sticker-graphics.md` 12 งาน + งาน 11b ด้วย subagent ทีละงาน รีวิว 2 ขั้น (ตรงสเปก แล้วคุณภาพ) ทุกงาน · snapshot โค้ดก่อนทุกงานใน scratchpad `m24/` เพราะไม่มี git
- รีวิวแผนก่อนเขียนโค้ด 3 คน 40 ข้อ แก้ครบ (ที่ใหญ่: ขนาดนับจากด้านสั้น · fly → pop ตอนอ่านใช้กับที่ผู้ใช้เลือกเองด้วย · สติกเกอร์ไม่มีที่ย้ายไปช่วงว่างที่สูงที่สุด · อ่านชุดรูปไม่ได้ไม่ล้มการ์ดธรรมดา · hash สติกเกอร์ไม่รวมฟอนต์/สี)
- รูป: Fluent Emoji 3D commit `1ffb34c7` 1,595 รูป 256 px (54 MB) ใน `resources/graphics/emoji/` + `index.json` + license · ชุดเรนเดอร์ไม่เปลี่ยน
- ตรวจชุดใน Chrome จริง (`graphics-kit-check.mjs`) ครบ 7 ท่า + ไอคอนอีโมจิบนการ์ด และ `hyperframes render` จริง 1 ครั้ง (ProRes 4444 yuva444p12le จรวดบนพื้นโปร่ง)
- **ลองจริงบน 0917 รอบแรก:** Claude เลือก 🚀 fly-up บน "อวกาศ" และ 🪐 float ทั้งคู่ขนาด 0.1 คงการ์ดนับถอยหลังที่ผู้ใช้แก้ไว้ · เรนเดอร์ชิ้นละ ~2.7 วิ เขียนครบ (`graphicCount 3, graphicsSkipped 0`) · ผู้ใช้ดูใน CapCut: สติกเกอร์เล็กเกิน (ราว 108 px) และจรวดพุ่งได้แค่ ~85 px เพราะติดแถบอก 0.64–0.76 ระหว่างหน้าคนกับซับ → ผู้ใช้เลือก "ขยายใหญ่ขึ้น" และ "ผ่านหน้าได้" (§2)
- **งาน 11b:** ขนาด 0.2–0.3 ปริยาย 0.25 · fly-up/fly-across/rain ไม่หลบ keepClear · fly-up ยืดเต็มช่วงว่าง · กรอบท่าที่เคลื่อนที่สูงได้ 0.8 · prompt `graphics-2026-09-25-stickers-2` · kit `kit-2026-09-25-2` (ค่าปริยายของชุด 0.25) · รีวิวคุณภาพเจอ prompt ขัดกันเอง (หัวตารางที่ว่างบอก "ให้ลดขนาด" ขณะบรรทัดขนาดบอกไม่ต้อง) แก้แล้ว · mutation `graphics-cues.ts` 11 จุด จับได้ 10 (1 จุดเทียบเท่า) `direct.ts` 6/6
- **ลองจริงบน 0917 รอบสอง:** Claude เลือก 👨‍🚀 pop ขนาด 0.22 บน "นักบินอวกาศ…" · 🚀 fly-up ขนาด 0.25 กรอบ 0.36–0.75 ยืดเป็น 0.35–0.74 (ระหว่างข้อความเด่นกับซับ ผ่านไหล่ขวาขึ้นข้างหน้า ราว 750 px ใน 3 วิ) · คงการ์ดนับถอยหลัง · เขียนครบ 3 ชิ้น (แทร็กซ้อน 3 ช่วง 3.133–5.333, 8.067–11.067, 15.5–18.1 วิ) · ข้อสังเกต: จรวดเริ่มต้นประโยคเพราะ Claude ไม่ระบุ `word` · listener ของกราฟิกใน renderer ได้ event ซ้ำสองครั้ง (ยังไม่ได้ตามหาสาเหตุ ไม่มีผลกับผลลัพธ์)
- ทดสอบ: 135 ไฟล์ ผ่าน 1,971 ข้าม 3 (M23 จบที่ 1,859) · typecheck ผ่าน · `apps/desktop/package.json` 0.3.0
