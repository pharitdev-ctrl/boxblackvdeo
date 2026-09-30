# M23 · กราฟิกซ้อนภาพ (HyperFrames) — design

> **สถานะ (2026-09-30): ถูกแทนที่ในรุ่น 0.5.0** ชุดการ์ด (ตัวเลข แถบเทียบ รายการติ๊ก ลูกศร) ของเอกสารนี้ถูกถอดออกจากแอปแล้ว กราฟิกตอนนี้ Claude ออกแบบและเขียนแอนิเมชันเองทีละชิ้น ดู `docs/specs/2026-09-30-freeform-motion-design.md` ส่วนที่ยังใช้อยู่คือตัวเรนเดอร์ (HyperFrames) การวางกราฟิกบนเฟรมให้พ้นหน้าและข้อความ และการเขียนลงดราฟต์ กราฟิกแบบเดิมที่โปรเจกต์เก่าเก็บไว้ถูกล้างครั้งเดียวตอนเปิดด้วย 0.5.0 โดยสำรองไฟล์ไว้ที่ `outlines-before-050`

วันที่ 2026-09-24 · ต่อจาก M10 (ลูกเล่น: เสียง ซูม สื่อแทรก) และ M15 (การวางสื่อแทรก)

## 1. ที่มา

ผู้ใช้: *"HyperFrames ทำเป็นกราฟิกเล็ก ๆ ไปใช้รวมกับตัวที่มีอยู่ของ CapCut"* — กราฟิกโปร่งใสชิ้นเล็ก วางทับฟุตเทจ
**เสริม**สิ่งที่ CapCut และ BOXBLACK ทำอยู่แล้ว (ข้อความเด่น ฟอนต์ แอนิเมชัน เสียง ซูม สื่อแทรก) ไม่แทน

Spike บน 0917 (2026-09-24, สำรองและคืนแล้ว) พิสูจน์แล้วว่า

- `hyperframes render --format mov` ให้ ProRes 4444 (`yuva444p12le`) · CapCut 9.4 เล่นโปร่งใสทับฟุตเทจ ภาพคม ไม่กระตุก
  เมื่อวางเป็น overlay video track (`flag: 2`) พร้อม bin item ใน `draft_meta_info.json` และไฟล์อยู่ใต้ `~/Movies`
- ตรงเสียงได้ เมื่อส่งเวลาของแต่ละคำเข้าไปในกราฟิก (ผู้ใช้ยืนยัน "ตรงเสียงแล้ว")
- กราฟิก 4–6 วินาที เต็มจอ 1080×1920 เรนเดอร์ราว 7 วินาที · ไฟล์ราว 13 MB ต่อวินาที (80.5 MB สำหรับ 6.3 วินาที)

## 2. สิ่งที่ผู้ใช้เลือก

| เรื่อง | ทางเลือก | ที่เลือก |
|---|---|---|
| บทบาท | แทนของ CapCut / เสริม | **เสริม ไม่แทน** — ข้อความเด่น ซับ เสียง คงเดิมทั้งหมด |
| ใครออกแบบ | ผู้ใช้เลือกชุดแม่แบบ / AI คิดเอง | **AI คิดเองว่ากราฟิกแบบไหน หน้าตายังไง ช่วงไหนของวิดีโอ** |
| วิธีสร้าง | A: Claude เขียน HTML สด · B: ชุดชิ้นส่วน Claude ประกอบ · C: ทั้งสอง | **B ชุดชิ้นส่วน** — เรนเดอร์ไม่พัง ทดสอบได้ แก้ในแอปได้ |
| ตัวเรนเดอร์ | Electron เรนเดอร์เอง / แพ็ก HyperFrames ใส่แอป / โหลดครั้งแรก | **โหลดครั้งแรก** |
| วิธีโหลด | ใช้ตัวโหลดของ HyperFrames (Chrome เป็น latest) / แพ็กของเราเอง | **แพ็กของเราเอง ปักเวอร์ชัน ตรวจ sha256** |

ค่าปริยายที่ผมเลือก (แก้ได้): จำนวนต่อระดับ · สื่อแทรกชนะกราฟิกเมื่อชนกัน · เรนเดอร์ทันทีหลังวางแผน · สวิตช์กราฟิกปิดเป็นค่าเริ่มต้น

## 3. ภาพรวมการไหล

1. **ถาม Claude แยกอีกหนึ่งครั้ง** ในปุ่ม "จัดลูกเล่น" เดิม ต่อจากคำขอลูกเล่น เฉพาะเมื่อสวิตช์กราฟิกเปิด (prompt ลูกเล่นใหญ่อยู่แล้ว และกราฟิกต้องเห็นภาพฉาก) —
   ส่งประโยคพร้อมเวลาคำ คำบรรยายฉาก + `keepClear` จาก vision เฟรมของแต่ละฉาก ระดับความจัด และรายการชิ้นส่วน
2. **Claude ตอบ JSON** ต่อกราฟิก: ประโยคกับคำที่เริ่ม ความยาว กรอบบนจอ ชิ้นส่วน 1–3 ชิ้นพร้อมค่า โทนสี แบบเข้า/ออก และเหตุผลหนึ่งบรรทัด
3. **แอปตรวจแล้วคุมกฎ** (`acceptGraphics` + `enforceGraphics`) แบบเดียวกับ `acceptFlair` + `enforceInserts`
4. **เก็บ** ใน `StoredOutline.flair.graphics` — anchor แบบ `speech` + `beatId` เหมือนสื่อแทรกตามคำพูด
5. **เรนเดอร์เบื้องหลังทันที** — HTML จากชุดชิ้นส่วน → HyperFrames → `.mov` + `.png` ตัวอย่าง ใต้ `~/Movies/CapCut/BOXBLACK/graphics/`
6. **ตอนเขียนลง CapCut** — bin item ต่อไฟล์ + overlay track ใหม่ ลำดับชั้น: ภาพ → ซูม → สื่อแทรก → **กราฟิก** → ข้อความเด่น/ซับ → เสียง

