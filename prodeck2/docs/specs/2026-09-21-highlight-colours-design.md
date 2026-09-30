# M13 · สีข้อความเด่น (highlight colours) — design

วันที่ 2026-09-21 · ต่อจาก M9 (ข้อความเด่น) M10.1 (รูปลักษณ์) M12 (สื่อแทรกตามคำพูด)

## 1. ปัญหา

ผู้ใช้ดูผลจริงแล้วบอกว่าสีข้อความเด่น "ไม่โอเค" 4 อย่าง: สีตัวหนังสือกับเส้นขอบเป็นสีเดียวกันจนมองไม่ออก ·
โทนสีฉูดฉาด · สีเดียวทั้งคลิป จืด · อยากกำหนดสีเอง

ต้นตอข้อแรกอยู่ในตารางสไตล์ (`highlights/styles.ts`): สไตล์ `cute-pink` ใช้ชมพูเป็นทั้งสีคำเน้น (`accent`)
และสีเส้นขอบ (`stroke`) คำที่ Claude เน้นจึงเป็นก้อนชมพูทึบ และ Claude เลือกสไตล์นี้ให้คลิปความงาม/เล็บ
ซึ่งเป็นงานจริงของผู้ใช้ · สไตล์อื่นรอดเพราะบังเอิญ — ระบบไม่มีกฎห้ามคู่สีที่อ่านไม่ออกเลย · โครง JSON
ที่เขียนลง draft ตรงกับที่ CapCut เขียนเองทุกช่อง (เทียบกับ 0815) ไม่ใช่ปัญหาการวาด

สิ่งที่ค้นมา (คู่มือคลิปสั้น 2025–26, OpusClip / Blitzcut / Taption / CapCut): ตัวหนังสือกับพื้นตัดกัน ≥ 4.5:1 ·
เน้นคำเดียวต่อบรรทัด เก็บสีแรงไว้ที่จุดตัดสินใจ · สีเน้นยอดนิยมคือเหลือง `#F7C204` รองลงมาแดง/เขียว ·
ขาวขอบดำเป็นพื้นฐาน · แถบสี pill ไม่ต้องมีขอบ · สไตล์สะอาดคอนทราสต์สูงชนะสไตล์ฉูดฉาด

## 2. แนวคิด: พาเลต + กฎอ่านออก

สไตล์ = ฟอนต์ + แอนิเมชัน + ความหนาขอบ + ความมนของแถบ + **พาเลต 4 สี**

```ts
interface Palette { text: Rgb; accent: Rgb; alt: Rgb; bar: Rgb }
```

สีอื่นทุกสี**คำนวณ**จากพาเลตด้วยกฎใน `highlights/colour.ts` (บริสุทธิ์ ไม่มี dependency):

- `contrast(a, b)` อัตราส่วนความสว่างแบบ WCAG 2.1
- `strokeFor(fill)` = ดำหรือขาว อันที่ตัดกับ `fill` มากกว่า — **คิดต่อช่วงสี** คำเน้นได้ขอบของตัวเอง
- `onSurface(bar)` = ดำหรือขาว สำหรับตัวหนังสือบนแถบ
- `readableAccent(wanted, surface, fallback)` = `wanted` ถ้าตัดกับ `surface` ≥ 3:1 ไม่งั้น `fallback`

ผลคือ "สีเดียวกันซ้อนกัน" เกิดไม่ได้ ไม่ว่าพาเลตไหน รวมทั้งที่ผู้ใช้ตั้งเอง · เทสต์ยาม (guard test) ไล่ทุกสไตล์ในตาราง:
ตัวหนังสือ/ขอบ ≥ 4.5 · ตัวหนังสือบนแถบ/แถบ ≥ 4.5 · คำเน้น/ขอบของมัน ≥ 3 · คำเน้นบนแถบ/แถบ ≥ 3

## 3. โทนต่อชุด (tone)

`GroupLook` ได้ `tone: "base" | "accent" | "alt"` = สีของตัวหนังสือทั้งชุด (`palette.text` / `palette.accent` / `palette.alt`) ·
คำเน้นในชุดใช้สีที่ไม่ใช่โทนของชุด: ชุด base เน้นด้วย accent, ชุด accent เน้นด้วย alt, ชุด alt เน้นด้วย accent ·
บนแถบ (pattern `bar`) โทนไม่มีผลกับตัวหนังสือ — ตัวหนังสือเป็น `onSurface(bar)` คำเน้นเป็น `readableAccent(accent, bar, readableAccent(alt, bar, onSurface))`

