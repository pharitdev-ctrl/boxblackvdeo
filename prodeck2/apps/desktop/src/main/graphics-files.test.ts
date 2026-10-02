import { chmod, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { cleanGraphicFiles, graphicFilesInfo } from "./graphics-files.ts"

const temps: string[] = []
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const USED = "0123456789abcdef"
const GONE = "fedcba9876543210"
const OTHER = "00000000000000aa"

/** the clean's clock, and the time every file in `setup` was last changed: long enough before it to be settled */
const NOW = Date.parse("2026-09-25T12:00:00Z")
const LONG_AGO = new Date("2026-09-20T12:00:00Z")

/**
 * A graphics folder holding `hashes` (each with its poster and meta), a sounds folder beside it holding the composed
 * sounds `sounds`, a drafts root, and BOXBLACK's backup root.
 */
async function setup(hashes: string[], sounds: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "gfiles-"))
  temps.push(root)
  const dir = join(root, "graphics")
  const soundsDir = join(root, "sounds")
  await mkdir(soundsDir, { recursive: true })
  for (const hash of sounds) await aged(join(soundsDir, `${hash}.wav`), "w".repeat(300))
  const drafts = join(root, "drafts")
  const backups = join(root, "backups")
  await mkdir(dir, { recursive: true })
  await mkdir(drafts, { recursive: true })
  for (const hash of hashes) {
    await writeFile(join(dir, `${hash}.mov`), "x".repeat(1000))
    await utimes(join(dir, `${hash}.mov`), LONG_AGO, LONG_AGO)
    await writeFile(join(dir, `${hash}.png`), "png")
    await writeFile(join(dir, `${hash}.json`), "{}")
  }
  const trashed: string[] = []
  // like shell.trashItem, it fails on a file that is not there
  const trash = async (path: string) => {
    await stat(path)
    trashed.push(path)
  }
  const clean = (over: Partial<Parameters<typeof cleanGraphicFiles>[0]> = {}) =>
    cleanGraphicFiles({ dir, soundsDir, draftsRoot: drafts, backupRoot: backups, trash, busy: () => false, now: () => NOW, ...over })
  return { dir, soundsDir, drafts, backups, trash, trashed, clean }
}

/** A file written long enough ago to be settled. */
async function aged(path: string, content: string) {
  await writeFile(path, content)
  await utimes(path, LONG_AGO, LONG_AGO)
}

/** A draft folder `where` under `root`: its timeline (null for none) and, unless `meta` is false, its meta. */
async function draft(root: string, where: string, info: string | null, meta = true) {
  await mkdir(join(root, where), { recursive: true })
  if (info !== null) await writeFile(join(root, where, "draft_info.json"), info)
  if (meta) await writeFile(join(root, where, "draft_meta_info.json"), "{}")
}

/** A timeline copy on its own, `where` under `root`: a draft's Timelines/<id>. */
async function timeline(root: string, where: string, info: string) {
  await mkdir(join(root, where), { recursive: true })
  await writeFile(join(root, where, "draft_info.json"), info)
}

const using = (...paths: string[]) => JSON.stringify({ materials: { videos: [{ path: "/Users/me/clip.MOV" }, ...paths.map((path) => ({ path })), {}] } })

test("counts the rendered files and their size; posters, meta and any other .mov are not counted", async () => {
  const { dir } = await setup([USED, GONE])
  // not a rendered graphic, so not something a clean could take away
  await writeFile(join(dir, "someone-elses.mov"), "x".repeat(500))
  expect(await graphicFilesInfo(dir)).toEqual({ count: 2, bytes: 2000 })
  expect(await graphicFilesInfo(join(dir, "none-yet"))).toEqual({ count: 0, bytes: 0 })
})