## 4. ชุดชิ้นส่วน (`packages/core/src/graphics/kit/`)

กราฟิกหนึ่งอัน = **กรอบ** หนึ่งกรอบบนจอ + ชิ้นส่วน 1–3 ชิ้นข้างใน (หรือชิ้นชี้จุดที่วางนอกกรอบได้) เข้า–อยู่–ออก ตามเวลาคำพูด

| ชิ้น | ใช้เมื่อ | ค่าที่ Claude ให้ |
|---|---|---|
| `number` ตัวเลขวิ่ง | พูดถึงยอด ราคา จำนวน | `from`, `to`, `unit`, `text` (ป้ายกำกับ), `at` (คำที่เริ่มวิ่ง), `until` (คำที่ถึงค่าสุดท้าย) |
| `label` ป้าย | ชื่อ หัวข้อสั้น ๆ ของกราฟิก | `text`, `at` |
| `bars` แถบเทียบ | เทียบ 2–4 ค่า | `items: [{ text, value, at }]`, `unit` |
| `checks` รายการติ๊ก | ขั้นตอน รายการ | `items: [{ text, at }]` ติ๊กทีละข้อตามคำ |
| `arrow` ลูกศร | ชี้ของในภาพ | `target: [x, y]` (สัดส่วนจอ) วาดจากขอบกรอบไปหาเป้า, `at` |
| `ring` วงกลมชี้ | ล้อมของในภาพ | `target: [x, y]`, `size` (สัดส่วนความกว้างจอ), `at` |
| `icon` ไอคอน | เสริมอารมณ์ | `icon` จากชุดคงที่ 12 แบบ (ดาว หัวใจ ติ๊ก กากบาท เตือน เงิน นาฬิกา ไฟ ลูกศรขึ้น ลูกศรลง ของขวัญ ตะกร้า), `at` |

- **เวลา** ทุกค่า `at`/`until` เป็น**คำในประโยค** (คัดลอกตรงตัว) หรือว่าง = ต้นกราฟิก · แอปแปลงเป็นวินาทีนับจากต้นกราฟิก
  แบบเดียวกับ `--variables` ใน spike แล้ว**ฝังลง HTML** ตอนสร้าง (ไม่ใช้ `data-composition-variables` เพราะค่าเป็นโครงสร้างซ้อน)
- **สี** = `tone: "base" | "accent" | "alt"` ผูกกับพาเลตของสไตล์ข้อความเด่นที่ใช้อยู่ (`text` / `accent` / `alt` / `bar`) ·
  **ฟอนต์** = ฟอนต์ของสไตล์นั้น (`HIGHLIGHT_FONTS`) ผ่าน `@font-face` จากไฟล์ .ttf ที่แอปมี → หน้าตาเข้าชุดกับข้อความเด่นเสมอ
- **เข้า/ออก** `in: "pop" | "rise" | "fade"`, `out: "fade" | "drop" | "shrink"` (ตัวจับเวลาของเราเอง)
- **กรอบ** `box: [x0, y0, x1, y1]` สัดส่วนของจอ · เรนเดอร์**เฉพาะกรอบ** (บวกขอบ 8 % ให้แอนิเมชันเข้าออกไม่ถูกตัด) ไม่ใช่ทั้งจอ
  แล้ววางบน CapCut ด้วย `scale`/`transform` → ไฟล์ราว 3–5 MB ต่อวินาที แทน 13 · ชิ้น `arrow`/`ring` ที่เป้าอยู่นอกกรอบ
  ขยายกรอบเรนเดอร์ให้คลุมเป้าโดยอัตโนมัติ
- **รันไทม์**: `kit.js` (สร้าง DOM จาก spec + timeline ที่ seek ได้ของเราเอง ลง `window.__timelines["main"]`) + `kit.css` อยู่ใน `apps/desktop/resources/graphics/` **แพ็กในแอป** (ไม่ใช่ใน core: core ถูก bundle ไฟล์ข้าง ๆ จะไม่ติดไป)
  ไม่โหลดจาก CDN ตอนเรนเดอร์ · `KIT_VERSION` เป็นส่วนหนึ่งของ hash ไฟล์ (เปลี่ยนชุดชิ้นส่วน = เรนเดอร์ใหม่)
- **ไม่ใช้ GSAP** (ตัดสินใจ 2026-09-24): สัญญาอนุญาตของ Webflow (มี.ค. 2025) ให้ "use, reproduce, display" แต่ไม่ได้เขียนว่าให้แจกจ่ายในแอปที่ขาย และห้ามเครื่องมือสร้างแอนิเมชันแบบไม่ต้องเขียนโค้ดที่อาจแข่งกับ Webflow — ต้องตีความ จึงเขียนตัวจับเวลาเล็ก ๆ เองตามสัญญาที่ HyperFrames ต้องการ (`seek`/`duration` ฯลฯ) ไม่มีไลบรารีบุคคลที่สามในกราฟิก

## 5. ตอนเลือกจุด (`packages/core/src/graphics/direct.ts`)

**ส่งให้ Claude**

- brief, ระดับความจัด, จอแนวตั้ง/แนวนอน
- ประโยคทุกประโยคของ rough cut พร้อมคำ (แบบ `SpeechSlot`) และบอกว่าประโยคไหนมีข้อความเด่น/สื่อแทรกอยู่แล้ว
- ต่อประโยค: ฉากที่เล่นตรงนั้น (`description`, `kind`, `keepClear`) · **เฟรมหนึ่งภาพต่อฉาก** (ดึงด้วย ffmpeg ตอนถาม ทิ้งหลังถาม
  แบบเดียวกับ `LookingSession` ของสื่อแทรก) เพื่อให้ `arrow`/`ring` ชี้ถูกที่