Claude เลือก tone ต่อชุดใน call จัดลูกเล่นเดิม (`groups[].tone`, ค่าเริ่มต้น base) · กฎบังคับ: โทนเดียวกันติดกันไม่เกิน 3 ชุด
(ชุดที่ 4 เป็น base) เหมือนกฎ pattern · ชุดที่ผู้ใช้แก้เองไม่ถูกแตะ · แก้เองได้ใน popover รูปลักษณ์

## 4. พาเลต 5 ชุด (id เดิม เพื่อให้ค่าที่เก็บไว้ยังใช้ได้)

| id | ชื่อ | text | accent | alt | bar |
|---|---|---|---|---|---|
| bold-white | ขาวสะอาด | #FFFFFF | #F7C204 | #8FD3FF | #F7C204 |
| bold-black | ดำมินิมอล | #111111 | #E63946 | #2F6FED | #FFFFFF |
| sale-yellow | เหลืองขายของ | #FFE45C | #FF5A5F | #FFFFFF | #E63946 |
| cute-pink | พาสเทลชมพู | #FFFFFF | #FF8FB1 | #FFD166 | #FFB6C8 |
| headline | พาดหัวคลาสสิก | #FFFFFF | #F2C14E | #DCDCDC | #111111 |

ฟอนต์และแอนิเมชันคงเดิม · `strokeWidth` คงเดิมต่อสไตล์ · `barRoundness` คงเดิม

## 5. กำหนดเอง

`HighlightStyleId` เพิ่ม `custom` · พาเลตของ custom เก็บใน **ตั้งค่าแอป** `highlights.custom: Palette`
(ใช้ได้ทุกโปรเจกต์ ค่าเริ่มต้น = พาเลต bold-white) · ผู้ใช้เลือกสไตล์ต่อโปรเจกต์เหมือนเดิม (`stored.highlights.style`) ·
Claude เลือกได้เฉพาะ 5 สไตล์ในตาราง ไม่เลือก custom · ขอบและสีบนแถบยังคำนวณให้ จึงเลือกสีแบรนด์อะไรก็อ่านออก

## 6. หน้าจอ

- **ตั้งค่าคลิป → ข้อความเด่น**: เลือกสไตล์ (Select เดิม รวม "กำหนดเอง") · ใต้ Select มีแถบตัวอย่าง 4 จุดของพาเลตที่เลือก
  (ตัวหนังสือ / คำเน้น / สีที่สอง / แถบ) · เมื่อเป็น custom มี color picker 4 ช่องแทนแถบตัวอย่าง เปลี่ยนแล้วบันทึกตั้งค่าและ preview ใหม่
- **popover รูปลักษณ์** ของชุด: เพิ่ม "โทนสี" (ปกติ / สีเน้น / สีที่สอง)
- แอปไม่มีพรีวิว: แถบตัวอย่างคือสิ่งเดียวที่บอกสีก่อนเขียน

## 7. ที่แตะ

- core `highlights/colour.ts` (ใหม่) · `highlights/styles.ts` (Palette, custom id, ตารางใหม่, `PICKABLE_STYLE_IDS`) ·
  `highlights/pick.ts` (Claude เลือกจากที่เลือกได้ ข้อความ mood ใหม่ เวอร์ชัน prompt) · `flair/plan.ts` (tone + กฎ run) ·
  `flair/direct.ts` (tone ใน schema/prompt เวอร์ชัน `flair-2026-09-21-tones`) · `capcut/highlights.ts` (look = พาเลต + ความหนาขอบ; สีต่อช่วงคำนวณ)
- main `settings.ts` (custom palette ตรวจค่า 0–1) · `timeline.ts` (look จากพาเลตในผล) · `highlight-api.ts` (tone, custom) · `flair.ts setLook` (tone)
- renderer `ClipSettingsSheet` (แถบตัวอย่าง + picker) · `LookPopover` (โทน) · i18n
- ไม่แตะ: การวาง (`layout.ts`) · ฟอนต์ · แอนิเมชัน · โครงเรื่อง · ซับ

## 8. ทดสอบ

colour.test (contrast/strokeFor/onSurface/readableAccent) · styles guard test ทุกสไตล์ · plan.test (tone run rule, edited untouched) ·
direct.test (tone accepted, unknown tone ตก, prompt บอกโทน) · capcut/highlights.test (ขอบต่อช่วง, สีบนแถบ, tone) ·
settings.test (custom palette) · highlight-api.test (tone, custom) · flair.test (write ด้วย custom palette) ·
EditScreen.test (แถบตัวอย่าง, picker บันทึก, โทนใน popover) · mutation check ทุกไฟล์ · เขียน 0917 แล้วอ่าน JSON กลับ (ไม่มีทางดูใน CapCut จากที่นี่ ผู้ใช้ดูเอง)