test("a file no draft uses goes to the Trash with its poster and meta, the meta first; one a draft uses stays", async () => {
  const { dir, drafts, trashed, clean } = await setup([USED, GONE, OTHER])
  // not a file the renderer names: left alone
  await writeFile(join(dir, "notes.mov"), "x")
  await draft(drafts, "0917", using(join(dir, `${USED}.mov`)))
  await draft(drafts, "0918", using(join(dir, `${OTHER}.mov`)))
  // a folder that is not a draft is passed over
  await mkdir(join(drafts, ".recycle"), { recursive: true })
  await writeFile(join(drafts, "root_meta_info.json"), "{}")
  expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(trashed).toEqual([join(dir, `${GONE}.json`), join(dir, `${GONE}.mov`), join(dir, `${GONE}.png`)])
})

test("a file is known by its name, wherever the draft says it is and however the path is spelled", async () => {
  const { drafts, trashed, clean } = await setup([USED, GONE])
  // another folder (a copy of the graphics folder, a path in another Unicode form or case), same file name
  await draft(drafts, "0917", using(`/Users/Me/Movies/CapCut/BOXBLACK/graphics-é/${USED}.MOV`))
  expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(trashed.filter((path) => path.endsWith(".mov"))).toEqual([expect.stringContaining(GONE)])
})

test("a file used only by a draft in the recycle bin, one of a draft's timelines, or a backup BOXBLACK made, stays", async () => {
  const { dir, drafts, backups, trashed, clean } = await setup([USED, OTHER, "22222222222222bb", GONE])
  await draft(drafts, "0917", using())
  // CapCut can restore a deleted draft, and a draft holds a copy of each of its timelines
  await draft(drafts, join(".recycle_bin", "old"), using(join(dir, `${USED}.mov`)))
  await timeline(drafts, join("0917", "Timelines", "A1B2"), using())
  await timeline(drafts, join("0917", "Timelines", "C3D4"), using(join(dir, `${OTHER}.mov`)))
  // BOXBLACK can put back a draft it backed up before writing to it
  await draft(backups, join("0917-20260924-101500", "draft"), using())
  await timeline(backups, join("0917-20260924-101500", "draft", "Timelines", "E5F6"), using(join(dir, "22222222222222bb.mov")))
  expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(trashed.filter((path) => path.endsWith(".mov"))).toEqual([join(dir, `${GONE}.mov`)])
})

