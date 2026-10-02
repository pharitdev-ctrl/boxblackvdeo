import { expect, test } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CueAnchor, GroupLook } from "@boxblack/core/flair/plan"
import { MOTION_VERSION, type GraphicCue } from "@boxblack/core/graphics/plan"
import type { StoredOutline } from "../shared/api.ts"
import { OutlineStore } from "./planner.ts"
import { outlineUpgrades, POST_VERSION, withoutKitGraphics, withoutOldEffects } from "./post-cleanup.ts"

const LOOK: GroupLook = { pattern: "stack", tone: "base", accent: null, exit: null, edited: false }
const CUT = { kind: "cut" as const, videoId: "v", sourceUs: 3_000_000, beatId: "b1" }
const PIECE = { videoId: "v", sourceUs: 0, beatId: "b1" }
const BOX = { x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.8 }
/** A moment of speech in the one beat these outlines have. */
const at = (sourceUs: number): CueAnchor => ({ kind: "speech", videoId: "v", sourceUs, beatId: "b1" })
/**
 * A card of the old kit as an outline from before 0.5.0 holds it: it stored no kind, and its spec is of a shape
 * the app no longer has a type for, so it is written as the file has it.
 */
const card = (sourceUs: number, more: Partial<GraphicCue> = {}) =>
  ({
    anchor: at(sourceUs),
    spec: { version: "kit-2026-09-25-2", box: BOX, seconds: 3, tone: "base", in: "pop", out: "fade", pieces: [{ kind: "label", text: "ป้าย", atS: 0 }], why: "" },
    edited: false,
    off: false,
    ...more,
  }) as unknown as GraphicCue
/** A sticker of the old kit, as stored. */
const sticker = (sourceUs: number, more: Partial<GraphicCue> = {}) =>
  ({ anchor: at(sourceUs), spec: { kind: "sticker", version: "kit-2026-09-25-2", box: BOX, seconds: 2, emoji: "🚀", motion: "fly-up", size: 0.25, why: "" }, edited: false, off: false, ...more }) as unknown as GraphicCue
/** A motion graphic, written. */
const motion = (sourceUs: number, more: Partial<GraphicCue> = {}): GraphicCue => ({
  anchor: at(sourceUs),
  spec: { kind: "motion", version: MOTION_VERSION, box: BOX, seconds: 3, why: "", idea: "ตัวเลขวิ่งจาก 0 ถึง 100", words: [], html: "<style>.a{opacity:0}</style><div class=\"a\"></div>" },
  edited: false,
  off: false,
  ...more,
})
const graphic = (edited: boolean): GraphicCue => card(1_000_000, { edited })
/** A move of the picture, the user's (switched by hand) or Claude's. */
const move = (edited: boolean) => ({
  anchor: { kind: "speech" as const, videoId: "v", sourceUs: 2_000_000, beatId: "b1" },
  from: "light" as const,
  about: "ดันเข้า",
  poses: [{ s: 0, scale: 1.1, x: 0, y: 0, rot: 0, ease: "line" as const }],
  edited,
  off: false,
})
const group = (id: string, source: "ai" | "user", edited: boolean) => ({ id, source, edited, beatId: "b1", lines: [{ videoId: "v", from: 0, to: 1, text: id }] })

/** An outline from before M25: Claude's picks and effects, some of them changed by the user. */
const OLD: StoredOutline = {
  folder: "/drafts/0917",
  videoIds: ["v"],
  brief: { targetSeconds: 30, videoType: "review", instructions: "" },
  outline: { title: "t", summary: "", omitted: "", beats: [], warnings: [] },
  confirmed: true,
  model: "claude-opus-5",
  promptVersion: "planner",
  updatedAt: 0,
  highlights: { style: null, styleByAi: "headline", beatsKey: null, transcripts: {}, groups: [group("claude", "ai", false), group("changed", "ai", true), group("mine", "user", false)] },
  flair: {
    looks: { claude: LOOK, changed: LOOK, mine: LOOK },
    cues: [
      { anchor: { kind: "highlight", groupId: "claude", line: 0 }, effectId: "on-claude", edited: true },
      { anchor: CUT, effectId: "by-claude", edited: false },
      { anchor: CUT, effectId: "by-user", edited: true, pointId: "gone" },
    ],
    zooms: [
      { anchor: PIECE, kind: "punch", edited: false },
      { anchor: PIECE, kind: "drift", edited: true },
    ],
    moves: [move(false), move(true)],
    inserts: [{ anchor: CUT, binId: "m", edited: false }],
    graphics: [graphic(false), graphic(true)],
  },
}

