import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { TEXT_REPLY } from "../llm/text-reply.ts"
import type { LlmRequest, LlmTransport } from "../llm/types.ts"
import { lintCompose } from "./lint.ts"
import { codeOf, composeSound, SOUND_CONTRACT, SOUND_WRITE_PROMPT_VERSION, soundBrief, soundEditBrief, soundRepairBrief, type SoundToWrite } from "./write.ts"

const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** A function one of the spike's real calls wrote: the countdown of draft 0917. */
const COUNTDOWN_CODE = readFileSync(new URL("../../../../docs/plans/2026-10-01-sound-spike/out/v1-countdown.js", import.meta.url), "utf8").trim()

// the contract

test("the contract is the plan's, line for line, and goes by its version", () => {
  expect(SOUND_WRITE_PROMPT_VERSION).toBe("sound-write-2026-10-01")
  expect(SOUND_CONTRACT.split("\n")).toEqual([
    "You are the sound designer of a short vertical video (TikTok, Reels). For one moment of it you compose a short musical sound effect, the way a composer scores a stinger for a cartoon or a game show, and you write it as JavaScript that builds the sound with the Web Audio API. The app renders your code offline and lays the sound under the video at that moment.",
    "",
    "Write exactly one function and nothing else: no code fence, no comments outside it, no explanation.",
    "",
    "function compose(ctx, cue, kit) { ... }",
    "",
    "What you are given:",
    "- ctx is an OfflineAudioContext: 2 channels, 48000 Hz, cue.length seconds long. Build every node on it and connect what should be heard to ctx.destination. Schedule everything at absolute times in seconds from 0. Do not call startRendering; the app does.",
    "- cue.length: the seconds the sound lasts, its tail included.",
    "- cue.words: [{ text, atS }]: when each spoken word starts, in seconds from 0.",
    "- kit.rand(): a seeded random number in [0, 1) (Math.random is the same generator).",
    "- kit.noise(seconds): a mono AudioBuffer of white noise.",
    "- kit.reverb(seconds, decay): a ConvolverNode with a generated room tail; decay 1 to 8, larger dies faster.",
    '- kit.note(name): the frequency in Hz of a note such as "C4", "F#5", "Bb3".',
    "",
    "Rules:",
    "- Any Web Audio node and any AudioParam automation, on ctx. AudioBufferSourceNode only on buffers you make (kit.noise, or ctx.createBuffer filled by your code). No network, no files, no page or browser objects, no timers, no promises, no other audio context: the function returns when everything is scheduled.",
    "- Start and end every voice cleanly: ramp gains up from near 0 and back down (exponential ramps go to 0.0001, never 0), stop sources after their envelope ends. The first and the last 5 ms must be near silent. No clicks.",
    "- Keep the peak under about 0.8; the app sets the loudness afterwards from the loudness you are given (soft, normal, strong), so shape the sound's character for it rather than its level.",
    "- A person is speaking. Keep the sound out of the voice's way: while a word is spoken, keep 300 to 3000 Hz light or make the sound short and percussive; let it bloom in the gaps.",
    "- It is a sound effect, not a song: hits, stingers, short motifs, risers, sweeps, whooshes, chimes, plucks, mallets, drum and percussion hits, made musical by pitch, rhythm and harmony. Make each voice rich: layer detuned oscillators, shape with filters and envelopes, add a little reverb or a short delay, use noise for air and attack. It should sound designed and polished, not like a bare test tone.",
    "- Follow the palette of the clip (key, instruments, character, motif) so every sound of the clip sounds like one score.",
    "- Land each hit exactly on the time it belongs to: a hit on a word at that word's atS; a hit on something in the picture at the time that thing happens.",
  ])
})

test("the function the contract asks for is the one the linter reads", () => {
  // the head it writes out, with an empty body, is the shape the linter takes
  expect(lintCompose("function compose(ctx, cue, kit) { }")).toEqual([])
  expect(SOUND_CONTRACT).toContain("\nfunction compose(ctx, cue, kit) { ... }\n")
})

// the briefs

const PALETTE = "Key: C major, bright and playful.\nInstruments: marimba-like mallets, bright square-wave plucks, a soft synth kick.\nMotif: G4-C5-E5-G5."
const ABOUT = "ขึ้นอวกาศใน 3 2 1: ชายหนุ่มถามว่านักบินอวกาศขึ้นไปยังไง แล้วนับถอยหลังพาตัวเองขึ้นไป"
const COUNTDOWN: SoundToWrite = {
  palette: PALETTE,
  about: ABOUT,
  role: "นับถอยหลังด้วยเสียงไม้เคาะตรงคำว่า สาม สอง หนึ่ง แล้วพุ่งขึ้นหลังคำสุดท้าย",
  seconds: 2.8,
  words: [
    { text: "สาม", atS: 0 },
    { text: "สอง", atS: 1.26 },
    { text: "หนึ่ง", atS: 2.22 },
  ],
  loudness: "normal",
}
/** The countdown's brief, as the writing call is given it. */
const COUNTDOWN_BRIEF = `The clip: ${ABOUT}

The palette of the clip:
Key: C major, bright and playful.
Instruments: marimba-like mallets, bright square-wave plucks, a soft synth kick.
Motif: G4-C5-E5-G5.

This sound: นับถอยหลังด้วยเสียงไม้เคาะตรงคำว่า สาม สอง หนึ่ง แล้วพุ่งขึ้นหลังคำสุดท้าย
It lasts 2.8 s, its tail included.
Loudness: normal.
Words: สาม at 0 s, สอง at 1.26 s, หนึ่ง at 2.22 s.`