- รายการชิ้นส่วนกับกติกา

**กติกาใน prompt** — ใส่เฉพาะตอนคำพูดมี**ตัวเลข การเทียบ รายการ หรือของที่ต้องชี้** ไม่งั้นไม่ใส่ · เล็ก ไม่กินทั้งจอ · กรอบห้ามทับ `keepClear`
· ประโยคที่มีข้อความเด่นอยู่แล้ว กราฟิกต้องไม่พูดซ้ำคำเดิม (เช่น ราคาที่เป็นข้อความเด่นอยู่แล้วไม่ต้องทำตัวเลขวิ่งอีก) ·
ระดับกลางใส่เฉพาะจุดที่ช่วยจริง ระดับจัดเต็มใส่ได้ถี่ขึ้น ระดับน้อยไม่ถาม

**คำตอบ** (zod — ทุกฟิลด์ของชิ้นมีค่าเริ่มต้น เลี่ยง `anyOf` ที่ structured output ของ CLI อาจปฏิเสธ)

```ts
{ graphics: [{
  at: number            // เลขประโยค จาก 1
  word: string          // คำที่กราฟิกขึ้น "" = ต้นประโยค
  seconds: number       // 1.5–6
  why: string           // หนึ่งบรรทัด โชว์ในแอป
  box: number[]         // [x0, y0, x1, y1]
  tone: "base" | "accent" | "alt"
  in: "pop" | "rise" | "fade"
  out: "fade" | "drop" | "shrink"
  pieces: [{ kind, text: "", from: 0, to: 0, unit: "", at: "", until: "", items: [], target: [], size: 0, icon: "" }]
}] }
```

**`acceptGraphics(reply, sentences, canvas)`** ทิ้งและนับ: ประโยคไม่มี · `word` ไม่มีในประโยค (ไม่ทิ้ง: ใช้ต้นประโยค เหมือนสื่อแทรก) ·
`box` ไม่ครบ 4 กลับด้าน ออกนอกจอ หรือเล็กกว่า 18 % × 8 % ของจอ · ชิ้นเกิน 3 · ชิ้นที่ค่าไม่ครบตามชนิด
(`number` ที่ `from === to`, `bars` น้อยกว่า 2 แถว, `arrow`/`ring` ไม่มีเป้าหรือเป้านอกจอ …) · `at`/`until` ที่ไม่ใช่คำในประโยคหรืออยู่นอกช่วงกราฟิก → 0 ·
กราฟิกที่ไม่เหลือชิ้น → ทิ้ง · ผลคือ `GraphicCue[]` ที่เวลาชิ้นถูกแปลงเป็นวินาทีแล้ว

**กรอบทับ `keepClear`** (ตรวจใน main ที่รู้ฉาก ณ เวลานั้น — `keepClearAt`): ไม่ทิ้ง แต่**เลื่อนกรอบ**ไปแถบที่ว่างกว่า เหนือหรือใต้แถบห้ามบัง
แบบเดียวกับ `cardFraming` (ขนาดคงเดิม อยู่ในจอเสมอ) · เป้าของ `arrow`/`ring` ไม่เลื่อน

**`enforceGraphics(placed, level, durationUs)`** — ระดับน้อย: ไม่มี · ของผู้ใช้ชนะ · ยาวขั้นต่ำ 1.5 วิ (ถูกปลาย timeline ตัดสั้นกว่านั้น = ทิ้ง) ·
**ไม่ขึ้นซ้อนกันเลย** (เดิมต้องห่างกัน ≥ 4 วิ ด้วย ผู้ใช้ให้เอาออก 2026-09-26 เช่นเดียวกับซูมและสื่อแทรก) (อันหนึ่งยาวได้ถึง 6 วิ และทุกอันอยู่บน overlay track เดียว) · จำนวนราว 1 ต่อ 20 วิ (กลาง) / 1 ต่อ 10 วิ (จัดเต็ม) · **ชนกับสื่อแทรก** (ช่วงเวลาทับกัน) → กราฟิกแพ้ (ใน main ที่เห็นทั้งสองอย่าง)

## 6. โครงข้อมูล

```ts
// packages/core/src/graphics/plan.ts
interface GraphicPiece { kind: PieceKind; text?: string; from?: number; to?: number; unit?: string; atS: number; untilS?: number;
                         items?: { text: string; value?: number; atS: number }[]; target?: [number, number]; size?: number; icon?: string }
interface GraphicSpec  { version: string; box: [number, number, number, number]; seconds: number; tone: Tone;
                         in: GraphicIn; out: GraphicOut; pieces: GraphicPiece[]; why: string }
interface GraphicCue   { anchor: CueAnchor /* kind "speech" + beatId */; spec: GraphicSpec; edited: boolean; off: boolean }
```

- `StoredOutline.flair.graphics?: GraphicCue[]` · เดินทางผ่าน `regroupFlair` / `answerOnBeats` / `withBeatsRenamed` / `saveEdits`
  เหมือน `inserts` (anchor ชนิดเดียวกัน) · ของผู้ใช้ (`edited`) คงไว้ตอนวางแผนใหม่ · `off` = ผู้ใช้ปิดอันนั้น (ยังอยู่ให้เปิดคืน)
- **ตอนเขียน** ช่วงกราฟิก = `min(seconds, ปลายชิ้นที่เล่นประโยคนั้น − at)` (`placeOf` เดิม) — ตัดสั้นได้โดยไม่ต้องเรนเดอร์ใหม่
  เพราะ HTML นับเวลาจากต้นกราฟิกเอง

