import { expect, test } from "vitest"
import type { LlmRequest, LlmTransport } from "../llm/types.ts"
import { acceptSoundPlan, describeSoundClip, planComposedSounds, SOUND_PLAN_PROMPT, SOUND_PLAN_PROMPT_VERSION, SoundPlanSchema, type SoundClip, type SoundPlanReply } from "./plan.ts"
import { SOUND_ROLE_MAX, SOUND_SECONDS_MAX, SOUND_SECONDS_MIN } from "./spec.ts"

const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

function fakeTransport(output: SoundPlanReply) {
  const calls: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>) {
      calls.push(request as LlmRequest<unknown>)
      return { output: output as T, usage: USAGE }
    },
  }
  return { transport, calls }
}

// the prompt

test("the planning prompt is the plan's, line for line, and goes by its version", () => {
  expect(SOUND_PLAN_PROMPT_VERSION).toBe("sound-plan-2026-10-03-direction")
  expect(SOUND_PLAN_PROMPT.split("\n")).toEqual([
    "You are the sound designer of a short vertical video. You decide where it gets a sound effect and what each one does, and you set the clip's sound palette so all of them sound like one score. Another call then composes each sound as code from what you write here.",
    "",
    "You are given the clip's direction (in Thai, written when the story was planned, or none), and the clip as it plays after the rough cut: every spoken word with its number and its time, the beats, the emphasis points with their importance, the highlight text lines, the graphics with their idea, and the HTML that draws them when it is drawn already, the camera moves, the cutaways, and the level of decoration the user chose.",
    "",
    "Answer with:",
    "- palette: at most eight short lines in English: the key; the tempo feel; the instruments, as synthesised sounds a Web Audio programmer can build (for example bright square-wave plucks, soft sine bells, marimba-like mallets, filtered noise whooshes, a punchy synth kick, brass-like sawtooth stabs); the character; one short recurring motif as note names; what to avoid.",
    "- sounds, in time order. For each:",
    "  - word: the number of the spoken word it starts on;",
    "  - graphic: the number of the graphic it scores, or null; a sound that scores a graphic starts with it;",
    "  - seconds: how long it lasts with its tail, 0.2 to 6;",
    "  - role: one sentence in Thai saying what it does, concrete enough to compose from: what it sounds like, and which words or moments in the picture it hits;",
    "  - point: the number of the emphasis point it serves, or null;",
    '  - from: the lowest level it plays at: "light", "medium" or "heavy";',
    '  - loudness: "soft", "normal" or "strong".',
    "",
    "How to choose:",
    "- Follow the clip's direction: its mood and pace, and which parts it wants rich or plain.",
    "- Score the clip, not every word. A sound earns its place when it makes a moment land: a reveal, a punchline, a turn, a count, a list, a question, something appearing or moving on screen, a change of beat that needs a lift. Silence is part of the score.",
    "- light is only the moments that matter most; medium adds the clear supporting ones; heavy scores the clip richly. Give every sound the lowest level it should play at, so one answer serves all three levels. Plan for the level the user chose at least as fully as the level asks.",
    "- A graphic whose motion has hits (things appearing, counting, landing) gets a sound that follows its motion.",
    "- Two sounds overlap only when they are meant to be heard together.",
    "- Use the palette everywhere, and bring the motif back at the moments that tie the clip together, such as the question and its answer, or the start and the end.",
  ])
})

// the request

/** The countdown of draft 0917, made small: a question, then three, two, one over a graphic that counts them, and a push in on the last. */
const CLIP: SoundClip = {
  about: "ขึ้นอวกาศใน 3 2 1",
  direction: "  สนุก จังหวะเร็ว ช่วงราคาเป็นไฮไลต์ ",
  level: "medium",
  words: [
    { text: "นักบิน", atUs: 2_200_000 },
    { text: "อวกาศ", atUs: 2_440_000 },
    { text: "สาม", atUs: 9_000_000 },
    { text: "สอง", atUs: 10_260_000 },
    { text: "หนึ่ง", atUs: 11_220_000 },
  ],
  beats: [
    { name: "hook", startUs: 0 },
    { name: "countdown", startUs: 8_500_000 },
  ],
  points: [
    { importance: "key", type: "hook", what: "นักบินอวกาศขึ้นไปยังไง", atUs: 2_200_000 },
    { importance: "secondary", type: "number", what: "สาม สอง หนึ่ง", atUs: 9_000_000 },
  ],
  lines: [{ text: "ขึ้นไปยังไง?", atUs: 2_200_000 }],
  graphics: [{ idea: 'ตัวเลข 3 2 1 เด้งขึ้นทีละตัวพอดีคำว่า "สาม" "สอง" "หนึ่ง"', html: '<div class="n">3</div>\n<div class="n">2</div>', atUs: 8_900_000, seconds: 3.2 }],
  moves: [
    { atUs: 2_200_000, seconds: 0.4, about: "zoom punch" },
    { atUs: 11_220_000, seconds: 1.5, about: "ดันเข้าช้าๆ ตรงคำว่าหนึ่ง" },
  ],
  inserts: [],
}