test("a file a draft uses anywhere in its JSON stays: inside a compound clip, in a nested draft under subdraft/, or only in its media bin", async () => {
  const BIN = "33333333333333cc"
  const NESTED = "44444444444444dd"
  const { dir, drafts, trashed, clean } = await setup([USED, OTHER, BIN, NESTED, GONE])
  // a compound clip carries a whole draft of its own inside the timeline, with its own materials
  const compound = { materials: { videos: [{ path: "/Users/me/clip.MOV" }], drafts: [{ id: "c1", type: "combination", draft: { materials: { videos: [{ path: join(dir, `${USED}.mov`) }] } } }] } }
  await draft(drafts, "0917", JSON.stringify(compound))
  // CapCut can keep a nested draft in a folder of its own, under any name and depth
  await timeline(drafts, join("0917", "subdraft", "c2"), using(join(dir, `${OTHER}.mov`)))
  await mkdir(join(drafts, "0917", "subdraft", "c3", "deeper"), { recursive: true })
  await writeFile(join(drafts, "0917", "subdraft", "c3", "deeper", "combination.json"), using(join(dir, `${NESTED}.mov`)))
  // not JSON, so not read: a nested draft's media sits beside its JSON
  await writeFile(join(drafts, "0917", "subdraft", "c3", "thumb.jpg"), "not json")
  // a graphic taken off every timeline but kept in the media panel, to be dragged back on later
  await writeFile(join(drafts, "0917", "draft_meta_info.json"), JSON.stringify({ draft_materials: [{ type: 0, value: [{ file_Path: join(dir, `${BIN}.mov`) }] }] }))
  expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(trashed.filter((path) => path.endsWith(".mov"))).toEqual([join(dir, `${GONE}.mov`)])
  // a backup's nested drafts count the same
  const backedUp = await setup([NESTED, GONE])
  await draft(backedUp.backups, join("0917-x", "draft"), using())
  await timeline(backedUp.backups, join("0917-x", "draft", "subdraft", "c2"), using(join(backedUp.dir, `${NESTED}.mov`)))
  expect(await backedUp.clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(backedUp.trashed.filter((path) => path.endsWith(".mov"))).toEqual([join(backedUp.dir, `${GONE}.mov`)])
})

test("any JSON under a timeline's own folder counts, as a nested draft's does; an empty one there names nothing and blocks nothing", async () => {
  const PATCHED = "66666666666666ff"
  const { dir, drafts, trashed, clean } = await setup([PATCHED, GONE])
  await draft(drafts, "0917", using())
  await timeline(drafts, join("0917", "Timelines", "A1B2"), using())
  await mkdir(join(drafts, "0917", "Timelines", "A1B2", "attachment", "patch"), { recursive: true })
  await writeFile(join(drafts, "0917", "Timelines", "A1B2", "attachment", "patch", "mini_draft.json"), using(join(dir, `${PATCHED}.mov`)))
  // CapCut leaves files like these with nothing in them
  await writeFile(join(drafts, "0917", "Timelines", "A1B2", "draft_biz_config.json"), "")
  await timeline(drafts, join("0917", "subdraft", "c1"), using())
  await writeFile(join(drafts, "0917", "subdraft", "c1", "draft_biz_config.json"), "")
  await writeFile(join(drafts, "0917", "subdraft", "c1", "key_value.json"), " \n\t\n")
  expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(trashed.filter((path) => path.endsWith(".mov"))).toEqual([join(dir, `${GONE}.mov`)])
})

test("a draft whose media bin or nested drafts cannot be read keeps every file; one with neither is fine", async () => {
  const cases: [string, (drafts: string) => Promise<void>][] = [
    ["a media bin that is not JSON", (drafts) => writeFile(join(drafts, "0917", "draft_meta_info.json"), "not json")],
    // CapCut empties it before writing it again: what it holds meanwhile is not known
    ["a media bin with nothing in it", (drafts) => writeFile(join(drafts, "0917", "draft_meta_info.json"), "")],
    ["a nested draft that is not JSON", (drafts) => timeline(drafts, join("0917", "subdraft", "c2"), "{\"materials\": {")],
    ["a file under a timeline's folder that is not JSON", async (drafts) => {
      await timeline(drafts, join("0917", "Timelines", "A1B2"), using())
      await mkdir(join(drafts, "0917", "Timelines", "A1B2", "attachment"), { recursive: true })
      await writeFile(join(drafts, "0917", "Timelines", "A1B2", "attachment", "mini_draft.json"), "not json")
    }],
    ["a nested draft's folder that cannot be listed", async (drafts) => {
      await mkdir(join(drafts, "0917", "subdraft", "locked"), { recursive: true })
      await chmod(join(drafts, "0917", "subdraft", "locked"), 0o000)
    }],
  ]
  for (const [what, spoil] of cases) {
    const { drafts, trashed, clean } = await setup([GONE])
    await draft(drafts, "0917", using())
    await spoil(drafts)
    try {
      expect(await clean(), what).toEqual({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "0917" }, kept: null })
    } finally {
      await chmod(join(drafts, "0917", "subdraft", "locked"), 0o755).catch(() => {})
    }
    expect(trashed).toEqual([])
  }
  // no media bin and no nested drafts: nothing else to read
  const bare = await setup([GONE])
  await draft(bare.drafts, "0917", using(), false)
  expect(await bare.clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
})

test("a file made in the last ten minutes stays, meta or not, and the result says so; an older one with no meta goes", async () => {
  const FRESH = "55555555555555ee"
  const { dir, drafts, trashed, clean } = await setup([GONE, OTHER, USED, FRESH])
  await draft(drafts, "0917", using())
  // long ago, a render that failed after its file was in place, before its meta was written
  await rm(join(dir, `${OTHER}.json`))
  // made nine minutes ago, and not in any draft yet
  const recent = new Date(NOW - 9 * 60_000)
  await utimes(join(dir, `${USED}.mov`), recent, recent)
  // a render in progress: its file is in place, its meta is not written yet
  await rm(join(dir, `${FRESH}.json`))
  const now = new Date(NOW - 60_000)
  await utimes(join(dir, `${FRESH}.mov`), now, now)
  expect(await clean()).toEqual({ trashed: 2, blockedBy: null, kept: "recent" })
  expect(trashed.filter((path) => path.endsWith(".mov")).sort()).toEqual([join(dir, `${GONE}.mov`), join(dir, `${OTHER}.mov`)].sort())
  // once ten minutes have gone by it goes too (the stand-in Trash leaves the others where they were); the one in the making still stays
  trashed.length = 0
  expect(await clean({ now: () => NOW + 60_000 })).toEqual({ trashed: 3, blockedBy: null, kept: "recent" })
  expect(trashed.filter((path) => path.endsWith(".mov")).sort()).toEqual([join(dir, `${GONE}.mov`), join(dir, `${OTHER}.mov`), join(dir, `${USED}.mov`)].sort())
  // a recent file a draft uses is no file kept back
  const used = await setup([USED])
  await utimes(join(used.dir, `${USED}.mov`), recent, recent)
  await draft(used.drafts, "0917", using(join(used.dir, `${USED}.mov`)))
  expect(await used.clean()).toEqual({ trashed: 0, blockedBy: null, kept: null })
})

test("while a render or a write is under way nothing is trashed, and a clean that finds one on the way stops there", async () => {
  const { dir, drafts, trashed, clean } = await setup([GONE, OTHER])
  await draft(drafts, "0917", using())
  expect(await clean({ busy: () => true })).toEqual({ trashed: 0, blockedBy: { kind: "busy" }, kept: null })
  expect(trashed).toEqual([])
  // a write that started while the drafts were being read: what it is about to write is in no draft yet
  let asked = 0
  expect(await clean({ busy: () => ++asked > 1 })).toEqual({ trashed: 0, blockedBy: { kind: "busy" }, kept: null })
  expect(trashed).toEqual([])
  // one that starts after the first file went: what went is counted, and nothing more goes
  let files = 0
  const counting = async (path: string) => {
    if (path.endsWith(".mov")) files++
    trashed.push(path)
  }
  expect(await clean({ trash: counting, busy: () => files > 0 })).toEqual({ trashed: 1, blockedBy: null, kept: "stopped" })
  const moved = trashed.filter((path) => path.endsWith(".mov"))
  expect(moved).toHaveLength(1)
  expect([join(dir, `${GONE}.mov`), join(dir, `${OTHER}.mov`)]).toContain(moved[0])
})

test("a draft that cannot be read keeps every file, and is named relative to the drafts root, or by its backup folder", async () => {
  const unreadable = [
    ["0917", "not json", true],
    ["0917", "not json", false],
    ["0917", null, true],
  ] as const
  for (const [name, info, meta] of unreadable) {
    const { drafts, trashed, clean } = await setup([GONE])
    await draft(drafts, "0918", using())
    await draft(drafts, name, info, meta)
    expect(await clean(), `${info} ${meta}`).toEqual({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "0917" }, kept: null })
    expect(trashed).toEqual([])
  }
  // a timeline copy deep in the recycle bin, named by the recycled draft, not the recycle bin folder alone
  const binned = await setup([GONE])
  await draft(binned.drafts, join(".recycle_bin", "old"), using())
  await timeline(binned.drafts, join(".recycle_bin", "old", "Timelines", "A1B2"), "not json")
  expect(await binned.clean()).toEqual({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: ".recycle_bin/old" }, kept: null })
  // a backup BOXBLACK made: named by its own folder, not the "draft" copy inside it
  const backedUp = await setup([GONE])
  await draft(backedUp.backups, join("0917-x", "draft"), using())
  await timeline(backedUp.backups, join("0917-x", "draft", "Timelines", "A1B2"), "")
  expect(await backedUp.clean()).toEqual({ trashed: 0, blockedBy: { kind: "unreadable", where: "backup", name: "0917-x" }, kept: null })
})

