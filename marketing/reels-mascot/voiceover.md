# Voice-over script: BOXBLACK puppy reel (30 s, 9:16)

Thai lines, one per scene. Names and numbers are spelled the way they should be read, because TTS
mispronounces English words inside Thai sentences.

| Starts at | Scene | Line (as sent to TTS) |
|---|---|---|
| 0:00 | Hook | ตัดคลิปเองทั้งคืน... ยังไม่เสร็จอีก?! |
| 0:04 | Puppy arrives | ไม่ต้องแล้ว! ให้ บ็อกซ์แบล็ก ตัดให้! |
| 0:06 | Step 1 | แค่เลือกโปรเจค เอไอ ฟังทุกคำ ดูทุกภาพ |
| 0:10 | Step 2 | วางโครงเรื่องให้เสร็จ |
| 0:12 | Step 3 | ตัด เอ่อ อ่า ช่วงเงียบ ทิ้งหมด! |
| 0:14 | 47 min → 0:28 | จากสี่สิบเจ็ดนาที เหลือคลิปพร้อมโพสต์! |
| 0:16 | Step 4 | ใส่ข้อความ ซูม กราฟิก เสียง ซับ ครบทั้งคลิป |
| 0:22 | Step 5 | กดเดียว ลง แคปคัต |
| 0:24 | Done | เสร็จ! แถมสำรองไว้ให้ด้วย |
| 0:26 | CTA | บ็อกซ์แบล็ก ตัดต่อแคปคัตด้วยเอไอ... ทักแชทมาเลย! |

## How it goes in

- Voice: ElevenLabs, model Eleven v3 or Multilingual v2, a bright voice, stability ~0.4, speed ~1.1.
  The API key is read from `ELEVENLABS_API_KEY`; the environment must allow `api.elevenlabs.io`.
- Generate each line on its own, place it at its scene's start, and time-stretch (without pitch change)
  any line longer than its scene.
- Duck the music about 8 dB under the voice, then mux into `boxblack-puppy-reel.mp4` (video stream copied).