## 7. เรนเดอร์ (`apps/desktop/src/main/graphics-render.ts`)

- **hash** = sha256(spec + `KIT_VERSION` + ฟอนต์ + พาเลต + fps + ขนาดจอ) 16 ตัว · ไฟล์ `<graphics>/<hash>.mov`, `<hash>.png`, `<hash>.json`
  (กว้าง สูง ความยาว ตำแหน่งกรอบ) · มีครบ = ไม่เรนเดอร์ซ้ำ
- **คิว** ทีละอัน (แต่ละครั้ง HyperFrames เปิด Chrome หลายตัว ~256 MB ต่อตัว) · สั่ง `--workers 2 --quiet --frames-cache-dir off` ·
  หมดเวลา 120 วิต่ออัน · ล้มแล้วจำต่อ hash จนกว่าจะกดลองใหม่หรือวางแผนใหม่
- **ขั้นตอน**: โฟลเดอร์ชั่วคราว `<tmp>/boxblack-graphics/<hash>/` ← `index.html` (kit.js, timeline.js, kit.css และ spec ฝังอยู่ในหน้า) + `.ttf` ของสไตล์
  → `hyperframes render <dir> --format mov --fps <fps> -o <dir>/renders/<hash>.mov` → ย้ายไป `<graphics>/<hash>.mov`
  (ข้ามโวลุ่มได้: copy + rm แบบ `move()` ใน `write.ts`) → ภาพตัวอย่างด้วย ffmpeg ที่แพ็ก (เฟรมกลาง, png มี alpha) → เขียน `.json` → ลบโฟลเดอร์ชั่วคราว
- **รัน HyperFrames ด้วย Node ที่มากับชุดเรนเดอร์** (`<pack>/node/bin/node`, Node 24 LTS จาก nodejs.org ตรวจ SHASUMS256 ตอนสร้างชุด) ·
  ทางที่คิดไว้ก่อน — `process.execPath` + `ELECTRON_RUN_AS_NODE=1` — ผ่านตอนพัฒนา แต่แอปที่แพ็กปิด fuse `runAsNode` ไว้ (`electron-builder.cjs`)
  และไม่ควรเปิดกลับเพื่อสิ่งนี้ · ลูกค้าไม่ต้องลง Node · `runProcess` ใน core รับ `env` เพิ่ม เพื่อส่งสภาพแวดล้อมข้างล่างให้ child
- **สภาพแวดล้อม** (คุมไม่ให้แตะเครื่องผู้ใช้): `HOME=<userData>/hyperframes/home` · `TMPDIR=<userData>/hyperframes/tmp` · `XDG_STATE_HOME` ·
  `HYPERFRAMES_NO_TELEMETRY=1` · `DO_NOT_TRACK=1` · `HYPERFRAMES_SKIP_SKILLS=1` ·
  `HYPERFRAMES_BROWSER_PATH=<pack>/chrome-headless-shell/mac_arm-152.0.7977.30/chrome-headless-shell-mac-arm64/chrome-headless-shell` ·
  `HYPERFRAMES_FONT_CACHE_DIR=<home>` · `PATH=<Resources/bin>` เท่านั้น (ให้เจอ ffmpeg/ffprobe ที่แพ็ก ไม่เจอของ Homebrew — spike ขั้น 0 ยืนยันว่ามันไม่เรียกคำสั่งอื่นจาก PATH)
- **เมื่อไหร่**: หลัง `plan` เก็บกราฟิกแล้ว · หลังผู้ใช้แก้ · ตอน `writeTimeline` รอที่ยังไม่เสร็จ (event ความคืบหน้า) · แอปเปิดใหม่: เรนเดอร์ที่ค้างเมื่อเปิดหน้าตัดต่อ
- **event** `{ type: "graphics", folder, state: "progress", done, total } | { state: "done" } | { state: "failed", hash, error }`
- **ไม่ลบไฟล์เอง**: draft ของ CapCut ชี้ไฟล์เหล่านี้อยู่ ลบ = โปรเจกต์ผู้ใช้พัง · หน้าตั้งค่า (ทั่วไป) แถว "ไฟล์กราฟิก 1.2 GB" + ปุ่ม
  **ลบที่ไม่มี draft ไหนใช้** (สแกน `materials.videos[].path` ของทุก draft ใต้ root ของ CapCut ก่อนลบ) · ลบ = ย้ายลง Trash

## 8. ชุดเรนเดอร์ (`apps/desktop/src/main/graphics-pack.ts`)

- **แพ็ก** `boxblack-graphics-<packVersion>-mac-arm64.tar.gz` มี `node/` (Node 24 LTS darwin-arm64 เฉพาะ `bin/node` + LICENSE), `node_modules/`
  (hyperframes 0.8.65 + dependency ตัด `dist/studio`, `dist/skills`) และ `chrome-headless-shell/mac_arm-152.0.7977.30/` (รุ่นที่ spike ใช้) ·
  ราว 150 MB บีบอัด · สคริปต์ `apps/desktop/scripts/build-graphics-pack.sh` สร้าง → ทดสอบเรนเดอร์ตัวอย่างด้วยชุดที่ตัดแล้ว → พิมพ์ sha256 กับขนาด
- **ค่าคงที่ในแอป** `GRAPHICS_PACK = { version, url, sha256, bytes, node, hyperframes, chrome }` ใน `apps/desktop/src/shared/graphics-pack.ts`
  (แบบ `BUNDLED_FFMPEG`) · url บน GitHub Releases ที่เดียวกับ DMG · `release-check` ปฏิเสธ build ที่ sha256 ยังว่าง
