import { expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TranscriptCache, type Transcript } from "@boxblack/core/asr"
import { MediaCache } from "@boxblack/core/cache"
import type { LlmRequest, LlmResponse, LlmTransport } from "@boxblack/core/llm"
import { PLANNER_PROMPT, type Brief, type OutlineReply } from "@boxblack/core/planner"
import type { EmphasisPoint } from "@boxblack/core/emphasis"
import { SOUND_VERSION, type ComposedSound } from "@boxblack/core/sound/spec"
import { PROMPT_VERSION, VISION_PROMPT, VISION_SAMPLING, type VideoInsight, type VisionKey } from "@boxblack/core/vision"
import type { ProjectDetail } from "../shared/api.ts"
import { createPlannerService, OUTLINE_DIRECTION_MAX, OutlineStore, type PlannerDeps } from "./planner.ts"
import { POST_VERSION, withoutKitGraphics, withoutOldEffects } from "./post-cleanup.ts"
import { SecretStore, SettingsStore, type SecretBox } from "./settings.ts"

const box: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain),
  decryptString: (cipher) => cipher.toString(),
}

const transcript = (text: string): Transcript => ({
  engine: "whisper-local",
  model: "large-v3-q5_0",
  language: "th",
  utterances: [
    { text: `${text} หนึ่ง`, startUs: 1_000_000, endUs: 3_000_000 },
    { text: `${text} สอง`, startUs: 4_000_000, endUs: 6_000_000 },
  ],
  words: [],
  audioEvents: [],
})

const insight: VideoInsight = {
  model: "claude-opus-5",
  promptVersion: PROMPT_VERSION,
  frameCount: 2,
  retakes: [],
  signals: { sceneCutsUs: [], black: [], frozen: [], silent: [], blurry: [] },
  summary: "ภาพประกอบ",
  scenes: [{ startUs: 500_000, endUs: 3_500_000, description: "แกลเลอรี", kind: "b-roll", issues: [], keepClear: null }],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}

const firstReply: OutlineReply = {
  title: "เรื่องแรก",
  summary: "สรุป",
  omitted: "",
  direction: "สนุก จังหวะเร็ว",
  beats: [
    { name: "เปิด", purpose: "ดึงความสนใจ", clip: "v1", from: "u2", to: "u2" },
    { name: "ภาพ", purpose: "ประกอบ", clip: "v2", from: "s1", to: "s1" },
    { name: "ปิด", purpose: "สรุป", clip: "v1", from: "u1", to: "u1" },
  ],
}