test("an outline from before M25 loses what Claude made and the user left alone; what the user made or changed stays, bound to no point", () => {
  const cleaned = withoutOldEffects(OLD)
  expect(cleaned.postVersion).toBe(1)
  expect(cleaned.highlights!.groups.map((one) => one.id)).toEqual(["changed", "mine"])
  expect(cleaned.highlights).toMatchObject({ styleByAi: "headline" })
  // the edited sound on a line of Claude's group has no beat to move to (this outline has none), so it goes
  // with the group; the last test below moves one whose beat the outline has
  expect(cleaned.flair).toEqual({
    looks: { changed: LOOK, mine: LOOK },
    cues: [{ anchor: CUT, effectId: "by-user", edited: true }],
    zooms: [{ anchor: PIECE, kind: "drift", edited: true }],
    moves: [move(true)],
    inserts: [],
    graphics: [graphic(true)],
  })
  // nothing else of the outline changes
  expect({ ...cleaned, highlights: OLD.highlights, flair: OLD.flair, postVersion: undefined }).toEqual(OLD)
  // cleaned once it is marked, and cleaning it again hands the same outline back
  expect(withoutOldEffects(cleaned)).toBe(cleaned)
})

test("a Claude group whose look the user set by hand is theirs: it stays with its look, bound to no point", () => {
  const set = { ...LOOK, pattern: "bar" as const, edited: true }
  const old: StoredOutline = {
    ...OLD,
    highlights: { ...OLD.highlights!, groups: [{ ...group("looked", "ai", false), pointId: "p9" }, group("claude", "ai", false)] },
    flair: { looks: { looked: set, claude: LOOK } },
  }
  const cleaned = withoutOldEffects(old)
  expect(cleaned.highlights!.groups).toEqual([group("looked", "ai", false)])
  expect(cleaned.flair!.looks).toEqual({ looked: set })
})

test("an outline already marked is handed back as it is, whatever it holds", () => {
  for (const postVersion of [1, POST_VERSION]) {
    const marked = { ...OLD, postVersion }
    expect(withoutOldEffects(marked)).toBe(marked)
  }
})

test("an outline with nothing to clean is only marked, so it is written back once", () => {
  const { highlights: _highlights, flair: _flair, ...bare } = OLD
  const cleaned = withoutOldEffects(bare)
  expect(cleaned).toEqual({ ...bare, postVersion: 1 })
  expect(cleaned).not.toHaveProperty("flair")
  expect(cleaned).not.toHaveProperty("highlights")
})

test("the store cleans an old outline the first time it is read and writes it back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-post-cleanup-"))
  await new OutlineStore(dir).put(OLD)
  expect((await new OutlineStore(dir, { steps: [{ upgrade: withoutOldEffects }] }).get(OLD.folder))!.postVersion).toBe(1)
  const onDisk = (await new OutlineStore(dir).get(OLD.folder))!
  expect([onDisk.postVersion, onDisk.highlights!.groups.map((one) => one.id)]).toEqual([1, ["changed", "mine"]])
})

