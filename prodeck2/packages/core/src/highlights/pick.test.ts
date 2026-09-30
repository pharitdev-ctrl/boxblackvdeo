import { expect, test } from "vitest"
import type { TimedText } from "../asr/types.ts"
import type { LlmContent, LlmRequest, LlmResponse, LlmTransport } from "../llm/types.ts"
import { acceptHighlights, findQuote, HIGHLIGHT_PROMPT, HIGHLIGHT_PROMPT_VERSION, HighlightReplySchema, pickHighlights, type HighlightPoint, type HighlightReply } from "./pick.ts"
import { SCENE_LABEL_MAX_US } from "./placement.ts"
import { HIGHLIGHT_STYLES } from "./styles.ts"

const texts = ["ถ้า", "คุณ", "กำลัง", "มอง", "หา", "ร้าน", "ทํา", "เล็บ", "ราคา", "เริ่ม", "ต้น", "299", "บาท", "ทัก", "มา", "ได้", "เลย"]
// "ทํา" is written with a separate nikhahit and sara aa, as whisper.cpp writes it
const words: TimedText[] = texts.map((text, i) => ({ text, startUs: i * 300_000, endUs: i * 300_000 + 250_000 }))
const wordsOf = (videoId: string) => (videoId === "v1" ? words : [])

type SpeechPoint = Extract<HighlightPoint, { kind: "speech" }>

// four points in playing order: a hook and a price in the opening beat, a call to act at the end, and the shop front, a picture beat of another clip
const opening: SpeechPoint = {
  pointId: "p1",
  kind: "speech",
  importance: "key",
  type: "hook",
  reason: "เปิดด้วยคำถาม",
  videoId: "v1",
  beatId: "b1",
  beatName: "เปิดคลิป",
  atUs: 0,
  text: "ถ้าคุณกำลังมองหา",
  phrase: { from: 0, to: 5 },
  sentence: { from: 0, to: 8, text: "ถ้าคุณกำลังมองหาร้านทําเล็บ" },
}
const price: SpeechPoint = {
  pointId: "p2",
  kind: "speech",
  importance: "key",
  type: "number",
  reason: "ราคา",
  videoId: "v1",
  beatId: "b1",
  beatName: "เปิดคลิป",
  atUs: 3_300_000,
  text: "299 บาท",
  phrase: { from: 11, to: 13 },
  sentence: { from: 8, to: 13, text: "ราคาเริ่มต้น 299 บาท" },
}
const callToAction: SpeechPoint = {
  pointId: "p3",
  kind: "speech",
  importance: "secondary",
  type: "action",
  reason: "ชวนทัก",
  videoId: "v1",
  beatId: "b2",
  beatName: "ปิดท้าย",
  atUs: 65_300_000,
  text: "ทักมาได้เลย",
  phrase: { from: 13, to: 17 },
  sentence: { from: 13, to: 17, text: "ทักมาได้เลย" },
}
const shopFront: HighlightPoint = {
  pointId: "p4",
  kind: "scene",
  importance: "extra",
  type: "visual",
  reason: "หน้าร้านสวย",
  videoId: "v2",
  beatId: "b3",
  beatName: "หน้าร้าน",
  atUs: 68_000_000,
  text: "หน้าร้านสีชมพู มีป้ายไฟ",
  startUs: 1_000_000,
  endUs: 5_000_000,
  durationUs: 4_000_000,
}
const points: HighlightPoint[] = [opening, price, callToAction, shopFront]
const BRIEF = { targetSeconds: null, videoType: null, instructions: "" }

function ids() {
  let n = 0
  return () => `h${++n}`
}

type Group = HighlightReply["groups"][number]
/** An answer on point `point` with these [quote, text] lines, in the plain look unless `look` says otherwise. */
const group = (point: number, lines: [quote: string, text?: string][], look: Partial<Omit<Group, "point" | "lines">> = {}): Group => ({
  point,
  lines: lines.map(([quote, text = quote]) => ({ quote, text })),
  pattern: "stack",
  tone: "base",
  accentLine: 0,
  accentWord: "",
  exit: "",
  ...look,
})
const PLAIN = { pattern: "stack", tone: "base", accent: null, exit: null, edited: false }

const accept = (groups: Group[], maxChars = 12, landscape = false, from: HighlightPoint[] = points) =>
  acceptHighlights({ points: from, wordsOf, reply: { style: "bold-white", groups }, maxChars, landscape, newId: ids() })