async function setup(overrides: Partial<PlannerDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-planner-"))
  const videos = [
    { id: "talk", name: "talk.mov", durationUs: 10_000_000 },
    { id: "broll", name: "broll.mp4", durationUs: 5_000_000 },
  ].map((v) => ({ ...v, path: join(dir, v.name), width: 1080, height: 1920, exists: true }))
  for (const video of videos) await writeFile(video.path, video.id)
  const project: ProjectDetail = {
    name: "p",
    folder: "/drafts/p",
    capcutVersion: "9.4.0",
    versionTested: true,
    fps: 30,
    canvas: { width: 1080, height: 1920 },
    timelineSegmentCount: 0,
    videos,
  }

  const settings = new SettingsStore(join(dir, "settings.json"))
  const secrets = new SecretStore(join(dir, "secrets.json"), box)
  await secrets.set("anthropic", "sk-ant")
  const transcripts = new TranscriptCache(join(dir, "transcripts"))
  const insights = new MediaCache<VideoInsight, VisionKey>(join(dir, "insights"))
  await transcripts.put(videos[0]!.path, { engine: "whisper-local", model: "large-v3-q5_0", language: "th" }, transcript("พูด"))
  await insights.put(
    videos[1]!.path,
    { model: "claude-opus-5", promptVersion: PROMPT_VERSION, intervalUs: VISION_SAMPLING.intervalUs, maxFrames: VISION_SAMPLING.maxFrames },
    insight,
  )

  const requests: LlmRequest<unknown>[] = []
  const replies: OutlineReply[] = [firstReply]
  const transport: LlmTransport = {
    id: "anthropic-api",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      const output = replies[Math.min(requests.length - 1, replies.length - 1)]!
      return { output: output as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  const deps: PlannerDeps = {
    settings,
    secrets,
    transcripts,
    insights,
    store: new OutlineStore(join(dir, "outlines")),
    whisperModelId: "large-v3-q5_0",
    tools: { claude: "/bin/claude" },
    inspect: async (folder) => {
      if (folder !== project.folder) throw new Error(`${folder} is not a CapCut project`)
      return project
    },
    transports: { anthropic: () => transport, cli: () => transport },
    ...overrides,
  }
  return { service: createPlannerService(deps), requests, replies, project, deps }
}

const brief: Brief = { targetSeconds: 30, videoType: "review", instructions: "" }

test("plans from the cached transcripts and picture descriptions of the chosen videos", async () => {
  const { service, requests, project } = await setup()
  const stored = await service.plan(project.folder, ["talk", "broll"], brief)
  const footage = (requests[0]!.content[0] as { text: string }).text
  expect(footage).toContain("u2 [4.0–6.0] พูด สอง")
  expect(footage).toContain("s1 [0.5–3.5] b-roll · แกลเลอรี")
  expect(stored.outline.beats.map((b) => [b.name, b.videoId, b.startUs])).toEqual([
    ["เปิด", "talk", 4_000_000],
    ["ภาพ", "broll", 500_000],
    ["ปิด", "talk", 1_000_000],
  ])
  expect(stored).toMatchObject({ folder: project.folder, videoIds: ["talk", "broll"], brief, confirmed: false })
})

test("the outline is saved and comes back for the project", async () => {
  const { service, project, deps } = await setup()
  await service.plan(project.folder, ["talk", "broll"], brief)
  const again = createPlannerService(deps)
  expect((await again.get(project.folder))?.outline.title).toBe("เรื่องแรก")
  expect(await again.get("/drafts/other")).toBeNull()
})

test("planning refuses when none of the chosen videos has been analysed", async () => {
  const { service, project, deps } = await setup()
  await deps.settings.update({ asr: { engine: "scribe" }, llm: { model: "claude-sonnet-5" } })
  await expect(service.plan(project.folder, ["talk", "broll"], brief)).rejects.toThrow(/not analysed/)
})

test("planning refuses when Claude cannot be reached", async () => {
  const { service, project, deps } = await setup()
  await deps.secrets.delete("anthropic")
  await expect(service.plan(project.folder, ["talk"], brief)).rejects.toThrow(/anthropic-key-missing/)
})

test("a fresh take sends the previous outline and replaces it", async () => {
  const { service, project, requests, replies } = await setup()
  await service.plan(project.folder, ["talk", "broll"], brief)
  replies.push({ ...firstReply, title: "เรื่องที่สอง" })
  const stored = await service.regenerate(project.folder)
  expect((requests[1]!.content.at(-1) as { text: string }).text).toContain("ต่างจากฉบับก่อน")
  expect(stored.outline.title).toBe("เรื่องที่สอง")
})

test("a fresh take follows the brief as the user has it now, and that is the brief on record", async () => {
  const { service, project } = await setup()
  await service.plan(project.folder, ["talk", "broll"], brief)
  const longer: Brief = { ...brief, targetSeconds: 180, instructions: "เน้นราคา" }
  expect((await service.regenerate(project.folder, longer)).brief).toEqual(longer)
  expect((await service.get(project.folder))!.brief).toEqual(longer)
})

test("a revision sends the edited outline and the instruction", async () => {
  const { service, project, requests } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  await service.saveEdits(project.folder, [first.outline.beats[2]!.id], false)
  await service.revise(project.folder, "ใส่ภาพประกอบกลับมา")
  const last = (requests[1]!.content.at(-1) as { text: string }).text
  expect(last).toContain("1. v1 u1–u1 · ปิด — สรุป")
  expect(last).not.toContain("ภาพ — ประกอบ")
  expect(last).toContain("ใส่ภาพประกอบกลับมา")
})

test("edits can reorder and remove beats but never add unknown ones", async () => {
  const { service, project } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const [a, b, c] = first.outline.beats.map((beat) => beat.id)
  const edited = await service.saveEdits(project.folder, [c!, a!], false)
  expect(edited.outline.beats.map((beat) => beat.name)).toEqual(["ปิด", "เปิด"])
  await expect(service.saveEdits(project.folder, [b!, "made-up"], false)).rejects.toThrow(/unknown beat/)
})

/** A move of the picture on a word of "talk" in a beat. */
const moveOn = (beatId: string) => ({
  anchor: { kind: "speech" as const, videoId: "talk", sourceUs: 2_000_000, beatId },
  from: "light" as const,
  about: "ดันเข้า",
  poses: [{ s: 0, scale: 1.1, x: 0, y: 0, rot: 0, ease: "line" as const }],
  edited: false,
  off: false,
})

test("a beat taken out of the outline takes the sounds and cutaways on its edges with it", async () => {
  const { service, project, deps } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const [a, b, c] = first.outline.beats.map((beat) => beat.id)
  const edge = (beatId: string) => ({ kind: "beat" as const, beatId, edge: "start" as const })
  const line = { kind: "highlight" as const, groupId: "g", line: 0 }
  await deps.store.put({
    ...first,
    flair: {
      looks: {},
      cues: [{ anchor: edge(a!), effectId: "s1", edited: true }, { anchor: edge(b!), effectId: "s2", edited: false }, { anchor: line, effectId: "s3", edited: true }],
      inserts: [{ anchor: edge(b!), binId: "m", edited: true }],
      zooms: [
        { anchor: { videoId: "talk", sourceUs: 0, beatId: a! }, kind: "punch", edited: true },
        { anchor: { videoId: "talk", sourceUs: 0, beatId: b! }, kind: "drift", edited: false },
        { anchor: { videoId: "talk", sourceUs: 0 }, kind: "punch", edited: true },
      ],
      moves: [moveOn(a!), moveOn(b!)],
    },
  })
  const edited = await service.saveEdits(project.folder, [c!, a!], false)
  expect(edited.flair!.cues!.map((cue) => cue.effectId)).toEqual(["s1", "s3"])
  expect(edited.flair!.inserts).toEqual([])
  // a zoom goes with its beat; one saved before zooms knew their beat stays
  expect(edited.flair!.zooms).toEqual([
    { anchor: { videoId: "talk", sourceUs: 0, beatId: a! }, kind: "punch", edited: true },
    { anchor: { videoId: "talk", sourceUs: 0 }, kind: "punch", edited: true },
  ])
  // and so does a move
  expect(edited.flair!.moves).toEqual([moveOn(a!)])
  expect((await service.get(project.folder))!.flair).toEqual(edited.flair)
})

test("a beat reordered away from the end hands its closing sound to the beat that ends the video now", async () => {
  const { service, project, deps } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const [a, b, c] = first.outline.beats.map((beat) => beat.id)
  const cue = (beatId: string, edge: "start" | "end") => ({ anchor: { kind: "beat" as const, beatId, edge }, effectId: `${beatId}-${edge}`, edited: true })
  await deps.store.put({ ...first, flair: { looks: {}, cues: [cue(c!, "end"), cue(c!, "start"), cue(a!, "end")] } })
  const edited = await service.saveEdits(project.folder, [c!, a!, b!], false)
  // only the closing sound moves; the old last beat's start, and an end that was never closing, stay put
  expect(edited.flair!.cues!.map((entry) => entry.anchor)).toEqual([cue(b!, "end").anchor, cue(c!, "start").anchor, cue(a!, "end").anchor])
})

const pointOn = (id: string, beatId: string): EmphasisPoint => ({ id, anchor: { kind: "speech", videoId: "talk", from: 0, to: 1, beatId }, importance: "key", type: "hook", reason: "", source: "ai", edited: false })

test("a new outline is stamped post version 2, as made by this version, so neither one-time clean-up ever touches it", async () => {
  const { service, project, deps } = await setup()
  const stored = await service.plan(project.folder, ["talk", "broll"], brief)
  expect(stored.postVersion).toBe(2)
  expect(POST_VERSION).toBe(2)
  expect(withoutOldEffects(stored)).toBe(stored)
  expect(withoutKitGraphics(stored)).toBe(stored)
  // and it is stored so
  expect((await deps.store.get(project.folder))!.postVersion).toBe(2)
})

test("a beat taken out takes its emphasis points with it, and what Claude put on them; what the user edited on them stays, bound to no point", async () => {
  const { service, project, deps } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const [a, b, c] = first.outline.beats.map((beat) => beat.id)
  const cue = (sourceUs: number, pointId: string, edited: boolean) => ({ anchor: { kind: "speech" as const, videoId: "talk", sourceUs }, effectId: "s", edited, pointId })
  await deps.store.put({
    ...first,
    emphasis: { points: [pointOn("pa", a!), pointOn("pb", b!)], version: 3, plannedOn: { graphics: 3, sounds: 3 }, transcripts: {} },
    flair: { looks: {}, cues: [cue(1_000_000, "pa", false), cue(2_000_000, "pb", false), cue(3_000_000, "pb", true)] },
  })
  const edited = await service.saveEdits(project.folder, [c!, a!], false)
  expect(edited.emphasis!.points.map((entry) => entry.id)).toEqual(["pa"])
  // nothing is left on the point taken out for works 2 and 4 to redo
  expect(edited.emphasis!.version).toBe(3)
  const { pointId: _gone, ...unbound } = cue(3_000_000, "pb", true)
  expect(edited.flair!.cues).toEqual([cue(1_000_000, "pa", false), unbound])
})

test("a part that grows a beat keeps the emphasis points on it: they follow the new beat", async () => {
  const { service, project, deps } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const [opening, picture] = planned.outline.beats
  await service.saveEdits(project.folder, [opening!.id, picture!.id], true)
  const stored = (await deps.store.get(project.folder))!
  await deps.store.put({ ...stored, emphasis: { points: [pointOn("po", opening!.id), pointOn("pp", picture!.id)], version: 2, plannedOn: { graphics: 2, sounds: null }, transcripts: {} } })
  const next = await service.addPart(project.folder, "talk:u0")
  const grown = next.outline.beats[0]!.id
  expect(grown).not.toBe(opening!.id)
  expect(next.emphasis!.points.map((entry) => [entry.id, entry.anchor.beatId])).toEqual([
    ["po", grown],
    ["pp", picture!.id],
  ])
  expect(next.emphasis!.version).toBe(2)
})

test("a beat taken out takes the highlight text picked in it, with that text's look and sounds", async () => {
  const { service, project, deps } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const [a, b] = first.outline.beats.map((beat) => beat.id)
  const group = (id: string, beatId: string | undefined) => ({ id, source: "ai" as const, edited: false, ...(beatId ? { beatId } : {}), lines: [{ videoId: "talk", from: 0, to: 1, text: id }] })
  await deps.store.put({
    ...first,
    highlights: { style: null, styleByAi: null, beatsKey: null, transcripts: {}, groups: [group("inA", a!), group("inB", b!), group("old", undefined)] },
    flair: { looks: { inB: { pattern: "stack", tone: "base", accent: null, exit: null, edited: true } }, cues: [{ anchor: { kind: "highlight", groupId: "inB", line: 0 }, effectId: "s", edited: true }] },
  })
  const edited = await service.saveEdits(project.folder, [a!], false)
  expect(edited.highlights!.groups.map((entry) => entry.id)).toEqual(["inA", "old"])
  expect(edited.flair!.looks).toEqual({})
  expect(edited.flair!.cues).toEqual([])
})

test("confirming marks the outline confirmed; any change afterwards clears it", async () => {
  const { service, project } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const ids = first.outline.beats.map((beat) => beat.id)
  expect((await service.saveEdits(project.folder, ids, true)).confirmed).toBe(true)
  expect((await service.revise(project.folder, "สั้นลง")).confirmed).toBe(false)
})

test("the Claude Code transport is used when chosen", async () => {
  let usedCli = false
  const { project, deps } = await setup()
  const cliDeps: PlannerDeps = {
    ...deps,
    transports: {
      anthropic: () => {
        throw new Error("wrong transport")
      },
      cli: (binary) => {
        usedCli = binary === "/bin/claude"
        return deps.transports!.cli(binary)
      },
    },
  }
  await deps.settings.update({ llm: { transport: "claude-cli" } })
  await createPlannerService(cliDeps).plan(project.folder, ["talk", "broll"], brief)
  expect(usedCli).toBe(true)
})

test("planning uses the planner prompt from the license server and records its version", async () => {
  const prompts = async () => ({ vision: VISION_PROMPT, planner: { system: "วางโครงเรื่องแบบ server", version: "planner+server-1" } })
  const { service, requests, project } = await setup({ prompts })
  const stored = await service.plan(project.folder, ["talk", "broll"], brief)
  expect(requests[0]!.system).toBe("วางโครงเรื่องแบบ server")
  expect(stored.promptVersion).toBe("planner+server-1")
})

test("picture descriptions made with a different vision prompt are not used for planning", async () => {
  const prompts = async () => ({ vision: { system: "อีกแบบ", version: "vision+server-2" }, planner: PLANNER_PROMPT })
  const { service, requests, project } = await setup({ prompts })
  await service.plan(project.folder, ["talk", "broll"], brief)
  const footage = (requests[0]!.content[0] as { text: string }).text
  expect(footage).toContain("u2 [4.0–6.0] พูด สอง")
  expect(footage).not.toContain("แกลเลอรี")
})

const decisions = { talk: { transcript: "t", keepWords: [1], cutWords: [], keepPauses: [], keepProblems: [], cutPieces: [] } }

test("parts the outline leaves out are listed, and putting one back unconfirms the outline but keeps cut decisions", async () => {
  const { service, project, deps } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const [opening, picture] = planned.outline.beats
  await service.saveEdits(project.folder, [opening!.id, picture!.id], true)
  await deps.store.put({ ...(await deps.store.get(project.folder))!, cutDecisions: decisions })

  expect((await service.unused(project.folder)).map((part) => part.id)).toEqual(["talk:u0"])
  const next = await service.addPart(project.folder, "talk:u0")
  // the first sentence sits right before the opening beat's, so that beat grows
  expect(next.outline.beats.map((beat) => `${beat.videoId}:${beat.fromIndex}-${beat.toIndex}`)).toEqual(["talk:0-1", "broll:0-0"])
  expect(next.confirmed).toBe(false)
  expect(next.cutDecisions).toEqual(decisions)
  expect(await deps.store.get(project.folder)).toEqual(next)
  await expect(service.addPart(project.folder, "talk:u0")).rejects.toThrow(/not an unused part/)
})

test("a part put back while another change is being saved keeps that change", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let slow = false
  const { service, project, deps } = await setup()
  const inspect = deps.inspect
  deps.inspect = async (folder) => (slow ? (await gate, inspect(folder)) : inspect(folder))
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const [opening, picture] = planned.outline.beats
  await service.saveEdits(project.folder, [opening!.id, picture!.id], true)

  // the footage is read slowly; meanwhile the cut decisions are saved
  slow = true
  const adding = service.addPart(project.folder, "talk:u0")
  await new Promise((resolve) => setTimeout(resolve, 20))
  await deps.store.update(project.folder, (current) => ({ ...current!, cutDecisions: decisions }))
  release()
  const next = await adding
  expect(next.cutDecisions).toEqual(decisions)
  expect(next.outline.beats).toHaveLength(2)
  expect((await deps.store.get(project.folder))!.cutDecisions).toEqual(decisions)
})

test("a part that grows a beat keeps what sat on that beat: its sounds, cutaways and highlight text follow the new beat", async () => {
  const { service, project, deps } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const [opening, picture] = planned.outline.beats
  await service.saveEdits(project.folder, [opening!.id, picture!.id], true)
  const edge = (beatId: string, end = false) => ({ kind: "beat" as const, beatId, edge: end ? ("end" as const) : ("start" as const) })
  const stored = (await deps.store.get(project.folder))!
  await deps.store.put({
    ...stored,
    highlights: { style: null, styleByAi: null, beatsKey: null, transcripts: {}, groups: [{ id: "g", source: "ai", edited: false, beatId: opening!.id, lines: [{ videoId: "talk", from: 1, to: 2, text: "สอง" }] }] },
    flair: {
      looks: {},
      cues: [
        { anchor: edge(opening!.id), effectId: "s1", edited: true },
        { anchor: edge(picture!.id, true), effectId: "s2", edited: true },
        { anchor: { kind: "cut", videoId: "talk", sourceUs: 3_000_000, beatId: opening!.id }, effectId: "s3", edited: true },
        { anchor: { kind: "cut", videoId: "talk", sourceUs: 5_000_000 }, effectId: "s4", edited: true },
      ],
      inserts: [
        { anchor: edge(opening!.id), binId: "m", edited: true },
        { anchor: { kind: "speech", videoId: "talk", sourceUs: 2_000_000, beatId: opening!.id }, binId: "m", edited: true },
      ],
      zooms: [{ anchor: { videoId: "talk", sourceUs: 2_000_000, beatId: opening!.id }, kind: "punch", edited: true }],
      moves: [moveOn(opening!.id)],
    },
  })
  const next = await service.addPart(project.folder, "talk:u0")
  const grown = next.outline.beats[0]!.id
  expect(grown).not.toBe(opening!.id)
  expect(next.flair!.cues!.map((cue) => cue.anchor)).toEqual([
    edge(grown),
    edge(picture!.id, true),
    { kind: "cut", videoId: "talk", sourceUs: 3_000_000, beatId: grown },
    { kind: "cut", videoId: "talk", sourceUs: 5_000_000 },
  ])
  expect(next.flair!.inserts!.map((insert) => insert.anchor)).toEqual([edge(grown), { kind: "speech", videoId: "talk", sourceUs: 2_000_000, beatId: grown }])
  expect(next.highlights!.groups[0]!.beatId).toBe(grown)
  expect(next.flair!.zooms!.map((zoom) => zoom.anchor)).toEqual([{ videoId: "talk", sourceUs: 2_000_000, beatId: grown }])
  expect(next.flair!.moves).toEqual([moveOn(grown)])
  // confirming the grown outline keeps them
  expect((await service.saveEdits(project.folder, next.outline.beats.map((beat) => beat.id), true)).flair!.cues).toHaveLength(4)
  // a beat taken out takes the joins and cutaways that name it too; those saved before they named a beat stay
  const left = await service.saveEdits(project.folder, [picture!.id], true)
  expect(left.flair!.cues!.map((cue) => cue.effectId)).toEqual(["s2", "s4"])
  expect(left.flair!.inserts).toEqual([])
})

const GRAPHIC_SPEC = { kind: "motion" as const, version: "m", box: { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.8 }, seconds: 3, why: "", idea: "ป้ายเด้งขึ้น", words: [], html: "<style></style>" }
const graphicOn = (sourceUs: number, beatId?: string) => ({ anchor: { kind: "speech" as const, videoId: "talk", sourceUs, ...(beatId ? { beatId } : {}) }, spec: GRAPHIC_SPEC, edited: true, off: false })

test("a beat taken out takes the graphics on its sentences with it; one saved before graphics knew their beat stays", async () => {
  const { service, project, deps } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const [a, b, c] = first.outline.beats.map((beat) => beat.id)
  await deps.store.put({ ...first, flair: { looks: {}, graphics: [graphicOn(1_000_000, a!), graphicOn(2_000_000, b!), graphicOn(3_000_000)] } })
  const edited = await service.saveEdits(project.folder, [c!, a!], false)
  expect(edited.flair!.graphics).toEqual([graphicOn(1_000_000, a!), graphicOn(3_000_000)])
  expect((await service.get(project.folder))!.flair!.graphics).toEqual(edited.flair!.graphics)
})

test("a part that grows a beat keeps the graphics on that beat's sentences: they follow the new beat", async () => {
  const { service, project, deps } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const [opening, picture] = planned.outline.beats
  await service.saveEdits(project.folder, [opening!.id, picture!.id], true)
  const stored = (await deps.store.get(project.folder))!
  await deps.store.put({ ...stored, flair: { looks: {}, graphics: [graphicOn(2_000_000, opening!.id), graphicOn(4_000_000, picture!.id)] } })
  const next = await service.addPart(project.folder, "talk:u0")
  const grown = next.outline.beats[0]!.id
  expect(grown).not.toBe(opening!.id)
  expect(next.flair!.graphics).toEqual([graphicOn(2_000_000, grown), graphicOn(4_000_000, picture!.id)])
})

const highlights = {
  style: null,
  styleByAi: "headline" as const,
  groups: [{ id: "h1", source: "ai" as const, edited: false, lines: [{ videoId: "talk", from: 0, to: 1, text: "หนึ่ง" }] }],
  beatsKey: "k",
  transcripts: { talk: "t" },
}

test("edits keep cut decisions, highlight text, emphasis points and subtitle texts, and planning again forgets them", async () => {
  const { service, project, deps } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const emphasis = { points: [pointOn("p1", planned.outline.beats[0]!.id)], version: 1, plannedOn: { graphics: null, sounds: null }, transcripts: {} }
  const subtitleTexts = { "talk:0:1:สวัสดี": "สวัสดีครับ" }
  await deps.store.put({ ...planned, cutDecisions: decisions, highlights, emphasis, subtitleTexts })
  const edited = await service.saveEdits(project.folder, planned.outline.beats.map((beat) => beat.id), true)
  expect(edited.cutDecisions).toEqual(decisions)
  expect(edited.highlights).toEqual(highlights)
  expect([edited.emphasis, edited.subtitleTexts]).toEqual([emphasis, subtitleTexts])
  const again = await service.regenerate(project.folder)
  expect(again.cutDecisions).toBeUndefined()
  expect(again.highlights).toBeUndefined()
  expect([again.emphasis, again.subtitleTexts]).toEqual([undefined, undefined])
})

test("the store reads every outline it holds, for a list that wants all of them at once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-outlines-"))
  const store = new OutlineStore(dir)
  expect(await store.all()).toEqual([])

  const outline = { title: "t", summary: "s", omitted: "", warnings: [], beats: [] }
  const base = { videoIds: ["a"], brief: { targetSeconds: null, videoType: null, instructions: "" }, outline, model: "m", promptVersion: "p", updatedAt: 1 }
  await store.put({ ...base, folder: "/drafts/0917", confirmed: true })
  await store.put({ ...base, folder: "/drafts/0815", confirmed: false })
  await writeFile(join(dir, "half-written.json"), "{")

  const all = await store.all()
  expect(all.map((one) => one.folder).sort()).toEqual(["/drafts/0815", "/drafts/0917"])
  expect(all.find((one) => one.folder === "/drafts/0917")!.confirmed).toBe(true)
})