- **ติดตั้ง**: โหลดเป็นสตรีมลง `<userData>/hyperframes/<version>.tar.gz.part` คำนวณ sha256 ไปด้วย · ไม่ตรง = ลบ + แจ้ง ·
  แตกด้วย `tar` ของ macOS ลง `<userData>/hyperframes/<version>/` · เขียน `installed.json` · ลบเวอร์ชันเก่า · ตรวจว่าไม่มี
  `com.apple.quarantine` ติดมา (Chrome ที่ puppeteer โหลดไว้มีแค่ `com.apple.provenance` และเซ็นแบบ ad-hoc; fetch ของ Node ไม่ใส่ quarantine
  แต่ต้องยืนยันหลังแตกไฟล์ใน spike) · event `graphics-pack` แบบเดียวกับ `model-download`
- **หน้าตั้งค่า (ทั่วไป)** แถว "ตัวเรนเดอร์กราฟิก": ยังไม่ติดตั้ง (ปุ่ม ติดตั้ง · บอกขนาด) / กำลังโหลด x % (ยกเลิก) / ติดตั้งแล้ว v… (ลบ) ·
  สถานะอยู่ใน `SettingsView.graphicsPack` — **ไม่ใช่** `ReadinessProblem` เพราะนั่นกั้นการวิเคราะห์ ซึ่งกราฟิกไม่เกี่ยว ·
  หน้าตัดต่อ (แท็บลูกเล่น) ขึ้นข้อความ "ยังไม่ได้ติดตั้งตัวเรนเดอร์กราฟิก" เมื่อสวิตช์กราฟิกเปิดแต่ยังไม่ติดตั้ง
- **ยังไม่ติดตั้งแต่เปิดสวิตช์**: วางแผนได้ (Claude ตอบ เก็บไว้) แต่เรนเดอร์รอ · กด "เขียนลง CapCut" → error ชัดว่าต้องติดตั้งหรือปิดกราฟิก

## 9. ffmpeg ที่แพ็ก

`build-ffmpeg.sh` เพิ่ม encoder `prores_ks,png` และ muxer `mov` (LGPL เหมือนเดิม · ขนาดเพิ่มไม่กี่ MB) ·
`REQUIRED_ENCODERS` / `REQUIRED_MUXERS` ใน `tool-check.ts` เพิ่มตาม · `FFMPEG-NOTICE.txt` สร้างใหม่ · เวอร์ชันคง 8.1.2
HyperFrames เรียก `ffmpeg`/`ffprobe` จาก PATH ด้วย `prores_ks -profile:v … -vendor apl0` และรับเฟรมทาง `rawvideo`/`image2pipe` (demuxer ทุกตัวอยู่ครบอยู่แล้ว)
→ **spike ก่อนเริ่ม**: เรนเดอร์ตัวอย่างโดย PATH มีแต่ ffmpeg ที่สร้างใหม่ ยืนยันว่า HyperFrames ไม่ต้องการ encoder อื่น

## 10. ตอนเขียน (`packages/core/src/capcut/graphics.ts`, `bin.ts`)

- `addGraphicTrack(info, graphics: TimelineGraphic[])` pure — material `type: "video"`, `has_audio: false`, `local_material_id` = bin id ·
  segment `volume: 0` · **วางตามพิกเซล**: `scale = 1 / min(cw/w, ch/h)` (CapCut วาด "fit" ที่ scale 1) ·
  `x = (cx/cw − 0.5) × 2`, `y = (0.5 − cy/ch) × 2` (หน่วยครึ่งจอ +1 = ขวา/บน) · track `flag: 2` ·
  `render_index` อยู่**เหนือสื่อแทรก (8 + track) และใต้ข้อความ (14000 + track)** → ใช้ `1000 + trackIndex`
- `addBinItems(meta: DraftMeta, items)` pure — เพิ่มลง `draft_materials[type 0].value` ฟิลด์ตาม spike
  (`create_time`, `duration`, `extra_info` = ชื่อไฟล์, `file_Path`, `width`, `height`, `id`, `import_time`, `import_time_ms`, `metetype: "video"`,
  `roughcut_time_range`, …) ข้าม id ที่มีอยู่แล้ว · `writeDraft(draft, info, { binItems })` รับเพิ่ม เขียน meta ในชุดเดียวกับ timeline
- `WriteResult.graphicCount` · กราฟิกที่เรนเดอร์ล้ม = ข้ามและนับใน `graphicsSkipped`

## 11. ในแอป

- `FlairOptions.graphic: boolean` **ค่าเริ่มต้น false** (ฟีเจอร์ต้องติดตั้งชุดเรนเดอร์และเพิ่มการเรียก Claude — ผู้ใช้เปิดเอง) ·
  สวิตช์ในแท็บลูกเล่นของหน้าต่างตั้งค่าคลิป "กราฟิกซ้อนภาพ" + hint
- `HighlightPreview.graphics: GraphicView[]` — `{ anchor, atUs, durationUs, what, beatId, why, summary, poster, render: "queued" | "rendering" | "ready" | "failed", edited, off }`
  · `summary` เช่น "ตัวเลขวิ่ง 0 → 1,200,000 บาท · ป้าย ยอดขายเดือนนี้" · `poster` ผ่าน `media://` เหมือน thumbnail ของ beat
- **แท็บลูกเล่น** เพิ่มส่วน "กราฟิก" ต่อ beat: เวลา · ภาพตัวอย่าง · summary · `why` · สถานะ · ปุ่ม **ปิด/เปิด** · ปุ่ม **แก้** เปิด sheet เล็ก:
  แก้ข้อความ ตัวเลข หน่วย ของแต่ละชิ้น และความยาว (วินาที) → `edited: true` + เรนเดอร์ใหม่ · ปุ่ม **ลองเรนเดอร์ใหม่** เมื่อล้ม
  ไม่มีการลากตำแหน่งหรือแก้เวลาคำใน v1