test("only a draft's own timelines are read: not its other folders, nor CapCut's cloud caches, nor folders deeper than drafts sit", async () => {
  const { drafts, clean } = await setup([GONE])
  await draft(drafts, "0917", using())
  // inside a draft, a cache that cannot be read or holds a broken copy is none of our business
  await timeline(drafts, join("0917", "Resources", "x"), "not json")
  const locked = join(drafts, "0917", "Resources", "locked")
  await mkdir(locked, { recursive: true })
  await chmod(locked, 0o000)
  await timeline(drafts, join(".cloud_cache_x", "0917"), "not json")
  // four folders down is as deep as a draft is looked for (…/.recycle_bin/<draft>/Timelines/<id>)
  await timeline(drafts, join("a", "b", "c", "d", "e"), "not json")
  try {
    expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  } finally {
    await chmod(locked, 0o755)
  }
  const deep = await setup([GONE])
  await timeline(deep.drafts, join("a", "b", "c", "d"), "not json")
  expect(await deep.clean()).toEqual({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "a/b/c/d" }, kept: null })
})

test("no drafts root, or one that cannot be read, trashes nothing and says so; no backups yet is fine", async () => {
  const { drafts, backups, trashed, clean } = await setup([GONE])
  expect(await clean({ draftsRoot: null })).toEqual({ trashed: 0, blockedBy: { kind: "no-drafts-root" }, kept: null })
  expect(await clean({ draftsRoot: join(drafts, "missing") })).toEqual({ trashed: 0, blockedBy: { kind: "unreadable", where: "capcut", name: "" }, kept: null })
  expect(trashed).toEqual([])
  expect(await clean({ dir: join(drafts, "no-graphics-yet") })).toEqual({ trashed: 0, blockedBy: null, kept: null })
  // the backup root does not exist until BOXBLACK first writes a draft
  expect(await clean({ backupRoot: join(backups, "never-made") })).toEqual({ trashed: 1, blockedBy: null, kept: null })
})