test("a sound's brief is the clip, its palette, what the sound does, its length with its tail, its loudness and the words with their times, line by line", () => {
  expect(soundBrief(COUNTDOWN)).toBe(COUNTDOWN_BRIEF)
})

test("with no words spoken in it the brief says so, and the numbers are written as they are", () => {
  const lines = soundBrief({ ...COUNTDOWN, words: [], seconds: 0.6, loudness: "soft", role: "ตึ๊ง" }).split("\n")
  expect(lines.slice(-4)).toEqual(["This sound: ตึ๊ง", "It lasts 0.6 s, its tail included.", "Loudness: soft.", "Words: none."])
  // one word has no separator
  expect(soundBrief({ ...COUNTDOWN, words: [{ text: "อวกาศ", atS: 0.24 }], loudness: "strong" }).split("\n").slice(-2)).toEqual(["Loudness: strong.", "Words: อวกาศ at 0.24 s."])
})

test("a sound that scores a graphic has the graphic's idea and its fragment after the words, for its hits to land on what is seen", () => {
  const html = `<style>.n{animation:pop .3s both}@keyframes pop{from{transform:scale(0)}}</style>\n<div class="n">3</div>`
  const brief = soundBrief({ ...COUNTDOWN, graphic: { idea: "ตัวเลข 3 2 1 เด้งขึ้นทีละตัว", html } })
  expect(brief).toBe(
    `${COUNTDOWN_BRIEF}

It scores this graphic, shown at the same time: ตัวเลข 3 2 1 เด้งขึ้นทีละตัว. Its HTML fragment follows; its CSS animations and Web Animations give the times things happen in the picture; land your hits on what is seen:

${html}`,
  )
})

test("a repair's brief is the first brief as it was, then the problems one to a line, then what to do about them, then the function", () => {
  const problems = ["the sound starts with a click: the first 5 ms reach 0.31", "the sound ends with a click: the last 5 ms reach 0.2"]
  expect(soundRepairBrief({ brief: COUNTDOWN_BRIEF, code: COUNTDOWN_CODE, problems })).toBe(
    `${COUNTDOWN_BRIEF}

You wrote the function below for this brief. It was rendered, and it has these problems:
- the sound starts with a click: the first 5 ms reach 0.31
- the sound ends with a click: the last 5 ms reach 0.2

Put right every problem and change nothing else. Return the whole corrected function, with no code fence and no explanation.

${COUNTDOWN_CODE}`,
  )
  // the linter's problems are given the same way, and one problem is one line
  expect(soundRepairBrief({ brief: "The clip: x", code: "function compose(ctx, cue, kit) { fetch(1) }", problems: lintCompose("function compose(ctx, cue, kit) { fetch(1) }") }).split("\n")).toEqual([
    "The clip: x",
    "",
    "You wrote the function below for this brief. It was rendered, and it has these problems:",
    `- ${lintCompose("function compose(ctx, cue, kit) { fetch(1) }")[0]}`,
    "",
    "Put right every problem and change nothing else. Return the whole corrected function, with no code fence and no explanation.",
    "",
    "function compose(ctx, cue, kit) { fetch(1) }",
  ])
})

/** What an edit tells Claude to do with the user's change, word for word. */
const EDIT_ASK =
  "Make that change and keep everything else as it is, unless the brief above has changed (the length, the words and their times, the graphic): then fit the sound to the brief as it is now. Return the whole function, with no code fence and no explanation."

test("an edit's brief is the brief as it is now, then the user's change in double quotes on a line of its own, then what to do with it, then the function", () => {
  expect(soundEditBrief({ brief: COUNTDOWN_BRIEF, code: COUNTDOWN_CODE, instruction: "เบาลง" })).toBe(
    `${COUNTDOWN_BRIEF}

You wrote the function below for this brief. The user asks for this change:
"เบาลง"

${EDIT_ASK}

${COUNTDOWN_CODE}`,
  )
})

test("the user's change is one line: trimmed, every run of white space made one space, and a double quote inside it kept as it is", () => {
  const lines = soundEditBrief({ brief: "The clip: x", code: "function compose(ctx, cue, kit) { }", instruction: '  ให้เสียง\n\tสั้นลง   แล้ว "ตึง"  กว่านี้ \r\n' }).split("\n")
  expect(lines).toEqual([
    "The clip: x",
    "",
    "You wrote the function below for this brief. The user asks for this change:",
    '"ให้เสียง สั้นลง แล้ว "ตึง" กว่านี้"',
    "",
    EDIT_ASK,
    "",
    "function compose(ctx, cue, kit) { }",
  ])
})