/** The same, for a user with CapCut Pro: the exits that need it are kept. */
const acceptPro = (groups: Group[], maxChars = 12, landscape = false) => acceptHighlights({ points, wordsOf, reply: { style: "bold-white", groups }, maxChars, landscape, newId: ids(), pro: true })

test("a point's quotes become the words that say them; the group carries its point and beat; blank text shows the words", () => {
  const result = acceptHighlights({
    points,
    wordsOf,
    reply: { style: "sale-yellow", groups: [group(1, [["ถ้าคุณ"], ["กำลัง มองหา", "กำลังมองหา"], ["ร้านทำเล็บ", " "]])] },
    maxChars: 12,
    landscape: false,
    newId: ids(),
  })
  expect(result).toEqual({
    style: "sale-yellow",
    dropped: 0,
    groups: [
      {
        id: "h1",
        source: "ai",
        edited: false,
        lines: [
          { videoId: "v1", from: 0, to: 2, text: "ถ้าคุณ" },
          { videoId: "v1", from: 2, to: 5, text: "กำลังมองหา" },
          // the decomposed "ํา" of the transcript is shown as "ำ"
          { videoId: "v1", from: 5, to: 8, text: "ร้านทำเล็บ" },
        ],
        beatId: "b1",
        pointId: "p1",
      },
    ],
    looks: { h1: PLAIN },
  })
})

test("a quote that starts or ends inside a word takes the whole word; the shown text may differ from what was said", () => {
  expect(accept([group(2, [["าเริ่มต้น 29", "เริ่ม 299.-"]])]).groups[0]!.lines).toEqual([{ videoId: "v1", from: 8, to: 12, text: "เริ่ม 299.-" }])
})

test("lines may take the neighbouring words of the point's sentence, but a group must say some of its phrase", () => {
  expect(accept([group(2, [["ราคาเริ่มต้น"], ["299 บาท"]])]).groups[0]!.lines).toEqual([
    { videoId: "v1", from: 8, to: 11, text: "ราคาเริ่มต้น" },
    { videoId: "v1", from: 11, to: 13, text: "299 บาท" },
  ])
  // the price's sentence without the price is not the price
  expect(accept([group(2, [["ราคาเริ่มต้น"]])])).toMatchObject({ groups: [], dropped: 1 })
  // words of another sentence are not the point's to quote
  expect(accept([group(2, [["ทักมา"]])])).toMatchObject({ groups: [], dropped: 1 })
})

test("lines that cannot be placed or read are dropped and counted", () => {
  const result = accept([
    group(9, [["ถ้าคุณ"]]), // no such point
    group(0, [["ถ้าคุณ"]]), // numbering starts at 1
    group(1, [["ไม่ได้พูด"]]), // not said
    group(1, [[""]]), // nothing quoted
    group(1, [["ถ้าคุณกำลังมองหาร"]]), // 13 characters
    group(1, [["มองหา"], ["ถ้าคุณ"]]), // second line said earlier
    group(3, [["ทัก"], ["มา"], ["ไม่ได้พูด"], ["มาได้เลยนะคะทุกคนคร้าบ"], ["ได้เลย"]]), // bad lines between good ones
  ])
  expect(result.groups.map((g) => g.lines.map((l) => l.text))).toEqual([["มองหา"], ["ทัก", "มา", "ได้เลย"]])
  expect(result.dropped).toBe(8)
})

test("a point gets one group: a second group on it is dropped with its lines", () => {
  const result = accept([group(1, [["ถ้าคุณ"]]), group(1, [["กำลัง"], ["มองหา"]])])
  expect(result.groups.map((g) => g.lines.map((l) => l.text))).toEqual([["ถ้าคุณ"]])
  expect(result.dropped).toBe(2)
})

test("a group holds three lines at most", () => {
  const result = accept([group(1, [["ถ้า"], ["คุณ"], ["กำลัง"], ["มองหา"]])])
  expect(result.groups[0]!.lines.map((l) => l.text)).toEqual(["ถ้า", "คุณ", "กำลัง"])
  expect(result.dropped).toBe(1)
})

test("a line longer than allowed on portrait may be as long as landscape allows", () => {
  expect(accept([group(1, [["ถ้าคุณกำลังมองหาร"]])], 18).groups).toHaveLength(1)
  expect(accept([group(1, [["ถ้าคุณกำลังมองหา"]])], 12).groups).toHaveLength(1)
})