- แถวคำพูด (SpeechTab): ป้าย "กราฟิก" บนประโยคที่มี เหมือนป้ายรูป
- **API**: `setGraphic(folder, anchor, patch: { off?: boolean; spec?: EditableSpec } | null)` (null = ลบ) · `retryGraphic(folder, anchor)` ·
  `graphicsPackInfo()` · `installGraphicsPack()` · `cancelGraphicsPack()` · `removeGraphicsPack()` · `graphicFilesInfo()` · `cleanGraphicFiles()`
- **หน้าเตรียม**: ไม่เพิ่มในประมาณการ (การวางแผนลูกเล่นทั้งหมดเกิดบนหน้าตัดต่อและไม่มีประมาณการอยู่แล้ว) · แสดงราคาใน hint ของสวิตช์แทน

## 12. ราคาและเวลา

- Claude ต่อครั้งที่ "จัดลูกเล่น": ข้อความ ~3k + เฟรม 130 × จำนวนฉาก (สูงสุด 12 เฟรม) ≈ 5k input · output ~400 ต่อกราฟิก
- เรนเดอร์ ~7 วิต่อกราฟิก ทีละอัน · โปรเจกต์ 60 วิ ระดับกลาง ≈ 3 กราฟิก ≈ 20 วิ เบื้องหลัง
- ดิสก์ ~10–20 MB ต่อกราฟิก · ชุดเรนเดอร์ ~430 MB หลังแตก (Node ~100 + node_modules ~130 + Chrome ~190)

## 13. ข้อผิดพลาด

| กรณี | พฤติกรรม |
|---|---|
| ชุดเรนเดอร์ยังไม่ติดตั้ง | สถานะ "รอติดตั้ง" ในแท็บ · เขียนไม่ได้จนกว่าจะติดตั้งหรือปิดกราฟิก |
| sha256 ไม่ตรง / โหลดขาด | ลบไฟล์ แจ้ง ลองใหม่ได้ |
| เรนเดอร์ล้ม / หมดเวลา | แถวขึ้น "เรนเดอร์ไม่สำเร็จ" + 3 บรรทัดท้ายของ log · ลองใหม่ได้ · ตอนเขียนข้ามอันนั้น |
| ประโยคถูกตัดออกภายหลัง | `placeOf` คืน null → ไม่เล่น นับใน dropped เหมือนสื่อแทรก |
| ชิ้นชี้เป้าที่ vision ไม่รู้ตำแหน่ง | Claude ให้พิกัดจากเฟรมที่เห็นเอง · ถ้าไม่มีเฟรม ไม่เสนอ `arrow`/`ring` |
| CapCut เปิดอยู่ | gate เดิม |

## 14. ทดสอบ

core: `kit` สร้าง HTML ครบทุกชนิดชิ้น (snapshot) และไม่มี URL ภายนอก · `acceptGraphics` ทิ้งค่าผิดทุกแบบ + แปลงคำเป็นวินาที ·
`enforceGraphics` ทุกกฎ · คณิตวาง `scale`/`transform` จากกรอบ · `addGraphicTrack` + `addBinItems` (ข้าม id ซ้ำ)
main: คิวเรนเดอร์กับตัวรันปลอม (hash เดิมไม่เรนเดอร์ซ้ำ · ล้มแล้วจำ · timeout) · ติดตั้งแพ็กกับ fetch ปลอม (sha ผิด, ยกเลิกกลางทาง, ลบเก่า) ·
`graphicsInForce` (ชนสื่อแทรก, ปิด, ประโยคหาย) · `writeTimeline` รอเรนเดอร์ + นับ · settings/API
renderer: ส่วนกราฟิกในแท็บ · sheet แก้ · แถวตั้งค่า
จริง: spike ขั้น 0 (Node ใน Electron + ffmpeg ใหม่ + `HYPERFRAMES_BROWSER_PATH`) · เขียน 0917 ด้วยกราฟิก 2–3 อันที่ Claude เลือกเอง
ผู้ใช้เปิดดูใน CapCut · mutation check ทุกไฟล์ที่แตะ

## 15. ไม่อยู่ในขอบเขต

Claude เขียน HTML เอง (ทาง C) · เป้าที่ขยับตามของในภาพ · ลากตำแหน่ง/แก้เวลาคำในแอป · Intel Mac · ชิ้นส่วนเพิ่มจาก 7 ชนิดแรก ·
กราฟิกยาวกว่า 6 วิ · เสียงในกราฟิก

## 16. ไฟล์ที่แตะ

