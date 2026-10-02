import { z } from "zod"
import type { EmphasisType, Importance } from "../emphasis/types.ts"
import { FLAIR_LEVELS, type FlairLevel } from "../flair/catalogue.ts"
import { clock } from "../flair/direct.ts"
import { clipText } from "../graphics/plan.ts"
import type { LlmTransport } from "../llm/types.ts"
import { SOUND_LOUDNESS, SOUND_ROLE_MAX, SOUND_SECONDS_MAX, SOUND_SECONDS_MIN, type SoundLoudness } from "./spec.ts"

/*
 * Work 4 as one planning call (spec §3): Claude is shown the clip as it plays after the rough cut, with everything
 * the other works put on it, and answers the clip's palette and the sounds it should have, each starting on a spoken
 * word or with a graphic. Each sound is composed afterwards by a call of its own (write.ts).
 */

export const SOUND_PLAN_PROMPT_VERSION = "sound-plan-2026-10-02-moves"

/**
 * What Claude plans the clip's sounds by, as the system prompt of the planning call: what it is shown, the palette
 * and the list it answers, and how to choose. It is in English, as the composing contract is; only each sound's role
 * is asked for in Thai, since the user reads it in the sound's row.
 */
export const SOUND_PLAN_PROMPT = `You are the sound designer of a short vertical video. You decide where it gets a sound effect and what each one does, and you set the clip's sound palette so all of them sound like one score. Another call then composes each sound as code from what you write here.

You are given the clip as it plays after the rough cut: every spoken word with its number and its time, the beats, the emphasis points with their importance, the highlight text lines, the graphics with their idea, and the HTML that draws them when it is drawn already, the camera moves, the cutaways, and the level of decoration the user chose.

Answer with:
- palette: at most eight short lines in English: the key; the tempo feel; the instruments, as synthesised sounds a Web Audio programmer can build (for example bright square-wave plucks, soft sine bells, marimba-like mallets, filtered noise whooshes, a punchy synth kick, brass-like sawtooth stabs); the character; one short recurring motif as note names; what to avoid.
- sounds, in time order. For each:
  - word: the number of the spoken word it starts on;
  - graphic: the number of the graphic it scores, or null; a sound that scores a graphic starts with it;
  - seconds: how long it lasts with its tail, 0.2 to 6;
  - role: one sentence in Thai saying what it does, concrete enough to compose from: what it sounds like, and which words or moments in the picture it hits;
  - point: the number of the emphasis point it serves, or null;
  - from: the lowest level it plays at: "light", "medium" or "heavy";
  - loudness: "soft", "normal" or "strong".

How to choose:
- Score the clip, not every word. A sound earns its place when it makes a moment land: a reveal, a punchline, a turn, a count, a list, a question, something appearing or moving on screen, a change of beat that needs a lift. Silence is part of the score.
- light is only the moments that matter most; medium adds the clear supporting ones; heavy scores the clip richly. Give every sound the lowest level it should play at, so one answer serves all three levels. Plan for the level the user chose at least as fully as the level asks.
- A graphic whose motion has hits (things appearing, counting, landing) gets a sound that follows its motion.
- Two sounds overlap only when they are meant to be heard together.
- Use the palette everywhere, and bring the motif back at the moments that tie the clip together, such as the question and its answer, or the start and the end.`

/**
 * The clip as the planning call is shown it, every time on the rough cut. The lists are in the order they play, and
 * an answer's numbers count from 1 in them.
 */
export interface SoundClip {
  /** what the clip is about, in a line */
  about: string
  /** the level of decoration the user chose */
  level: FlairLevel
  /** every word spoken, with when it starts */
  words: { text: string; atUs: number }[]
  beats: { name: string; startUs: number }[]
  /** the emphasis points, each with what it stresses */
  points: { importance: Importance; type: EmphasisType; what: string; atUs: number }[]
  /** the highlight text lines, each with when it comes up */
  lines: { text: string; atUs: number }[]
  /** the motion graphics, each with its idea, its fragment (null for one planned and not written yet), when it comes up and how long it stays */
  graphics: { idea: string; html: string | null; atUs: number; seconds: number }[]
  /** the moves of the picture, each with when it starts, how long it runs and what it does in a line; a punch of before 0.8.0 is one, said "zoom punch" */
  moves: { atUs: number; seconds: number; about: string }[]
  /** the cutaways, each with what it shows */
  inserts: { what: string; atUs: number }[]
}