test("the request lists every word with its number and time, then the beats, points, lines, graphics with their HTML, camera moves and cutaways", () => {
  expect(describeSoundClip(CLIP)).toBe(
    [
      "The clip: ขึ้นอวกาศใน 3 2 1",
      "Direction: สนุก จังหวะเร็ว ช่วงราคาเป็นไฮไลต์",
      "Level: medium",
      "Words:",
      "1. 0:02.2 นักบิน",
      "2. 0:02.4 อวกาศ",
      "3. 0:09.0 สาม",
      "4. 0:10.3 สอง",
      "5. 0:11.2 หนึ่ง",
      "Beats:",
      "- 0:00.0 hook",
      "- 0:08.5 countdown",
      "Emphasis points:",
      "1. 0:02.2 [key hook] นักบินอวกาศขึ้นไปยังไง",
      "2. 0:09.0 [secondary number] สาม สอง หนึ่ง",
      "Highlight text lines:",
      "- 0:02.2 ขึ้นไปยังไง?",
      "Graphics:",
      '1. 0:08.9, 3.2 s: ตัวเลข 3 2 1 เด้งขึ้นทีละตัวพอดีคำว่า "สาม" "สอง" "หนึ่ง"',
      "<fragment>",
      '<div class="n">3</div>',
      '<div class="n">2</div>',
      "</fragment>",
      "Camera moves:",
      "- 0:02.2 0.4 s: zoom punch",
      "- 0:11.2 1.5 s: ดันเข้าช้าๆ ตรงคำว่าหนึ่ง",
      "Cutaways: none",
    ].join("\n"),
  )
})

test("an empty list says none", () => {
  const bare: SoundClip = { about: "คลิปเงียบ", level: "light", words: [], beats: [], points: [], lines: [], graphics: [], moves: [], inserts: [{ what: "รูปจรวด", atUs: 1_000_000 }] }
  expect(describeSoundClip(bare)).toBe(
    ["The clip: คลิปเงียบ", "Direction: none", "Level: light", "Words: none", "Beats: none", "Emphasis points: none", "Highlight text lines: none", "Graphics: none", "Camera moves: none", "Cutaways:", "- 0:01.0 รูปจรวด"].join("\n"),
  )
})

test("the graphics' HTML has a budget of 80,000 characters; from the first that does not fit, a graphic's HTML is left out", () => {
  const graphic = (idea: string, length: number) => ({ idea, html: "x".repeat(length), atUs: 1_000_000, seconds: 2 })
  const full: SoundClip = { ...CLIP, graphics: [graphic("แรก", 50_000), graphic("ที่สอง", 30_000), graphic("ที่สาม", 1), graphic("ที่สี่", 1)] }
  const lines = describeSoundClip(full).split("\n")
  const from = lines.indexOf("Graphics:")
  expect(lines.slice(from, lines.indexOf("Camera moves:"))).toEqual([
    "Graphics:",
    "1. 0:01.0, 2 s: แรก",
    "<fragment>",
    "x".repeat(50_000),
    "</fragment>",
    "2. 0:01.0, 2 s: ที่สอง",
    "<fragment>",
    "x".repeat(30_000),
    "</fragment>",
    "3. 0:01.0, 2 s: ที่สาม",
    "(its HTML is left out: the request is full)",
    "4. 0:01.0, 2 s: ที่สี่",
    "(its HTML is left out: the request is full)",
  ])
})

test("a graphic planned but not drawn yet has its line and says so in place of its fragment, which takes nothing of the budget", () => {
  const drawn = (idea: string, length: number) => ({ idea, html: "x".repeat(length), atUs: 1_000_000, seconds: 2 })
  const undrawn = (idea: string) => ({ idea, html: null, atUs: 2_000_000, seconds: 1.5 })
  const clip: SoundClip = { ...CLIP, graphics: [undrawn("จรวด"), drawn("แรก", 80_000), undrawn("นาฬิกา"), drawn("ที่สอง", 1)] }
  const lines = describeSoundClip(clip).split("\n")
  expect(lines.slice(lines.indexOf("Graphics:"), lines.indexOf("Camera moves:"))).toEqual([
    "Graphics:",
    "1. 0:02.0, 1.5 s: จรวด",
    "(not drawn yet)",
    "2. 0:01.0, 2 s: แรก",
    "<fragment>",
    "x".repeat(80_000),
    "</fragment>",
    "3. 0:02.0, 1.5 s: นาฬิกา",
    "(not drawn yet)",
    "4. 0:01.0, 2 s: ที่สอง",
    "(its HTML is left out: the request is full)",
  ])
})