/** A sound Claude composed on a moment of the talk in a beat (or saved with none), tied to a graphic on that moment in `graphicBeatId` when given. */
const soundOn = (sourceUs: number, beatId?: string, graphicBeatId?: string): ComposedSound => ({
  anchor: { kind: "speech", videoId: "talk", sourceUs, ...(beatId ? { beatId } : {}) },
  ...(graphicBeatId ? { graphic: { kind: "speech" as const, videoId: "talk", sourceUs, beatId: graphicBeatId }, graphicHtml: "0123456789abcdef" } : {}),
  from: "medium",
  role: "เสียงติ๊ง",
  loudness: "normal",
  seconds: 1,
  words: [],
  code: null,
  version: SOUND_VERSION,
  off: false,
})

test("a beat taken out takes the sounds composed on its sentences with it, and those tied to a graphic there; one saved before it knew its beat stays", async () => {
  const { service, project, deps } = await setup()
  const first = await service.plan(project.folder, ["talk", "broll"], brief)
  const [a, b, c] = first.outline.beats.map((beat) => beat.id)
  await deps.store.put({ ...first, flair: { looks: {}, composed: [soundOn(1_000_000, a!), soundOn(2_000_000, b!), soundOn(3_000_000), soundOn(4_000_000, a!, a!), soundOn(5_000_000, a!, b!)] } })
  const edited = await service.saveEdits(project.folder, [c!, a!], false)
  expect(edited.flair!.composed).toEqual([soundOn(1_000_000, a!), soundOn(3_000_000), soundOn(4_000_000, a!, a!)])
  expect((await service.get(project.folder))!.flair!.composed).toEqual(edited.flair!.composed)
})

