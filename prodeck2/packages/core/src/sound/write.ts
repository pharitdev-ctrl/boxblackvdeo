import { fragmentOf } from "../graphics/motion/write.ts"
import type { MotionWord } from "../graphics/plan.ts"
import { TEXT_REPLY } from "../llm/text-reply.ts"
import type { LlmTransport } from "../llm/types.ts"
import type { SoundLoudness } from "./spec.ts"

export const SOUND_WRITE_PROMPT_VERSION = "sound-write-2026-10-01"

/**
 * What Claude composes a sound effect by, as the system prompt of the composing call: the one function it writes,
 * what it is given (the offline context, the cue and the kit the harness makes), what it may use, and how the sound
 * should be made. It is in English, as the code it asks for is. The linter (lint.ts) holds the function to its shape
 * and refuses the network, the page and the browser, timers, promises and other audio contexts, as the first rule
 * says; the render check (harness.ts) finds a sound that is silent, runs away or clicks.
 */
export const SOUND_CONTRACT = `You are the sound designer of a short vertical video (TikTok, Reels). For one moment of it you compose a short musical sound effect, the way a composer scores a stinger for a cartoon or a game show, and you write it as JavaScript that builds the sound with the Web Audio API. The app renders your code offline and lays the sound under the video at that moment.

Write exactly one function and nothing else: no code fence, no comments outside it, no explanation.

function compose(ctx, cue, kit) { ... }

What you are given:
- ctx is an OfflineAudioContext: 2 channels, 48000 Hz, cue.length seconds long. Build every node on it and connect what should be heard to ctx.destination. Schedule everything at absolute times in seconds from 0. Do not call startRendering; the app does.
- cue.length: the seconds the sound lasts, its tail included.
- cue.words: [{ text, atS }]: when each spoken word starts, in seconds from 0.
- kit.rand(): a seeded random number in [0, 1) (Math.random is the same generator).
- kit.noise(seconds): a mono AudioBuffer of white noise.
- kit.reverb(seconds, decay): a ConvolverNode with a generated room tail; decay 1 to 8, larger dies faster.
- kit.note(name): the frequency in Hz of a note such as "C4", "F#5", "Bb3".

Rules:
- Any Web Audio node and any AudioParam automation, on ctx. AudioBufferSourceNode only on buffers you make (kit.noise, or ctx.createBuffer filled by your code). No network, no files, no page or browser objects, no timers, no promises, no other audio context: the function returns when everything is scheduled.
- Start and end every voice cleanly: ramp gains up from near 0 and back down (exponential ramps go to 0.0001, never 0), stop sources after their envelope ends. The first and the last 5 ms must be near silent. No clicks.
- Keep the peak under about 0.8; the app sets the loudness afterwards from the loudness you are given (soft, normal, strong), so shape the sound's character for it rather than its level.
- A person is speaking. Keep the sound out of the voice's way: while a word is spoken, keep 300 to 3000 Hz light or make the sound short and percussive; let it bloom in the gaps.
- It is a sound effect, not a song: hits, stingers, short motifs, risers, sweeps, whooshes, chimes, plucks, mallets, drum and percussion hits, made musical by pitch, rhythm and harmony. Make each voice rich: layer detuned oscillators, shape with filters and envelopes, add a little reverb or a short delay, use noise for air and attack. It should sound designed and polished, not like a bare test tone.
- Follow the palette of the clip (key, instruments, character, motif) so every sound of the clip sounds like one score.
- Land each hit exactly on the time it belongs to: a hit on a word at that word's atS; a hit on something in the picture at the time that thing happens.`

/** One sound to compose: the clip's palette and what the clip is about, what the sound does, how long it lasts, the words spoken in it, how loud it is meant to be, and the graphic it scores, when it scores one. */
export interface SoundToWrite {
  palette: string
  about: string
  role: string
  seconds: number
  words: MotionWord[]
  loudness: SoundLoudness
  graphic?: { idea: string; html: string }
}