// the real 0917 outline has an edited cutaway on a line of one of Claude's groups (spec §7 keeps it, and an edited line sound too:
// the user decided on 2026-09-28 that only the line sounds nobody edited go with the group)
test("an edited sound, cutaway or graphic on a line of a Claude group that goes stays, at the start of that line's beat; one on a group that stays is left where it is", () => {
  const beat = (id: string, videoId: string) => ({ id, name: id, purpose: "", videoId, videoName: videoId, kind: "speech" as const, fromIndex: 0, toIndex: 0, startUs: 0, endUs: 1_000_000, speech: "", visual: "" })
  const onLine = (groupId: string, line = 0) => ({ kind: "highlight" as const, groupId, line })
  const atStart = (beatId: string) => ({ kind: "beat" as const, beatId, edge: "start" as const })
  // Claude's groups with no beat, or with one the outline no longer has: the first beat that plays the line's own video is taken
  const loose = { id: "loose", source: "ai" as const, edited: false, lines: [{ videoId: "v", from: 0, to: 1, text: "a" }, { videoId: "w", from: 0, to: 1, text: "b" }] }
  const stale = { ...group("stale", "ai", false), beatId: "gone", lines: [{ videoId: "w", from: 0, to: 1, text: "c" }] }
  const old: StoredOutline = {
    ...OLD,
    // two beats play video v, so the group's own beat (b1) is told apart from the first one that plays its video (b0)
    outline: { ...OLD.outline, beats: [beat("b0", "v"), beat("b1", "v"), beat("b2", "w")] },
    highlights: { ...OLD.highlights!, groups: [...OLD.highlights!.groups, loose, stale] },
    flair: {
      looks: {},
      // a line sound the user changed stays, moved like the cutaways; one nobody changed goes with its group (spec §7)
      cues: [
        { anchor: onLine("claude"), effectId: "edited-line-sound", edited: true },
        { anchor: onLine("claude"), effectId: "unedited-line-sound", edited: false },
        { anchor: onLine("loose", 1), effectId: "edited-on-loose", edited: true },
      ],
      zooms: [],
      inserts: [
        { anchor: onLine("claude"), binId: "edited-on-claude", edited: true },
        { anchor: onLine("claude"), binId: "unedited-on-claude", edited: false },
        { anchor: onLine("mine"), binId: "edited-on-mine", edited: true },
        { anchor: onLine("loose", 1), binId: "edited-on-loose", edited: true },
        { anchor: onLine("stale"), binId: "edited-on-stale", edited: true },
        // on a group the outline never stored: it showed nowhere before either, and goes as regroupFlair drops it
        { anchor: onLine("never-stored"), binId: "edited-on-nothing", edited: true },
      ],
      graphics: [{ ...graphic(true), anchor: onLine("claude") }],
    },
  }
  const cleaned = withoutOldEffects(old)
  expect(cleaned.highlights!.groups.map((one) => one.id)).toEqual(["changed", "mine"])
  expect(cleaned.flair!.cues).toEqual([
    { anchor: atStart("b1"), effectId: "edited-line-sound", edited: true },
    { anchor: atStart("b2"), effectId: "edited-on-loose", edited: true },
  ])
  expect(cleaned.flair!.inserts).toEqual([
    { anchor: atStart("b1"), binId: "edited-on-claude", edited: true },
    { anchor: onLine("mine"), binId: "edited-on-mine", edited: true },
    { anchor: atStart("b2"), binId: "edited-on-loose", edited: true },
    // stacked on b2's start with the one before it: cutaways at one place all play
    { anchor: atStart("b2"), binId: "edited-on-stale", edited: true },
  ])
  expect(cleaned.flair!.graphics).toEqual([{ ...graphic(true), anchor: atStart("b1") }])
})

/** Every sound effect of an outline, by its id, in the order stored. */
const soundsOf = (stored: StoredOutline) => (stored.flair?.cues ?? []).map((cue) => cue.effectId)

/**
 * An outline as 0.4 left it, at post version 1: graphics of the old kit, some the user's, one motion graphic (a
 * build of 0.5.0 before this clean-up wrote it), and sounds on them and elsewhere.
 */
const WITH_KIT: StoredOutline = {
  ...OLD,
  postVersion: 1,
  highlights: { ...OLD.highlights!, groups: [group("mine", "user", false), { ...group("claude", "ai", false), pointId: "p1" }] },
  flair: {
    looks: { mine: LOOK, claude: LOOK },
    cues: [
      { anchor: at(1_000_000), effectId: "on-claudes-card", edited: false, pointId: "p1" },
      { anchor: at(2_000_000), effectId: "on-users-card", edited: false, pointId: "p2" },
      { anchor: at(3_000_000), effectId: "on-sticker-and-cutaway", edited: false, pointId: "p3" },
      { anchor: at(4_000_000), effectId: "of-another-point", edited: false, pointId: "p9" },
      { anchor: at(4_000_000), effectId: "users-on-a-card", edited: true, pointId: "p4" },
      { anchor: at(5_000_000), effectId: "on-motion", edited: false, pointId: "p5" },
      { anchor: at(6_000_000), effectId: "on-card-and-punch", edited: false, pointId: "p6" },
      { anchor: at(7_000_000), effectId: "on-card-of-no-point", edited: false },
      { anchor: CUT, effectId: "on-a-join", edited: false },
      { anchor: { kind: "highlight", groupId: "claude", line: 0 }, effectId: "on-a-line", edited: false, pointId: "p1" },
    ],
    zooms: [
      { anchor: { videoId: "v", sourceUs: 6_000_000, beatId: "b1" }, kind: "punch", edited: false, pointId: "p6" },
      { anchor: PIECE, kind: "drift", edited: true },
    ],
    inserts: [{ anchor: at(3_000_000), binId: "m", edited: false, pointId: "p3" }],
    graphics: [
      card(1_000_000, { pointId: "p1" }),
      card(2_000_000, { pointId: "p2", edited: true }),
      sticker(3_000_000, { pointId: "p3" }),
      card(4_000_000, { pointId: "p4", off: true, edited: true }),
      motion(5_000_000, { pointId: "p5" }),
      card(6_000_000, { pointId: "p6" }),
      sticker(7_000_000, { edited: true }),
    ],
  },
}