test("a Trash that fails trashes nothing: while the meta stays, so does the file it says is ready", async () => {
  const { dir, clean } = await setup([GONE])
  const tried: string[] = []
  const failing = async (path: string) => {
    tried.push(path)
    throw new Error("the Trash is not available")
  }
  expect(await clean({ trash: failing })).toEqual({ trashed: 0, blockedBy: null, kept: null })
  expect(tried).toEqual([join(dir, `${GONE}.json`)])
  // the meta went but the file did not: not counted, and its poster is left with it
  const moved: string[] = []
  const movFails = async (path: string) => {
    if (path.endsWith(".mov")) throw new Error("the Trash is not available")
    moved.push(path)
  }
  expect(await clean({ trash: movFails })).toEqual({ trashed: 0, blockedBy: null, kept: null })
  expect(moved).toEqual([join(dir, `${GONE}.json`)])
})

/* composed sounds */

test("the count covers the composed sounds too: only their kept files, not a render's temporary ones nor anything else there", async () => {
  const { dir, soundsDir } = await setup([USED], [GONE, OTHER])
  await writeFile(join(soundsDir, `${USED}.raw.wav`), "x".repeat(70))
  await writeFile(join(soundsDir, `${USED}.wav.tmp`), "x".repeat(70))
  await writeFile(join(soundsDir, "mine.wav"), "x".repeat(70))
  expect(await graphicFilesInfo(dir, soundsDir)).toEqual({ count: 3, bytes: 1600 })
  // no sounds folder yet, or none asked about: the graphics alone
  expect(await graphicFilesInfo(dir, join(soundsDir, "none-yet"))).toEqual({ count: 1, bytes: 1000 })
  expect(await graphicFilesInfo(dir)).toEqual({ count: 1, bytes: 1000 })
})