test("groups come in the points' order, and one reaching back into the words of the group before it is dropped", () => {
  // two points in one sentence: "ถ้าคุณ" and "ร้านทำเล็บ"
  const two: HighlightPoint[] = [
    { ...opening, pointId: "pa", phrase: { from: 0, to: 2 }, text: "ถ้าคุณ" },
    { ...opening, pointId: "pb", phrase: { from: 5, to: 8 }, text: "ร้านทำเล็บ", atUs: 1_500_000 },
  ]
  const ordered = accept([group(2, [["มองหา"], ["ร้านทำเล็บ"]]), group(1, [["ถ้าคุณ"]])], 12, false, two)
  expect(ordered.groups.map((g) => [g.id, g.pointId, g.lines.map((l) => l.text)])).toEqual([
    ["h1", "pa", ["ถ้าคุณ"]],
    ["h2", "pb", ["มองหา", "ร้านทำเล็บ"]],
  ])
  expect(ordered.dropped).toBe(0)
  // "กำลัง" is already the first group's: the second would show on top of it
  const overlapping = accept([group(1, [["ถ้าคุณกำลัง"]]), group(2, [["กำลังมองหา"], ["ร้านทำเล็บ"]])], 12, false, two)
  expect(overlapping.groups.map((g) => g.pointId)).toEqual(["pa"])
  expect(overlapping.dropped).toBe(2)
})

test("a picture point gets a label of Claude's own words: no quote, the stretch stored with it", () => {
  const result = accept([group(4, [["", "หน้าร้านสีชมพู"], ["", " "], ["", "ร้านเปิดทุกวันเลยนะคะทุกคน"]])])
  expect(result.groups).toEqual([
    {
      id: "h1",
      source: "ai",
      edited: false,
      lines: [{ videoId: "v2", from: 0, to: 0, text: "หน้าร้านสีชมพู" }],
      beatId: "b3",
      pointId: "p4",
      scene: { videoId: "v2", startUs: 1_000_000, endUs: 5_000_000 },
    },
  ])
  // the blank line and the one too long to read
  expect(result.dropped).toBe(2)
})

test("each group's look comes with it, keyed by its id: pattern, tone, the coloured word in code points, the exit", () => {
  // for a user with CapCut Pro, which every exit needs
  const answer = group(2, [["ราคาเริ่มต้น"], ["299 บาท"]], { pattern: "bar", tone: "accent", accentLine: 2, accentWord: "299", exit: "fade-alt" })
  expect(acceptPro([answer])).toMatchObject({ dropped: 0, looks: { h1: { pattern: "bar", tone: "accent", accent: { line: 1, from: 0, to: 3 }, exit: "fade-alt", edited: false } } })
  // wide output cannot draw the bar: it is the stack, and counted
  expect(acceptPro([answer], 18, true)).toMatchObject({ dropped: 1, looks: { h1: { pattern: "stack", exit: "fade-alt" } } })
})

test("a coloured word is found on the line Claude named, counted among the lines it gave; one not there is dropped and counted", () => {
  const { looks, dropped } = accept([
    group(1, [["ไม่ได้พูด"], ["ถ้าคุณ"]], { accentLine: 2, accentWord: "คุณ" }),
    group(2, [["299 บาท"]], { accentLine: 1, accentWord: "499" }),
    group(3, [["ทักมา"]], { accentLine: 2, accentWord: "ทัก" }),
  ])
  // Claude's first line was not said, so its second is the group's first: ถ ้ า ค ุ ณ
  expect(looks.h1!.accent).toEqual({ line: 0, from: 3, to: 6 })
  expect(looks.h2!.accent).toBeNull()
  expect(looks.h3!.accent).toBeNull()
  // the unsaid line, the word not in its line, the line not there
  expect(dropped).toBe(3)
})

test("a pattern the group cannot carry falls back to the stack and counts; an unknown exit is dropped and counted; a missing tone is the base", () => {
  // with CapCut Pro, so the exit is turned down for being unknown: without Pro every exit is
  const { looks, dropped } = acceptPro([
    // "punch" is for one line only
    group(1, [["ถ้าคุณ"], ["กำลังมองหา"]], { pattern: "punch" }),
    group(2, [["299 บาท"]], { exit: "made-up" }),
    group(3, [["ทักมา"]], { tone: undefined as never }),
  ])
  expect(looks.h1!.pattern).toBe("stack")
  expect(looks.h2!.exit).toBeNull()
  expect(looks.h3!.tone).toBe("base")
  expect(dropped).toBe(2)
})