| ที่ | ไฟล์ | หน้าที่ |
|---|---|---|
| core | `graphics/plan.ts` | ชนิด `GraphicSpec`/`GraphicCue`/`GraphicPiece`, `enforceGraphics`, ค่าคงที่กฎ |
| core | `graphics/direct.ts` | prompt, schema, `acceptGraphics`, `planGraphics` |
| core | `graphics/kit/html.ts`, `kit/version.ts` | ตัวสร้าง `index.html` จาก spec (ฝัง kit; ฟอนต์วางข้างไฟล์) และ `KIT_VERSION` |
| app | `resources/graphics/kit.js`, `timeline.js`, `kit.css` | รันไทม์ในเบราว์เซอร์ (แพ็กผ่าน `extraResources`) |
| core | `graphics/framing.ts` | กรอบ → `scale`/`transform`, ขยายกรอบให้คลุมเป้า, เลื่อนหลบ `keepClear` |
| core | `capcut/graphics.ts`, `capcut/bin.ts`, `capcut/write.ts` | `addGraphicTrack`, `addBinItems`, `writeDraft` รับ `binItems` |
| core | `media/tool-check.ts` | encoder/muxer ที่ต้องมีเพิ่ม |
| main | `graphics-pack.ts` (+ `graphics-pack-constants.ts`) | โหลด ตรวจ sha256 แตก ลบ สถานะ |
| main | `graphics-render.ts` | คิว hash รัน HyperFrames poster event |
| main | `graphics-cues.ts` | `graphicsInForce`, ชนสื่อแทรก, เลื่อนหลบ keepClear, view |
| main | `flair.ts`, `highlights.ts`, `timeline.ts`, `planner.ts`, `highlight-api.ts`, `settings-api.ts`, `index.ts` | ต่อสายเข้ากับที่มีอยู่ |
| shared | `api.ts` | `GraphicView`, `GraphicCue` ใน `StoredOutline.flair`, method ใหม่, event ใหม่ |
| renderer | `edit/FlairTab.tsx`, `edit/GraphicSheet.tsx`, `edit/SpeechTab.tsx`, `edit/ClipSettingsSheet.tsx`, `screens/SettingsScreen.tsx`, `i18n.ts` | UI |
| scripts | `build-ffmpeg.sh`, `build-graphics-pack.sh`, `release-check.ts` | ของที่แพ็ก |

## 17. ลำดับทำ

0. **Spike** (ก่อนเขียนโค้ดจริง): สร้าง ffmpeg ใหม่ → เรนเดอร์ตัวอย่างของ spike เดิมด้วย Node 24 จาก nodejs.org (ไม่ใช่ของ Homebrew) + PATH เฉพาะ ffmpeg ใหม่ + `HYPERFRAMES_BROWSER_PATH` ชี้ Chrome ในแคช spike → ตรวจ quarantine หลังแตก tar
   **ผล (2026-09-24): ผ่าน** · ffmpeg 8.1.2 สร้างใหม่ด้วย `prores_ks,png` + `mov` (ขนาด +0.3 MB, ยังลิงก์แค่ของ macOS) ·
   Node 24.21.0 (nodejs.org, SHASUMS256 ตรง) + Chrome for Testing 152.0.7977.30 + `env -i` ที่ PATH มีแค่ ffmpeg/ffprobe ที่แพ็ก →
   เรนเดอร์ spike ที่ตรงเสียงได้ใน 8 วิ `prores yuva444p12le` 1080×1920 · ภาพตัวอย่างจาก ffmpeg ที่แพ็กได้ PNG RGBA
   (ออกมา 16-bit → ใส่ `-pix_fmt rgba` ให้เล็กลง) · tar ไป-กลับไม่มี `com.apple.quarantine` · Node + Chrome บีบอัด 130 MB (รวม node_modules ≈ 160 MB)
1. ffmpeg + ชุดเรนเดอร์: build script, ค่าคงที่, ตัวติดตั้ง, หน้าตั้งค่า
2. ชุดชิ้นส่วน + ตัวสร้าง HTML + ตัวเรนเดอร์ (คิว, hash, poster)
3. เลือกจุด: prompt, schema, accept/enforce, เก็บ, เดินทางผ่าน regroup/beats
4. เขียนลง CapCut: bin items + track
5. UI: แท็บ, sheet, ป้าย, สวิตช์
6. ทดสอบจริงบน 0917 · เอกสาร (สเปกหลักข้อ 6 เพิ่ม M23) · bump version · DMG

## 18. ผลที่ได้ (2026-09-25, 0.2.0)

**ทดสอบจริงบน 0917 (สำรองก่อน แล้วคืนจนไฟล์ตรงเดิมทุกไบต์)**
- ติดตั้งชุดเรนเดอร์ผ่านหน้าตั้งค่าจากเซิร์ฟเวอร์ในเครื่อง (163 MB, sha256 ตรง) → แตกไฟล์และตรวจครบในไม่กี่วินาที
- ให้ AI จัดลูกเล่น (ระดับจัดเต็ม, คลิป 21 วิ): Claude ใส่กราฟิก 3 อัน — ป้าย "บินเองไม่ได้" + ไอคอนกากบาท, ตัวเลขวิ่ง 3 → 1 "นับถอยหลัง", ป้าย "ว้าว!" + ไอคอนดาว ·
  ทั้งการวางแผนและเรนเดอร์ทั้ง 3 อันเสร็จใน 42 วิ · แก้ข้อความของตัวเลขแล้วเรนเดอร์ใหม่ได้ใน 3 วิ (hash ใหม่) · ปิด/เปิดกราฟิกทำงาน
- ไฟล์: ProRes 4444 `yuva444p12le` 30 fps ขนาด 700–916×410 ยาว 2–3 วิ ไฟล์ละ 5–10 MB · ภาพตัวอย่าง PNG ไม่กี่ KB
- เขียนลง draft: แทร็กวิดีโอซ้อน (`flag 2`, `render_index 1004`) อยู่ใต้ข้อความเด่น (14000+) · bin item 3 อัน (id UUID ตัวเล็ก) ·
  กราฟิกอันสุดท้ายถูกตัดให้จบที่ปลายคลิป · ผู้ใช้เปิดดูใน CapCut 9.4 แล้วปิด → CapCut บันทึก draft ใหม่ กราฟิกทั้ง 3 ยังอยู่ครบ path เดิม ไม่มีเครื่องหมายสูญเสีย
- **บั๊กที่เจอระหว่างทดสอบ:** (1) Node fetch ใน main ของ Electron 44 (undici 7.29.1) โยน `assert(!this.paused)` แบบไม่มีใครจับตอนดาวน์โหลดใหญ่ที่รอเขียนดิสก์ →
  Electron ขึ้นกล่อง error ค้างทั้งแอป (ทำซ้ำได้ 2 ใน 3) → ดาวน์โหลดใหญ่สองอัน (ชุดเรนเดอร์, โมเดลถอดเสียง) ใช้ `net.fetch` ของ Electron แทน (0 ใน 3) ·
  (2) ชื่อไอคอนในสรุปเป็นอังกฤษ → ใช้ชื่อไทย