test("an outline at post version 1 loses every graphic of the old kit, the user's own too, with Claude's sounds only they held, and is stamped 2", () => {
  const cleaned = withoutKitGraphics(WITH_KIT)
  expect(cleaned.postVersion).toBe(2)
  // a motion graphic is no part of the kit: it stays as it is
  expect(cleaned.flair!.graphics).toEqual([motion(5_000_000, { pointId: "p5" })])
  expect(cleaned.flair!.graphics![0]).toBe(WITH_KIT.flair!.graphics![4])
  // gone: Claude's sound on the moment and the point of a graphic that went, Claude's own or the user's. Kept:
  // one whose moment a cutaway or a punch still holds, another point's on the same moment, the user's own, the one
  // on the motion graphic, and every sound that was on no graphic
  expect(soundsOf(cleaned)).toEqual(["on-sticker-and-cutaway", "of-another-point", "users-on-a-card", "on-motion", "on-card-and-punch", "on-a-join", "on-a-line"])
  // the text, its looks, the zooms and the cutaways are left alone
  expect(cleaned.highlights).toBe(WITH_KIT.highlights)
  expect(cleaned.flair!.looks).toBe(WITH_KIT.flair!.looks)
  expect(cleaned.flair!.zooms).toBe(WITH_KIT.flair!.zooms)
  expect(cleaned.flair!.inserts).toBe(WITH_KIT.flair!.inserts)
  // nothing else of the outline changes
  expect({ ...cleaned, flair: WITH_KIT.flair, postVersion: 1 }).toEqual(WITH_KIT)
  // cleaned once it is stamped, and cleaning it again hands the same outline back
  expect(withoutKitGraphics(cleaned)).toBe(cleaned)
})

test("a stored graphic of no kind the app knows goes with the kit's: only a motion graphic stays", () => {
  const odd = { ...card(1_000_000), spec: { kind: "hologram", version: "x", box: BOX, seconds: 3, why: "" } } as unknown as GraphicCue
  const cleaned = withoutKitGraphics({ ...WITH_KIT, flair: { looks: {}, graphics: [odd, motion(5_000_000)] } })
  expect(cleaned.flair).toEqual({ looks: {}, graphics: [motion(5_000_000)] })
})

test("an outline at post version 1 with no graphics is only stamped 2, and gains no list it did not have", () => {
  const { highlights: _highlights, flair: _flair, ...bare } = WITH_KIT
  expect(withoutKitGraphics(bare)).toEqual({ ...bare, postVersion: 2 })
  const soundsOnly: StoredOutline = { ...bare, flair: { looks: {}, cues: [{ anchor: CUT, effectId: "on-a-join", edited: false }] } }
  expect(withoutKitGraphics(soundsOnly)).toEqual({ ...soundsOnly, postVersion: 2 })
  // graphics with no list of sounds beside them: none is made
  const graphicsOnly: StoredOutline = { ...bare, flair: { looks: {}, graphics: [card(1_000_000)] } }
  expect(withoutKitGraphics(graphicsOnly).flair).toEqual({ looks: {}, graphics: [] })
})

test("an outline already at post version 2 comes back as the same object, whatever it holds", () => {
  const current = { ...WITH_KIT, postVersion: 2 }
  expect(POST_VERSION).toBe(2)
  expect(withoutKitGraphics(current)).toBe(current)
  // and so does one a later version of the app stamped
  const later = { ...WITH_KIT, postVersion: 3 }
  expect(withoutKitGraphics(later)).toBe(later)
})

test("an outline from before M25 is left to M25's clean-up first: on its own this one does not touch it", () => {
  expect(withoutKitGraphics(OLD)).toBe(OLD)
})