test("a look Claude chose is kept as chosen: the run of same patterns is ruled when the groups are shown, not stored", () => {
  const punch = { pattern: "punch" as const }
  const { looks, dropped } = accept([group(1, [["ถ้าคุณ"]], punch), group(2, [["299 บาท"]], punch), group(3, [["ทักมา"]], punch), group(4, [["", "หน้าร้าน"]], punch)])
  expect(Object.values(looks).map((look) => look.pattern)).toEqual(["punch", "punch", "punch", "punch"])
  expect(dropped).toBe(0)
})

function fakeTransport(reply: HighlightReply) {
  const requests: LlmRequest<unknown>[] = []
  const transport: LlmTransport = {
    id: "claude-cli",
    async generate<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
      requests.push(request as LlmRequest<unknown>)
      return { output: reply as T, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    },
  }
  return { transport, requests }
}

const textOf = (content: LlmContent[]) => content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n")

test("Claude gets the brief, the styles, patterns and exits it may use, and the numbered points with their kind, weight, beat, time and words", async () => {
  const { transport, requests } = fakeTransport({ style: "cute-pink", groups: [group(3, [["ทักมาได้เลย"]])] })
  const brief = { targetSeconds: 60, videoType: "review" as const, instructions: "เน้นราคา" }
  const result = await pickHighlights({ transport, model: "claude-opus-5", brief, durationUs: 72_000_000, points, wordsOf, maxChars: 12, newId: ids(), pro: true })
  expect(result).toEqual({
    style: "cute-pink",
    dropped: 0,
    groups: [{ id: "h1", source: "ai", edited: false, lines: [{ videoId: "v1", from: 13, to: 17, text: "ทักมาได้เลย" }], beatId: "b2", pointId: "p3" }],
    looks: { h1: PLAIN },
  })

  const request = requests[0]!
  expect(request.model).toBe("claude-opus-5")
  expect(request.system).toBe(HIGHLIGHT_PROMPT.system)
  expect(request.schema).toBe(HighlightReplySchema)
  expect(HIGHLIGHT_PROMPT.version).toBe(HIGHLIGHT_PROMPT_VERSION)
  expect(HIGHLIGHT_PROMPT_VERSION).toBe("highlights-2026-09-27-points")
  const text = textOf(request.content)
  for (const style of Object.values(HIGHLIGHT_STYLES)) expect(text).toContain(`- ${style.id}: ${style.mood}`)
  expect(text).toContain("review")
  expect(text).toContain("60 วินาที")
  expect(text).toContain("เน้นราคา")
  expect(text).toContain("1:12")
  expect(text).toContain("ไม่เกิน 12 ตัวอักษร")
  expect(text).toContain("- bar: ")
  expect(text).toContain("- fade-out: จางหายหลอน ๆ")
  expect(text).toContain('[1] คำพูด · สำคัญ · hook · ช่วง "เปิดคลิป" 0:00.0 “ถ้าคุณกำลังมองหา” ในประโยค “ถ้าคุณกำลังมองหาร้านทําเล็บ” · เหตุผล: เปิดด้วยคำถาม')
  expect(text).toContain('[3] คำพูด · รอง · การกระทำ · ช่วง "ปิดท้าย" 1:05.3 “ทักมาได้เลย” ในประโยค “ทักมาได้เลย” · เหตุผล: ชวนทัก')
  expect(text).toContain('[4] ภาพ · เสริม · ภาพสวย · ช่วง "หน้าร้าน" 1:08.0 ยาว 4.0 วิ ฉาก: หน้าร้านสีชมพู มีป้ายไฟ · เหตุผล: หน้าร้านสวย')

  // wide output is not offered the bar
  await pickHighlights({ transport, model: "m", brief, durationUs: 1, points, wordsOf, maxChars: 18, landscape: true, newId: ids() })
  expect(textOf(requests[1]!.content)).not.toContain("- bar: ")
})