**รีวิวทั้งฟีเจอร์ก่อนออก** · reviewer อ่านอย่างเดียว 8 ด้าน + ผู้ตรวจอิสระพยายามหักล้างทุกข้อ (63 ตัว) → ยืนยัน 29 ข้อ ตีตก 6 · แก้ครบทุกข้อ เป็น 5 ชุด + ชุดตามเก็บ ทุกชุดเขียนเทสต์ที่ล้มก่อนแล้วรีวิวซ้ำจนผ่าน
- **เขียนซ้อน (ร้ายแรง):** การเขียนรอเรนเดอร์ได้หลายนาที ถ้าออกไปหน้าอื่นแล้วกลับมากดเขียนอีก สองการเขียนชนกันจน draft เสีย (วัดได้ 2–3 ใน 20) →
  ล็อกต่อ draft ใน main (เขียน/กู้คืนซ้อนถูกปฏิเสธ) · ไฟล์พักของแต่ละการเขียนชื่อไม่ซ้ำ · หน้าจอรู้ว่ากำลังเขียนแม้ถูกสร้างใหม่ (`writingTimeline` + event) ·
  ระหว่างเขียนแก้อะไรไม่ได้ (รวมโครงเรื่องและกู้คืน) · ผลของการเขียนแจ้งผู้ใช้ครั้งเดียวเสมอ ไม่ว่าอยู่หน้าไหน · CapCut ถูกเช็กอีกรอบหลังเรนเดอร์เสร็จ
- **เวลาและตำแหน่ง:** หาคำแบบเลือกขอบคำก่อน ("990" ไม่ไปติดใน "1,990") · เวลาชิ้นส่วนนับบนนาฬิกาของคลิปที่ตัดแล้ว ·
  กราฟิกจบที่ปลายช่วงที่เล่นประโยคนั้น (อย่างน้อย 1.5 วิ) และหลบข้อความเด่น/หน้าคนทุกอันที่อยู่บนจอตลอดช่วงที่แสดง · สองกราฟิกไม่ซ้อนกันหลังปัดเฟรม ·
  เฟรมที่แนบให้ Claude ใช้กับประโยคที่ใส่กราฟิกได้เท่านั้น · ค่าแท่งติดลบถูกปฏิเสธ
- **ลบไฟล์ที่ไม่ได้ใช้:** อ้างอิงอ่านจาก JSON ทุกไฟล์ของ draft (รวม media bin, compound clip, subdraft) · ไม่ลบระหว่างเรนเดอร์/เขียน และไม่ลบไฟล์อายุไม่ถึง 10 นาที ·
  ข้อความบอกผลตามจริง (ถูกบล็อก / ข้ามไฟล์ใหม่ / หยุดกลางทาง) ไม่แสดง path ที่มีชื่อผู้ใช้
- **ตัวเรนเดอร์:** ส่ง event ตอนเริ่มเรนเดอร์ ("กำลังเรนเดอร์…" ขึ้นจริง) · ปัญหาของเครื่อง (ชุดเรนเดอร์เสีย, ffmpeg หาย) ไม่ติดเป็นความล้มเหลวของกราฟิกทีละอัน
  แต่บอกเหตุผลจริงทั้งในแท็บลูกเล่น หน้าตั้งค่า และตอนเขียน · ติดตั้งชุดเรนเดอร์เสร็จแล้วหน้าตัดต่อเรนเดอร์ต่อเอง · เปลี่ยนสี custom แล้วเรนเดอร์ใหม่
- **ชุดชิ้นส่วน:** ไม่แสดง "-0" · แท่งค่าติดลบยาว 0 · ตัวเลขวิ่งจัดขนาดตามข้อความที่กว้างที่สุดที่นับผ่าน (`KIT_VERSION` ขยับ)
- **ของที่แพ็ก:** release check ของลูกค้าดาวน์โหลดชุดเรนเดอร์ที่เผยแพร่จริงมาเทียบ sha256 + ขนาด · ตรวจความสามารถของ ffmpeg ที่แพ็ก (ไม่ใช่แค่เลขรุ่น) ·
  ชุดเรนเดอร์มี `THIRD-PARTY-NOTICES.txt` (แพ็กเกจที่ฝังใน bundle ของ HyperFrames 44 ตัว, bundle ที่ย่อ, ไลบรารีใน libvips) และ build ล้มถ้ามีของที่ไม่ครอบ

**เผยแพร่:** ชุดเรนเดอร์ build ใหม่ให้มี `THIRD-PARTY-NOTICES.txt` (1.2 MB: แพ็กเกจ npm 44, ไลบรารี libvips 28, Rust crates ของ librsvg 350) · อัปโหลดที่ GitHub Releases `pharitdev-ctrl/boxblack` แท็ก `graphics-2026-09-24` · sha256 `ff67038858ae897ef303d22b61e2ac860e10e998eeef1b4c62c05f942388e0fd` 162,762,816 ไบต์ · DMG 0.2.0 build แบบลูกค้า (release check โหลดมาเทียบผ่าน) ผู้ใช้ติดตั้งแล้ว app.asar ตรง

**ตัวเลข:** เทสต์ 1,862 (ผ่าน 1,859 ข้าม 3) จาก 1,333 ก่อนเริ่ม M23 · mutation รอบท้าย 262 จุด จับ 222 → ช่องว่างจริง 26 จุดเติมเทสต์ครบ ที่เหลือเป็นแบบให้ผลเท่ากัน