/**
 * The request of the composing call for one sound, as the spike's calls were given it: the clip, its palette, what
 * this sound does, its length with its tail, its loudness and the words spoken in it with their seconds from its
 * start (or that none are). A sound that scores a graphic has the graphic's idea and its fragment last, since the
 * fragment's animations give the times things happen in the picture.
 */
export function soundBrief(piece: SoundToWrite): string {
  const words = piece.words.length === 0 ? "Words: none." : `Words: ${piece.words.map((word) => `${word.text} at ${word.atS} s`).join(", ")}.`
  const graphic =
    piece.graphic === undefined
      ? []
      : [
          "",
          `It scores this graphic, shown at the same time: ${piece.graphic.idea}. Its HTML fragment follows; its CSS animations and Web Animations give the times things happen in the picture; land your hits on what is seen:`,
          "",
          piece.graphic.html,
        ]
  return [
    `The clip: ${piece.about}`,
    "",
    "The palette of the clip:",
    piece.palette,
    "",
    `This sound: ${piece.role}`,
    `It lasts ${piece.seconds} s, its tail included.`,
    `Loudness: ${piece.loudness}.`,
    words,
    ...graphic,
  ].join("\n")
}

/**
 * The request of the one repair a sound gets, shaped as a graphic's (repairBrief): the first brief as it was, then
 * what is wrong with the function, one problem to a line, then the function. The problems are the linter's or the
 * render check's, in English; "rendered" is near enough for code the linter refused before any render.
 */
export function soundRepairBrief(args: { brief: string; code: string; problems: string[] }): string {
  return [
    args.brief,
    "",
    "You wrote the function below for this brief. It was rendered, and it has these problems:",
    ...args.problems.map((problem) => `- ${problem}`),
    "",
    "Put right every problem and change nothing else. Return the whole corrected function, with no code fence and no explanation.",
    "",
    args.code,
  ].join("\n")
}

/**
 * The request of an edit, shaped as a graphic's (editBrief): the brief for the room the sound has now, then the
 * change the user asks for, on one line in double quotes (its white space made single spaces), then the function to
 * change. A brief that has changed since the function was written (a stale sound's) is one it is fitted to as well.
 */
export function soundEditBrief(args: { brief: string; code: string; instruction: string }): string {
  return [
    args.brief,
    "",
    "You wrote the function below for this brief. The user asks for this change:",
    `"${args.instruction.replace(/\s+/g, " ").trim()}"`,
    "",
    "Make that change and keep everything else as it is, unless the brief above has changed (the length, the words and their times, the graphic): then fit the sound to the brief as it is now. Return the whole function, with no code fence and no explanation.",
    "",
    args.code,
  ].join("\n")
}

/**
 * The function in what Claude answered, read as a graphic's fragment is (fragmentOf): the white space around it
 * taken off, and the code fence Claude may put around it though told not to, with any remark after the fence. An
 * answer that opens with no fence is left as it is, for the linter to refuse what stands before the function.
 */
export function codeOf(reply: string): string {
  return fragmentOf(reply)
}

/**
 * Asks Claude to compose one sound, or to put one right: one call, the contract as its system prompt and the brief
 * (`soundBrief`, `soundEditBrief` for an edit, or `soundRepairBrief` for a repair) as its request, answered in plain
 * text. What comes back is the function as Claude wrote it, not checked: whoever asked lints and renders it, since a
 * refused function goes to a repair.
 */
export async function composeSound(args: { transport: LlmTransport; model: string; brief: string; signal?: AbortSignal }): Promise<string> {
  const reply = await args.transport.generate({
    model: args.model,
    system: SOUND_CONTRACT,
    content: [{ type: "text", text: args.brief }],
    schema: TEXT_REPLY,
    // the longest function of the spike ran to about 6,000 characters, some 2,000 tokens
    maxTokens: 12_000,
    signal: args.signal,
  })
  return codeOf(reply.output)
}