test("Claude is offered only the exits the user may have: none without CapCut Pro or when not told, since every one needs it, all five with it", async () => {
  const every = ["- fade-alt: ", "- spin-out: ", "- fade-out: ", "- burst-out: ", "- fade-dim: "]
  const noneToChoose = "- (ไม่มีให้เลือก ให้ตอบค่าว่าง)"
  const none = { listed: [noneToChoose], left: every, exit: null }
  for (const { pro, listed, left, exit } of [
    { pro: false, ...none },
    { pro: undefined, ...none },
    { pro: true, listed: every, left: [noneToChoose], exit: "spin-out" },
  ]) {
    // Claude answers with a Pro exit on the price every time: what comes back is ruled by the same setting
    const { transport, requests } = fakeTransport({ style: "bold-white", groups: [group(2, [["299 บาท"]], { exit: "spin-out" })] })
    const args = { transport, model: "m", brief: BRIEF, durationUs: 10_000_000, points, wordsOf, maxChars: 12, newId: ids() }
    const result = await pickHighlights(pro === undefined ? args : { ...args, pro })
    const text = textOf(requests[0]!.content)
    for (const line of listed) expect(text).toContain(line)
    for (const line of left) expect(text).not.toContain(line)
    expect(result.looks.h1!.exit).toBe(exit)
  }
})

test("an exit Claude answers that needs Pro the user does not have is left off and counted", () => {
  const answer = group(2, [["299 บาท"]], { exit: "spin-out" })
  expect(accept([answer])).toMatchObject({ dropped: 1, looks: { h1: { exit: null } } })
  expect(acceptPro([answer])).toMatchObject({ dropped: 0, looks: { h1: { exit: "spin-out" } } })
})

test("an empty brief says so, a point with no reason says none, and no points means no request", async () => {
  const { transport, requests } = fakeTransport({ style: "headline", groups: [] })
  const args = { transport, model: "claude-sonnet-5", brief: BRIEF, durationUs: 1, wordsOf, maxChars: 12, newId: ids() }
  await pickHighlights({ ...args, points: [{ ...opening, reason: " " }] })
  const text = textOf(requests[0]!.content)
  expect(text).toContain("ไม่ระบุ")
  expect(text).toContain("ในประโยค “ถ้าคุณกำลังมองหาร้านทําเล็บ”")
  expect(text).not.toContain("เหตุผล:")
  expect(await pickHighlights({ ...args, points: [] })).toEqual({ style: "bold-white", groups: [], looks: {}, dropped: 0 })
  expect(requests).toHaveLength(1)
})

test("the reply schema takes known styles and patterns and whole point numbers, and a missing tone is the base", () => {
  const answer = { point: 1, lines: [{ quote: "a", text: "a" }], pattern: "stack", accentLine: 0, accentWord: "", exit: "" }
  expect(HighlightReplySchema.safeParse({ style: "neon", groups: [] }).success).toBe(false)
  expect(HighlightReplySchema.safeParse({ style: "headline", groups: [{ ...answer, point: 1.5 }] }).success).toBe(false)
  expect(HighlightReplySchema.safeParse({ style: "headline", groups: [{ ...answer, pattern: "zigzag" }] }).success).toBe(false)
  expect(HighlightReplySchema.parse({ style: "headline", groups: [answer] }).groups[0]!.tone).toBe("base")
})

test("the prompt asks for one group a point from its phrase and neighbours, a label on a picture point, no overlap in time, and the looks in the same answer", () => {
  const system = HIGHLIGHT_PROMPT.system
  expect(system).toContain("ตอบหนึ่งชุดต่อจุด point คือเลขจุด")
  expect(system).toContain("คำข้างเคียงในประโยคเดียวกัน")
  // a sentence the cut took words out of comes in parts: a line is quoted from one part
  expect(system).toContain("บรรทัดหนึ่งห้ามคร่อม … ")
  expect(system).toContain("ป้ายสั้น 1–3 บรรทัด")
  // as long as a label is let stay up
  expect(system).toContain(`ไม่เกิน ${SCENE_LABEL_MAX_US / 1_000_000} วินาที`)
  expect(system).toContain("ชุดต้องไม่ซ้อนเวลากัน")
  expect(system).toContain("รูปแบบเดียวกันติดกันไม่เกิน 3 ชุด")
  expect(system).toContain("โทนเดียวกันติดกันไม่เกิน 3 ชุด")
})

test("a quote is found inside the words given, whole words, Thai matched as shown; outside them, or empty, it is not", () => {
  expect(findQuote(words, { from: 0, to: 8 }, "ร้านทำเล็บ")).toEqual({ from: 5, to: 8 })
  expect(findQuote(words, { from: 8, to: 13 }, "าเริ่มต้น 29")).toEqual({ from: 8, to: 12 })
  expect(findQuote(words, { from: 0, to: 8 }, "ราคา")).toBeNull()
  expect(findQuote(words, { from: 0, to: 8 }, "")).toBeNull()
})