/** The outline store as the app sets it up: both clean-ups, each with its backup folder under the app's data folder. */
async function appStore() {
  const userData = await mkdtemp(join(tmpdir(), "boxblack-post-cleanup-"))
  const dir = join(userData, "outlines")
  const plain = new OutlineStore(dir)
  /** the one outline file as it is on disk, and its name */
  const onDisk = async () => {
    const [name] = await readdir(dir)
    return { name: name!, text: await readFile(join(dir, name!), "utf8") }
  }
  const copies = (backup: string) => readdir(join(userData, backup)).catch(() => null)
  return { userData, dir, plain, store: new OutlineStore(dir, { steps: outlineUpgrades(userData) }), onDisk, copies }
}

test("an outline with no post version gets M25's clean-up and then this one, ends at 2, and is copied beside M25's copies only", async () => {
  const { userData, plain, store, onDisk, copies } = await appStore()
  await plain.put(OLD)
  const original = await onDisk()
  const cleaned = (await store.get(OLD.folder))!
  expect(cleaned.postVersion).toBe(2)
  // M25's: Claude's own groups and unedited effects are gone. This one's: so is the card the user had edited, which M25's keeps
  expect(cleaned.highlights!.groups.map((one) => one.id)).toEqual(["changed", "mine"])
  expect(cleaned.flair).toEqual({ looks: { changed: LOOK, mine: LOOK }, cues: [{ anchor: CUT, effectId: "by-user", edited: true }], zooms: [{ anchor: PIECE, kind: "drift", edited: true }], moves: [move(true)], inserts: [], graphics: [] })
  expect((await plain.get(OLD.folder))!).toEqual(cleaned)
  // the one copy, from before both clean-ups, is the way back past both
  expect(await readFile(join(userData, "outlines-before-m25", original.name), "utf8")).toBe(original.text)
  expect(await copies("outlines-before-050")).toBeNull()
})

test("an outline at post version 1 is copied to outlines-before-050 before it is first written back, and that copy is never written over", async () => {
  const { userData, plain, store, onDisk, copies } = await appStore()
  await plain.put(WITH_KIT)
  const original = await onDisk()
  expect((await store.get(WITH_KIT.folder))!.flair!.graphics).toEqual([motion(5_000_000, { pointId: "p5" })])
  expect(await readFile(join(userData, "outlines-before-050", original.name), "utf8")).toBe(original.text)
  // M25's folder is for outlines from before M25 alone
  expect(await copies("outlines-before-m25")).toBeNull()
  expect((await plain.get(WITH_KIT.folder))!.postVersion).toBe(2)
  // an outline at 1 there again (put back by hand) is cleaned again, and the first copy stays as it was
  await plain.put({ ...WITH_KIT, updatedAt: 7 })
  expect((await store.get(WITH_KIT.folder))!.postVersion).toBe(2)
  expect(await readFile(join(userData, "outlines-before-050", original.name), "utf8")).toBe(original.text)
  // one at 2 is never copied: read or changed, it is up to date
  const other = { ...WITH_KIT, folder: "/drafts/new", postVersion: 2 }
  await plain.put(other)
  await store.get(other.folder)
  await store.update(other.folder, (current) => ({ ...current!, updatedAt: 9 }))
  expect(await copies("outlines-before-050")).toEqual([original.name])
})

test("an outline at post version 1 whose copy cannot be kept is not written back: its graphics are still on disk, and it is handed out cleaned", async () => {
  const { userData, plain, store, onDisk, copies } = await appStore()
  // the backup folder's place holds a file, so no copy can go there
  await writeFile(join(userData, "outlines-before-050"), "")
  await plain.put(WITH_KIT)
  const original = await onDisk()
  const cleaned = (await store.get(WITH_KIT.folder))!
  expect([cleaned.postVersion, cleaned.flair!.graphics!.length]).toEqual([2, 1])
  expect((await onDisk()).text).toBe(original.text)
  // M25's folder does not stand in for it
  expect(await copies("outlines-before-m25")).toBeNull()
})

test("a kit graphic that shares its start moment with a motion graphic leaves Claude's sound there: the motion graphic still holds the moment", () => {
  const sound = { anchor: at(5_000_000), effectId: "on-both", edited: false, pointId: "p5" }
  const both: StoredOutline = { ...WITH_KIT, flair: { looks: {}, cues: [sound], graphics: [card(5_000_000, { pointId: "p5" }), motion(5_000_000, { pointId: "p5" })] } }
  expect(withoutKitGraphics(both).flair).toEqual({ looks: {}, cues: [sound], graphics: [motion(5_000_000, { pointId: "p5" })] })
  // with no motion graphic on the moment, nothing holds it, and the sound goes with the card
  const alone: StoredOutline = { ...both, flair: { ...both.flair!, graphics: [card(5_000_000, { pointId: "p5" }), motion(6_000_000, { pointId: "p5" })] } }
  expect(withoutKitGraphics(alone).flair).toEqual({ looks: {}, cues: [], graphics: [motion(6_000_000, { pointId: "p5" })] })
})

