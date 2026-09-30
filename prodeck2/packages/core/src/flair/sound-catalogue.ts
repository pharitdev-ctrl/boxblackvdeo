import type { SoundEffect } from "./sounds.ts"

/**
 * Free sound effects from CapCut's own library, offered on every machine. A draft names them by
 * `effect_id` with no file, and CapCut downloads each one the first time the draft is opened
 * (verified 2026-09-23 on 0917, CapCut 9.4) — the way it fetches text animations by id. So a
 * machine with no drafts at all still has sounds, and nothing is shipped with the app.
 *
 * Picked 2026-09-23 from the catalogue CapCut had cached on the developer's machine
 * (`/lv/v1/get_collection_songs`): only `paid_type: "free"`, because a Pro sound locks the export
 * of anyone without CapCut Pro. Lengths are the catalogue's, rounded up to whole seconds; a draft
 * that uses a sound has the real one, and wins when the libraries are merged.
 */
export const BUILT_IN_SOUNDS: readonly SoundEffect[] = [
  { effectId: "7629175120686811153", name: "ui telop, text reveal, subtitle cue, motion cue, title popup, bright, lively, sharp, flashy, clean, video edit(1698298)", durationUs: 2_000_000, path: null, use: "หัวข้อหรือข้อความเด้งขึ้นจอ" },
  { effectId: "7167077030767364097", name: "Popping sound Popa No reverberation sound #10(1364638)", durationUs: 1_000_000, path: null, use: "ป๊อป สั้นใส ตอนของหรือคำโผล่" },
  { effectId: "6906958162219010050", name: "pop! (tapping the mouth with a hand)(912415)", durationUs: 1_000_000, path: null, use: "ป๊อปน่ารัก ตอนของเล็กๆ โผล่" },
  { effectId: "6993230936993204226", name: "ฟิ้ว", durationUs: 1_000_000, path: null, use: "ฟิ้ว ของพุ่งเข้าหรือเปลี่ยนเรื่องเร็วๆ" },
  { effectId: "6940659030947792897", name: "swish_whoosh (large)(794558)", durationUs: 1_000_000, path: null, use: "วูบใหญ่ ตัดไปอีกฉากหรืออีกช่วง" },
  { effectId: "7542712415625119807", name: "Comedy-Swipe_GEN-HD4-39889", durationUs: 1_000_000, path: null, use: "ปัดเร็วแบบตลก" },
  { effectId: "6817155807902173185", name: "Paper page turn sound 1 scene change swipe", durationUs: 1_000_000, path: null, use: "พลิกหน้ากระดาษ ขึ้นหัวข้อใหม่" },
  { effectId: "7005594836271958018", name: "Bell ring \"ding!\"", durationUs: 1_000_000, path: null, use: "ติ๊ง ประเด็นสำคัญ" },
  { effectId: "6817200211593529345", name: "Culin. It looks like a light bulb mark is on the head.", durationUs: 1_000_000, path: null, use: "ไอเดียผุด นึกออก" },
  { effectId: "7075773731481585666", name: "Ping Pong Ping Pong! Quiz correct answer button(1213763)", durationUs: 1_000_000, path: null, use: "ถูกต้อง ใช่เลย" },
  { effectId: "6995835233664763906", name: "ตอบคำถามผิด", durationUs: 1_000_000, path: null, use: "ผิด ไม่ใช่" },
  { effectId: "6925815304199899138", name: "Sorry / Failure / Disappointment / Comical Mid-6(945520)", durationUs: 2_000_000, path: null, use: "พลาด ผิดหวังแบบตลก" },
  { effectId: "6993230936988977154", name: "ฟาด", durationUs: 1_000_000, path: null, use: "ฟาด เน้นคำแรงๆ" },
  { effectId: "6839365583759214593", name: "Punch sound_1", durationUs: 1_000_000, path: null, use: "กระแทกหนัก เน้นจุดพีค" },
  { effectId: "6817567995657717761", name: "Kiratsu ☆ (light / beautiful / star)", durationUs: 1_000_000, path: null, use: "วิ้ง ประกายสั้น ของสวย" },
  { effectId: "7089302199234201602", name: "Sparkle,Metal,Shooting Star,Telop,Magic effect(1225026)", durationUs: 2_000_000, path: null, use: "ประกายวิบวับ เผยของสวยหรือผลลัพธ์" },
  { effectId: "6817556231327057922", name: "Glitter glitter / Glocken beautiful rising sound", durationUs: 3_000_000, path: null, use: "วิบวับไล่ขึ้น ก่อนเผยผลงานหรือก่อน/หลัง" },
  { effectId: "6873506883139799041", name: "Click_Mouse_Click_02(864360)", durationUs: 1_000_000, path: null, use: "คลิกเมาส์ สอนกดปุ่มในโปรแกรม" },
  { effectId: "7031713234772035586", name: "Enter key click keyboard decision(1146481)", durationUs: 1_000_000, path: null, use: "กดปุ่มยืนยัน" },
  { effectId: "7031590945095174145", name: "PC typing keyboard Kacha", durationUs: 1_000_000, path: null, use: "พิมพ์คีย์บอร์ด" },
  { effectId: "6817667219967707138", name: "coin! Get shop item 6", durationUs: 1_000_000, path: null, use: "เหรียญ ได้ของ ราคา โปรโมชั่น" },
  { effectId: "7011409643604592641", name: "点钞机数钱声", durationUs: 3_000_000, path: null, use: "นับเงิน รายได้ เงินเยอะ" },
  { effectId: "6886959373474596865", name: "Jean! (Suspense surprise)(878908)", durationUs: 2_000_000, path: null, use: "ตึง เซอร์ไพรส์ หักมุม" },
  { effectId: "6817534839583934465", name: "Sound when the record needle has fallen sideways", durationUs: 1_000_000, path: null, use: "แผ่นเสียงสะดุด เดี๋ยวนะ หยุดกึก" },
  { effectId: "6988031765419935745", name: "เสียงปรบมือ", durationUs: 5_000_000, path: null, use: "ปรบมือ จบ สำเร็จ" },
  { effectId: "7637077315972941874", name: "Task Done Chime", durationUs: 3_000_000, path: null, use: "เสร็จเรียบร้อย" },
  { effectId: "7054962350901692418", name: "Tear the paper 02(1166868)", durationUs: 1_000_000, path: null, use: "ฉีกกระดาษ แกะกล่อง ทิ้งของเก่า" },
  { effectId: "7637818387989039130", name: "TV On Chime", durationUs: 3_000_000, path: null, use: "เปิดทีวี เริ่มรายการ อินโทร" },
]

const BUILT_IN_IDS = new Set(BUILT_IN_SOUNDS.map((sound) => sound.effectId))

/**
 * Whether a sound needs CapCut Pro as far as the app can tell: the built-in ones are CapCut's free sounds, which
 * CapCut 9.5's export dialog confirmed on 2026-09-29 (a draft with all 28 went through it with no Pro prompt); any
 * other sound was read from a draft on this machine and may be a Pro one, so it counts as Pro (spec 0.4.2 §4.2).
 */
export const soundNeedsPro = (effectId: string): boolean => !BUILT_IN_IDS.has(effectId)

/** The sounds a user may put in a draft: every one with CapCut Pro, the built-in ones without. */
export const usableSounds = <T extends { effectId: string }>(sounds: readonly T[], pro: boolean): T[] => (pro ? [...sounds] : sounds.filter((sound) => !soundNeedsPro(sound.effectId)))