/** One sound of the plan, its numbers checked and made indexes from 0 into the clip's lists. */
export interface PlannedSound {
  /** the word it starts on; for a sound that scores a graphic, the graphic's first word */
  word: number
  /** the graphic it scores, or null */
  graphic: number | null
  /** its length with its tail, SOUND_SECONDS_MIN..MAX */
  seconds: number
  /** what it does, in Thai, on one line */
  role: string
  /** the emphasis point it serves, or null */
  point: number | null
  /** the lowest level it plays at */
  from: FlairLevel
  loudness: SoundLoudness
}

export const SoundPlanSchema = z.object({
  palette: z.string(),
  sounds: z.array(
    z.object({
      /** the word's number in the list Claude was shown, from 1, as every number of the reply */
      word: z.number().int(),
      graphic: z.number().int().nullable(),
      seconds: z.number(),
      role: z.string(),
      point: z.number().int().nullable(),
      from: z.enum(FLAIR_LEVELS),
      loudness: z.enum(SOUND_LOUDNESS),
    }),
  ),
})
export type SoundPlanReply = z.infer<typeof SoundPlanSchema>

/**
 * The most characters the palette keeps. It goes into every composing brief, so a runaway answer is cut here; the
 * spike's palette ran to 1,093 characters in seven lines, so eight of that kind fit with room.
 */
const PALETTE_MAX = 2_000

/**
 * The palette as it is stored: trimmed, and when it is longer than PALETTE_MAX, cut after the last whole line that
 * fits, since each line says one thing (the key, the instruments, the motif, what to avoid) and half of one misleads.
 * A first line longer than the cap has no whole line to keep, and is cut by whole letters instead. Spaces the cut
 * leaves at the end go too.
 */
function keptPalette(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= PALETTE_MAX) return trimmed
  let kept = ""
  for (const line of trimmed.split("\n")) {
    const longer = kept === "" ? line : `${kept}\n${line}`
    if (longer.length > PALETTE_MAX) break
    kept = longer
  }
  return (kept === "" ? clipText(trimmed, PALETTE_MAX) : kept).trimEnd()
}

/**
 * The most characters of graphics' HTML one request carries, all graphics together: a clip of many graphics would
 * otherwise make a request past what a call takes. The fragments of 0.5.0 run to a few thousand characters each.
 */
const FRAGMENTS_MAX = 80_000

/**
 * The request text of the planning call: the clip, the level, then every list under its heading, one line to an item
 * with its time on the rough cut as every planning request prints one (`clock`). Words, points and graphics are
 * numbered from 1, as the answer names them; a graphic's fragment follows its line between `<fragment>` lines, and one
 * not written yet (the sounds are planned while the graphics are being written) says so instead. The fragments share
 * FRAGMENTS_MAX: from the first that does not fit, a graphic has its line and a note that its HTML is
 * left out, so the request stays bounded and the graphics keep their numbers. A list with nothing in it says so on
 * its heading's line.
 */
export function describeSoundClip(clip: SoundClip): string {
  let budget = FRAGMENTS_MAX
  const fragment = (html: string | null): string[] => {
    if (html === null) return ["(not drawn yet)"]
    if (html.length > budget) {
      budget = -1
      return ["(its HTML is left out: the request is full)"]
    }
    budget -= html.length
    return ["<fragment>", html, "</fragment>"]
  }
  const list = <T>(heading: string, items: T[], line: (item: T, i: number) => string[]) => (items.length === 0 ? [`${heading} none`] : [heading, ...items.flatMap(line)])
  return [
    `The clip: ${clip.about}`,
    `Level: ${clip.level}`,
    ...list("Words:", clip.words, (word, i) => [`${i + 1}. ${clock(word.atUs)} ${word.text}`]),
    ...list("Beats:", clip.beats, (beat) => [`- ${clock(beat.startUs)} ${beat.name}`]),
    ...list("Emphasis points:", clip.points, (point, i) => [`${i + 1}. ${clock(point.atUs)} [${point.importance} ${point.type}] ${point.what}`]),
    ...list("Highlight text lines:", clip.lines, (line) => [`- ${clock(line.atUs)} ${line.text}`]),
    ...list("Graphics:", clip.graphics, (graphic, i) => [`${i + 1}. ${clock(graphic.atUs)}, ${graphic.seconds} s: ${graphic.idea}`, ...fragment(graphic.html)]),
    ...list("Camera moves:", clip.moves, (move) => [`- ${clock(move.atUs)} ${move.seconds} s: ${move.about}`]),
    ...list("Cutaways:", clip.inserts, (insert) => [`- ${clock(insert.atUs)} ${insert.what}`]),
  ].join("\n")
}