test("a composed sound no draft or backup names goes to the Trash on its own; one a draft or a backup names stays", async () => {
  const BACKED = "77777777777777aa"
  const { soundsDir, drafts, backups, trashed, clean } = await setup([], [USED, GONE, BACKED])
  // not a name the renderer gives a sound: left alone
  await aged(join(soundsDir, "mine.wav"), "x")
  // a draft names a sound by its path, under whatever folder and case
  await draft(drafts, "0917", JSON.stringify({ materials: { audios: [{ path: `/Users/Me/Movies/CapCut/BOXBLACK/sounds/${USED.toUpperCase()}.wav`, name: `${USED}.wav` }] } }))
  await draft(backups, join("0917-x", "draft"), JSON.stringify({ materials: { audios: [{ path: join(soundsDir, `${BACKED}.wav`) }] } }))
  expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(trashed).toEqual([join(soundsDir, `${GONE}.wav`)])
})

test("a composed sound made in the last ten minutes stays, and the result says so", async () => {
  const { soundsDir, drafts, trashed, clean } = await setup([], [GONE, USED])
  await draft(drafts, "0917", using())
  const recent = new Date(NOW - 9 * 60_000)
  await utimes(join(soundsDir, `${USED}.wav`), recent, recent)
  expect(await clean()).toEqual({ trashed: 1, blockedBy: null, kept: "recent" })
  expect(trashed).toEqual([join(soundsDir, `${GONE}.wav`)])
})

test("a render's temporary files a crash left behind go once settled; recent ones stay, and a draft never keeps them", async () => {
  const { soundsDir, drafts, trashed, clean } = await setup([], [])
  await aged(join(soundsDir, `${GONE}.raw.wav`), "x")
  await aged(join(soundsDir, `${GONE}.wav.tmp`), "x")
  // a render under way in another sense: the renderer is idle (the clean is not busy), but these were made a minute ago
  await writeFile(join(soundsDir, `${OTHER}.raw.wav`), "x")
  await writeFile(join(soundsDir, `${OTHER}.wav.tmp`), "x")
  // a temporary name in a draft is no sound it plays
  await draft(drafts, "0917", JSON.stringify({ materials: { audios: [{ path: join(soundsDir, `${GONE}.raw.wav`) }] } }))
  expect(await clean()).toEqual({ trashed: 2, blockedBy: null, kept: "recent" })
  expect(trashed.sort()).toEqual([join(soundsDir, `${GONE}.raw.wav`), join(soundsDir, `${GONE}.wav.tmp`)].sort())
})

test("while busy no sound goes either, and without a sounds folder only the graphics are looked at", async () => {
  const { soundsDir, drafts, trashed, clean } = await setup([GONE], [GONE])
  await aged(join(soundsDir, `${OTHER}.raw.wav`), "x")
  await draft(drafts, "0917", using())
  expect(await clean({ busy: () => true })).toEqual({ trashed: 0, blockedBy: { kind: "busy" }, kept: null })
  expect(trashed).toEqual([])
  expect(await clean({ soundsDir: undefined })).toEqual({ trashed: 1, blockedBy: null, kept: null })
  expect(trashed.every((path) => !path.startsWith(soundsDir))).toBe(true)
  // a sounds folder not made yet is no reason to stop (the stand-in Trash left the graphic where it was)
  expect(await clean({ soundsDir: join(soundsDir, "none-yet") })).toEqual({ trashed: 1, blockedBy: null, kept: null })
})

test("a write that starts partway through the sounds stops the clean there, counting what went", async () => {
  const { soundsDir, drafts, trashed, clean } = await setup([], [GONE, OTHER])
  await draft(drafts, "0917", using())
  let files = 0
  const counting = async (path: string) => {
    files++
    trashed.push(path)
  }
  expect(await clean({ trash: counting, busy: () => files > 0 })).toEqual({ trashed: 1, blockedBy: null, kept: "stopped" })
  expect(trashed).toHaveLength(1)
  expect([join(soundsDir, `${GONE}.wav`), join(soundsDir, `${OTHER}.wav`)]).toContain(trashed[0])
})