// the answer

test("a code fence around the answer is taken off, with or without a language on it, and so is a remark after it and the white space around it", () => {
  expect(codeOf(`\`\`\`js\n${COUNTDOWN_CODE}\n\`\`\``)).toBe(COUNTDOWN_CODE)
  expect(codeOf(`\`\`\`javascript\n${COUNTDOWN_CODE}\n\`\`\`\n`)).toBe(COUNTDOWN_CODE)
  expect(codeOf(`\n  \`\`\`\n${COUNTDOWN_CODE}\n\`\`\`  \n`)).toBe(COUNTDOWN_CODE)
  expect(codeOf(`\`\`\`js\n${COUNTDOWN_CODE}\n\`\`\`\nThe kick lands on each count.`)).toBe(COUNTDOWN_CODE)
  // a fence opened and never closed still comes off
  expect(codeOf(`\`\`\`js\n${COUNTDOWN_CODE}`)).toBe(COUNTDOWN_CODE)
  expect(lintCompose(codeOf(`\`\`\`js\n${COUNTDOWN_CODE}\n\`\`\``))).toEqual([])
})

test("an answer with no fence is left as it was written, but for the white space around it; words before a fence stay for the linter to refuse", () => {
  expect(codeOf(COUNTDOWN_CODE)).toBe(COUNTDOWN_CODE)
  expect(codeOf(`\n\n${COUNTDOWN_CODE}\n  `)).toBe(COUNTDOWN_CODE)
  expect(codeOf("")).toBe("")
  const chatty = `Here is the sound:\n\`\`\`js\n${COUNTDOWN_CODE}\n\`\`\``
  expect(codeOf(chatty)).toBe(chatty)
  expect(lintCompose(codeOf(chatty)).join("\n")).toContain("starts with `Here is the sound:")
})

// the call

/** A transport that records every request and answers with a fixed text. */
function fakeTransport(output: string) {
  const calls: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate(request) {
      calls.push(request)
      return { output: output as never, usage: USAGE }
    },
  }
  return { transport, calls }
}

test("a sound is composed by one call: the contract as the system prompt, the brief as the request, plain text asked for, 12,000 tokens at most, and the stop signal", async () => {
  const { transport, calls } = fakeTransport(`\`\`\`js\n${COUNTDOWN_CODE}\n\`\`\`\n`)
  const stop = new AbortController()
  const code = await composeSound({ transport, model: "claude-opus-5-5", brief: COUNTDOWN_BRIEF, signal: stop.signal })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.model).toBe("claude-opus-5-5")
  expect(calls[0]!.system).toBe(SOUND_CONTRACT)
  expect(calls[0]!.content).toEqual([{ type: "text", text: COUNTDOWN_BRIEF }])
  // the very schema a transport takes for plain text: no JSON is asked for
  expect(calls[0]!.schema).toBe(TEXT_REPLY)
  expect(calls[0]!.maxTokens).toBe(12_000)
  expect(calls[0]!.signal).toBe(stop.signal)
  // the answer is the function, with the fence Claude was told not to put around it taken off
  expect(code).toBe(COUNTDOWN_CODE)
})

test("a repair is composed by the same call, given the repair's brief; with no signal none is passed", async () => {
  const { transport, calls } = fakeTransport(COUNTDOWN_CODE)
  const brief = soundRepairBrief({ brief: COUNTDOWN_BRIEF, code: COUNTDOWN_CODE, problems: ["the sound runs past its length"] })
  expect(await composeSound({ transport, model: "m", brief })).toBe(COUNTDOWN_CODE)
  expect(calls[0]!.content).toEqual([{ type: "text", text: brief }])
  expect(calls[0]!.system).toBe(SOUND_CONTRACT)
  expect(calls[0]!.signal).toBeUndefined()
})

test("the call does not check what Claude wrote: code the linter refuses comes back as it is, and a call that fails, fails", async () => {
  const refused = "function compose(ctx, cue, kit) { setTimeout(() => {}, 100) }"
  const { transport } = fakeTransport(refused)
  expect(await composeSound({ transport, model: "m", brief: "The clip: x" })).toBe(refused)
  expect(lintCompose(refused).length).toBeGreaterThan(0)
  const broken: LlmTransport = { id: "claude-cli", generate: async () => Promise.reject(new Error("Claude Code failed: Not logged in")) }
  await expect(composeSound({ transport: broken, model: "m", brief: "The clip: x" })).rejects.toThrow("Claude Code failed: Not logged in")
})

test("the package exports the module by the path the app imports it by", async () => {
  const exported = await import("@boxblack/core/sound/write")
  expect(exported.composeSound).toBe(composeSound)
  expect(exported.SOUND_CONTRACT).toBe(SOUND_CONTRACT)
  expect(exported.soundBrief).toBe(soundBrief)
  expect(exported.soundRepairBrief).toBe(soundRepairBrief)
  expect(exported.soundEditBrief).toBe(soundEditBrief)
  expect(exported.codeOf).toBe(codeOf)
})