/** How much earlier than a graphic a word may be said and still be its first word: a millisecond, for rounding. */
const ROUNDING_US = 1_000

/**
 * Turns Claude's reply into the plan, its numbers from 1 made indexes from 0. A sound that scores a graphic starts
 * with it, on the first word said at or after the graphic comes up (a word a millisecond early counts, for rounding),
 * and the word answered for it is not read. A sound is dropped, and counted, when its graphic names nothing in the
 * clip, or, with no graphic, its word names nothing; when no word is said from its graphic on; when its role is
 * empty; or when an earlier sound starts on the same word. A sound is known by the place it starts at, and a graphic
 * starts at a word's place, so one word takes one sound, with a graphic or without: the first is kept. The length is
 * held to SOUND_SECONDS_MIN..MAX. The role is made one line and cut to SOUND_ROLE_MAX by whole letters, since it is
 * one line of the composing brief and the text of the sound's row. A point that names nothing becomes null and the
 * sound stays. The palette is trimmed and cut to 2,000 characters at a whole line (`keptPalette`); a reply with no
 * palette fails, since every sound is composed from it.
 */
export function acceptSoundPlan(reply: SoundPlanReply, clip: SoundClip): { palette: string; sounds: PlannedSound[]; dropped: number } {
  const palette = keptPalette(reply.palette ?? "")
  if (palette === "") throw new Error("the sound plan has no palette")
  const sounds: PlannedSound[] = []
  /** the word each sound kept so far starts on */
  const taken = new Set<number>()
  let dropped = 0
  // a stand-in for Claude in a test may answer with no list at all
  for (const answer of reply.sounds ?? []) {
    const graphic = answer.graphic === null ? null : answer.graphic - 1
    const shown = graphic === null ? undefined : clip.graphics[graphic]
    const word = shown === undefined ? answer.word - 1 : clip.words.findIndex((spoken) => spoken.atUs >= shown.atUs - ROUNDING_US)
    const role = clipText(answer.role.replace(/\s+/g, " ").trim(), SOUND_ROLE_MAX).trimEnd()
    if ((graphic !== null && shown === undefined) || clip.words[word] === undefined || !role || taken.has(word)) {
      dropped++
      continue
    }
    taken.add(word)
    const point = answer.point !== null && clip.points[answer.point - 1] !== undefined ? answer.point - 1 : null
    const seconds = Math.min(SOUND_SECONDS_MAX, Math.max(SOUND_SECONDS_MIN, answer.seconds))
    sounds.push({ word, graphic, seconds, role, point, from: answer.from, loudness: answer.loudness })
  }
  return { palette, sounds, dropped }
}

/** Asks Claude for the clip's palette and its sounds; no call when the clip has no word to start a sound on. */
export async function planComposedSounds(args: { transport: LlmTransport; model: string; clip: SoundClip; signal?: AbortSignal }): Promise<{ palette: string; sounds: PlannedSound[]; dropped: number }> {
  if (args.clip.words.length === 0) return { palette: "", sounds: [], dropped: 0 }
  const reply = await args.transport.generate({
    model: args.model,
    system: SOUND_PLAN_PROMPT,
    content: [{ type: "text", text: describeSoundClip(args.clip) }],
    schema: SoundPlanSchema,
    // a long clip at the loudest level may get a sound on most of its moments, each with a sentence of role
    maxTokens: 16_000,
    signal: args.signal,
  })
  return acceptSoundPlan(reply.output, args.clip)
}