test("a part that grows a beat keeps the sounds composed on that beat's sentences, and the graphics they are tied to there: both follow the new beat", async () => {
  const { service, project, deps } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const [opening, picture] = planned.outline.beats
  await service.saveEdits(project.folder, [opening!.id, picture!.id], true)
  const stored = (await deps.store.get(project.folder))!
  await deps.store.put({ ...stored, flair: { looks: {}, composed: [soundOn(2_000_000, opening!.id), soundOn(3_000_000, opening!.id, opening!.id), soundOn(4_000_000, picture!.id, picture!.id), soundOn(5_000_000)] } })
  const next = await service.addPart(project.folder, "talk:u0")
  const grown = next.outline.beats[0]!.id
  expect(grown).not.toBe(opening!.id)
  expect(next.flair!.composed).toEqual([soundOn(2_000_000, grown), soundOn(3_000_000, grown, grown), soundOn(4_000_000, picture!.id, picture!.id), soundOn(5_000_000)])
})

test("a stored composed entry that is no sound is left as it is when beats are taken out or renamed", async () => {
  const { service, project, deps } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  const [opening, picture] = planned.outline.beats
  await service.saveEdits(project.folder, [opening!.id, picture!.id], true)
  const odd = [null, { role: "no anchor" }] as unknown as ComposedSound[]
  await deps.store.put({ ...(await deps.store.get(project.folder))!, flair: { looks: {}, composed: [...odd, soundOn(2_000_000, opening!.id)] } })
  const next = await service.addPart(project.folder, "talk:u0")
  const grown = next.outline.beats[0]!.id
  expect(next.flair!.composed).toEqual([...odd, soundOn(2_000_000, grown)])
  const left = await service.saveEdits(project.folder, [picture!.id], true)
  expect(left.flair!.composed).toEqual(odd)
})

test("the planner's direction is stored with the outline, and the user's own words replace it without touching the confirmation", async () => {
  const { service, project } = await setup()
  const planned = await service.plan(project.folder, ["talk", "broll"], brief)
  expect(planned.outline.direction).toBe("สนุก จังหวะเร็ว")
  const confirmed = await service.saveEdits(project.folder, planned.outline.beats.map((beat) => beat.id), true)

  const saved = await service.saveDirection(project.folder, `  ${"ก".repeat(OUTLINE_DIRECTION_MAX + 5)}  `)
  expect(saved.outline.direction).toBe("ก".repeat(OUTLINE_DIRECTION_MAX))
  expect(saved.confirmed).toBe(true)
  expect(saved.outline.beats).toEqual(confirmed.outline.beats)
  expect((await service.get(project.folder))!.outline.direction).toBe("ก".repeat(OUTLINE_DIRECTION_MAX))
})

test("a direction cannot be saved on a project with no outline", async () => {
  const { service, project } = await setup()
  await expect(service.saveDirection(project.folder, "สนุก")).rejects.toThrow()
})