test("an entry of the graphics that is no graphic at all goes with the kit's, whatever its shape, and the outline is cleaned and copied all the same", async () => {
  // what no version of the app wrote, but a file outside our hands may hold: an entry with no spec, one whose spec is
  // null, a null entry, one with no place, and a motion graphic with no place, which could never be laid anywhere
  const noSpec = { anchor: at(1_000_000), edited: false, off: false, pointId: "p1" }
  const nullSpec = { anchor: at(2_000_000), spec: null, edited: true, off: false, pointId: "p2" }
  const noAnchor = { spec: card(0).spec, edited: false, off: false }
  const motionNoAnchor = { spec: motion(0).spec, edited: false, off: false }
  const odd = [noSpec, nullSpec, null, noAnchor, motionNoAnchor, motion(5_000_000, { pointId: "p5" })] as unknown as GraphicCue[]
  const cues = [
    // on the moment and the point of an entry that goes, where it has a moment: they go with it
    { anchor: at(1_000_000), effectId: "on-no-spec", edited: false, pointId: "p1" },
    { anchor: at(2_000_000), effectId: "on-null-spec", edited: false, pointId: "p2" },
    { anchor: at(5_000_000), effectId: "on-motion", edited: false, pointId: "p5" },
    { anchor: CUT, effectId: "on-a-join", edited: false },
  ]
  const stored: StoredOutline = { ...WITH_KIT, flair: { looks: {}, cues, graphics: odd } }
  const cleaned = withoutKitGraphics(stored)
  expect(cleaned.postVersion).toBe(2)
  expect(cleaned.flair).toEqual({ looks: {}, cues: [cues[2], cues[3]], graphics: [motion(5_000_000, { pointId: "p5" })] })

  // graphics that is no list at all is none: every shape a JSON file can hold in its place
  for (const graphics of [{}, "x", 7, null, true]) {
    const unlisted = { ...WITH_KIT, flair: { looks: {}, cues, graphics } } as unknown as StoredOutline
    expect(withoutKitGraphics(unlisted), JSON.stringify(graphics)).toEqual({ ...WITH_KIT, flair: { looks: {}, cues, graphics: [] }, postVersion: 2 })
  }

  // through the store: the file ends at version 2 without them, and the copy holds them
  const { userData, plain, store, onDisk, copies } = await appStore()
  await plain.put(stored)
  const original = await onDisk()
  expect((await store.get(stored.folder))!).toEqual(cleaned)
  expect((await plain.get(stored.folder))!).toEqual(cleaned)
  expect(JSON.parse(await readFile(join(userData, "outlines-before-050", original.name), "utf8")).flair.graphics).toEqual([noSpec, nullSpec, null, noAnchor, motionNoAnchor, motion(5_000_000, { pointId: "p5" })])
  expect(await copies("outlines-before-m25")).toBeNull()
  // and the list that was no list: cleaned, written back and copied too
  const other = { ...WITH_KIT, folder: "/drafts/other", flair: { looks: {}, graphics: { a: 1 } } } as unknown as StoredOutline
  await plain.put(other)
  expect((await store.get(other.folder))!).toMatchObject({ postVersion: 2, flair: { looks: {}, graphics: [] } })
  expect((await plain.get(other.folder))!.postVersion).toBe(2)
  expect((await copies("outlines-before-050"))!).toHaveLength(2)
})

test("a file that is JSON but no outline is left alone: not read, not cleaned, not written back and not copied", async () => {
  const { dir, plain, store, onDisk, copies } = await appStore()
  await plain.put(OLD)
  const { name } = await onDisk()
  for (const junk of ["42", '"x"', "[]", "{}", "null", '{"folder":7}']) {
    await writeFile(join(dir, name), junk)
    expect(await store.get(OLD.folder), junk).toBeNull()
    expect(await store.all(), junk).toEqual([])
    expect((await onDisk()).text, junk).toBe(junk)
    expect([await copies("outlines-before-m25"), await copies("outlines-before-050")], junk).toEqual([null, null])
    // a store with no clean-up reads it as no file too
    expect(await plain.get(OLD.folder), junk).toBeNull()
  }
})