// reading the reply

const PALETTE = "Key: C major.\nInstruments: marimba-like mallets, a soft synth kick.\nMotif: G4-C5-E5."

/** An answer as Claude gives it: numbers from 1, a sound on a word. */
const sound = (fields: Partial<SoundPlanReply["sounds"][number]> = {}): SoundPlanReply["sounds"][number] => ({
  word: 1,
  graphic: null,
  seconds: 1.5,
  role: "เสียงระฆังใสตอนคำถาม",
  point: 1,
  from: "light",
  loudness: "normal",
  ...fields,
})

test("numbers from 1 become indexes from 0, and the rest comes as it was answered", () => {
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ word: 2, point: 2, from: "heavy", loudness: "soft", seconds: 2.5 })] }
  expect(acceptSoundPlan(reply, CLIP)).toEqual({
    palette: PALETTE,
    sounds: [{ word: 1, graphic: null, seconds: 2.5, role: "เสียงระฆังใสตอนคำถาม", point: 1, from: "heavy", loudness: "soft" }],
    dropped: 0,
  })
})

test("a word or a graphic out of range drops the sound, and is counted", () => {
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ word: 0 }), sound({ word: 6 }), sound({ word: 3, graphic: 0 }), sound({ word: 3, graphic: 2 }), sound({ word: 5 })] }
  const { sounds, dropped } = acceptSoundPlan(reply, CLIP)
  expect(sounds.map((kept) => kept.word)).toEqual([4])
  expect(dropped).toBe(4)
})

test("the word answered for a sound that scores a graphic is not read, so one out of range keeps the sound", () => {
  expect(acceptSoundPlan({ palette: PALETTE, sounds: [sound({ word: 99, graphic: 1 })] }, CLIP)).toMatchObject({ sounds: [{ word: 2, graphic: 0 }], dropped: 0 })
})

test("a sound that scores a graphic starts on the first word said at or after the graphic, whatever word was answered", () => {
  // the graphic comes up at 8.9 s, just before "สาม" at 9.0 s
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ word: 1, graphic: 1, seconds: 3.2 })] }
  expect(acceptSoundPlan(reply, CLIP).sounds).toEqual([{ word: 2, graphic: 0, seconds: 3.2, role: "เสียงระฆังใสตอนคำถาม", point: 0, from: "light", loudness: "normal" }])
  // a graphic that starts on a word takes that word
  const onTheWord: SoundClip = { ...CLIP, graphics: [{ ...CLIP.graphics[0]!, atUs: 10_260_000 }] }
  expect(acceptSoundPlan(reply, onTheWord).sounds.map((kept) => kept.word)).toEqual([3])
})

test("a word said up to a millisecond before the graphic counts as said with it, for rounding", () => {
  const at = (atUs: number): SoundClip => ({ ...CLIP, graphics: [{ ...CLIP.graphics[0]!, atUs }] })
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ graphic: 1 })] }
  // "สาม" is said at 9.0 s
  expect(acceptSoundPlan(reply, at(9_001_000)).sounds.map((kept) => kept.word)).toEqual([2])
  expect(acceptSoundPlan(reply, at(9_001_001)).sounds.map((kept) => kept.word)).toEqual([3])
})

test("a sound on a graphic that comes up after the last word is dropped", () => {
  const late: SoundClip = { ...CLIP, graphics: [{ ...CLIP.graphics[0]!, atUs: 11_300_000 }] }
  expect(acceptSoundPlan({ palette: PALETTE, sounds: [sound({ graphic: 1 })] }, late)).toEqual({ palette: PALETTE, sounds: [], dropped: 1 })
})

test("the length is held to its limits", () => {
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ word: 1, seconds: 0.05 }), sound({ word: 2, seconds: 9 }), sound({ word: 3, seconds: 0.2 })] }
  expect(acceptSoundPlan(reply, CLIP).sounds.map((kept) => kept.seconds)).toEqual([SOUND_SECONDS_MIN, SOUND_SECONDS_MAX, 0.2])
})

test("the role is made one line and cut by whole letters, and a sound with no role is dropped", () => {
  // cut by code units, the last letter would lose its tone mark
  const long = "a" + "ก้".repeat(SOUND_ROLE_MAX)
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ word: 1, role: "  เสียงระฆัง\n ตอนคำถาม  " }), sound({ word: 2, role: long }), sound({ word: 3, role: " \n " })] }
  const { sounds, dropped } = acceptSoundPlan(reply, CLIP)
  expect(sounds.map((kept) => kept.role)).toEqual(["เสียงระฆัง ตอนคำถาม", "a" + "ก้".repeat(SOUND_ROLE_MAX / 2 - 1)])
  expect(dropped).toBe(1)
})

test("a point out of range becomes none, and the sound stays", () => {
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ word: 1, point: 0 }), sound({ word: 2, point: 3 }), sound({ word: 3, point: null })] }
  expect(acceptSoundPlan(reply, CLIP)).toMatchObject({ sounds: [{ point: null }, { point: null }, { point: null }], dropped: 0 })
})

test("a second sound on the same word is dropped, whether either scores a graphic or not; the first stays", () => {
  const reply: SoundPlanReply = {
    palette: PALETTE,
    sounds: [
      sound({ word: 3, role: "แรก" }),
      sound({ word: 3, role: "ซ้ำ" }),
      // the graphic comes up at 8.9 s, so its sound starts on word 3 as well, and would share the first one's anchor
      sound({ word: 1, graphic: 1, role: "กราฟิก" }),
      sound({ word: 4, role: "คำถัดไป" }),
    ],
  }
  const { sounds, dropped } = acceptSoundPlan(reply, CLIP)
  expect(sounds.map((kept) => [kept.word, kept.graphic, kept.role])).toEqual([
    [2, null, "แรก"],
    [3, null, "คำถัดไป"],
  ])
  expect(dropped).toBe(2)
})

test("a graphic that comes up on a word takes that word, and a sound on the word alone after it is the second", () => {
  const onTheWord: SoundClip = { ...CLIP, graphics: [{ ...CLIP.graphics[0]!, atUs: CLIP.words[2]!.atUs }] }
  const reply: SoundPlanReply = { palette: PALETTE, sounds: [sound({ word: 1, graphic: 1, role: "กราฟิก" }), sound({ word: 3, role: "คำ" })] }
  const { sounds, dropped } = acceptSoundPlan(reply, onTheWord)
  expect(sounds.map((kept) => [kept.word, kept.graphic, kept.role])).toEqual([[2, 0, "กราฟิก"]])
  expect(dropped).toBe(1)
})

test("the palette is trimmed and cut to 2,000 characters, and a reply with none fails", () => {
  expect(acceptSoundPlan({ palette: `  ${PALETTE}\n`, sounds: [] }, CLIP).palette).toBe(PALETTE)
  expect(acceptSoundPlan({ palette: "a".repeat(2_000), sounds: [] }, CLIP).palette).toBe("a".repeat(2_000))
  // a first line longer than the cap has no whole line to keep, and is cut by whole letters
  expect(acceptSoundPlan({ palette: "a".repeat(2_100), sounds: [] }, CLIP).palette).toBe("a".repeat(2_000))
  expect(() => acceptSoundPlan({ palette: " \n ", sounds: [sound()] }, CLIP)).toThrow("the sound plan has no palette")
})

test("a palette past the cap is cut at the last whole line that fits", () => {
  // eight lines of 300: six with their breaks are 1,805 characters, a seventh would make 2,106
  const lines = Array.from({ length: 8 }, (_, i) => String(i + 1).repeat(300))
  expect(acceptSoundPlan({ palette: lines.join("\n"), sounds: [] }, CLIP).palette).toBe(lines.slice(0, 6).join("\n"))
  // a line that ends in spaces does not leave them at the end
  expect(acceptSoundPlan({ palette: `${"a".repeat(1_000)}  \n${"b".repeat(1_500)}`, sounds: [] }, CLIP).palette).toBe("a".repeat(1_000))
})

// the call

test("a clip with no words makes no call", async () => {
  const { transport, calls } = fakeTransport({ palette: PALETTE, sounds: [sound()] })
  expect(await planComposedSounds({ transport, model: "m", clip: { ...CLIP, words: [] } })).toEqual({ palette: "", sounds: [], dropped: 0 })
  expect(calls).toHaveLength(0)
})

test("one call carries the prompt, the clip and the schema, and its answer comes back read", async () => {
  const { transport, calls } = fakeTransport({ palette: PALETTE, sounds: [sound({ word: 3, point: 2 }), sound({ word: 9 })] })
  const signal = new AbortController().signal
  expect(await planComposedSounds({ transport, model: "claude-opus-5-5", clip: CLIP, signal })).toEqual({
    palette: PALETTE,
    sounds: [{ word: 2, graphic: null, seconds: 1.5, role: "เสียงระฆังใสตอนคำถาม", point: 1, from: "light", loudness: "normal" }],
    dropped: 1,
  })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({
    model: "claude-opus-5-5",
    system: SOUND_PLAN_PROMPT,
    content: [{ type: "text", text: describeSoundClip(CLIP) }],
    schema: SoundPlanSchema,
    maxTokens: 16_000,
    signal,
  })
})
