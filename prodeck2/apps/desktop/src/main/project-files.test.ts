import { expect, test, vi } from "vitest"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProjectFiles } from "./project-files.ts"

interface Note {
  folder: string
  marks: string[]
}

test("changes made at the same moment are made one after another, each on what the last one wrote", async () => {
  const files = new ProjectFiles<Note>(await mkdtemp(join(tmpdir(), "boxblack-project-files-")))
  await files.put({ folder: "/drafts/0917", marks: [] })
  const slow = files.update("/drafts/0917", async (current) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    return { ...current!, marks: [...current!.marks, "slow"] }
  })
  const quick = files.update("/drafts/0917", (current) => ({ ...current!, marks: [...current!.marks, "quick"] }))
  await Promise.all([slow, quick])
  expect((await files.get("/drafts/0917"))!.marks).toEqual(["slow", "quick"])
})

test("a change that fails writes nothing and does not hold up the next one", async () => {
  const files = new ProjectFiles<Note>(await mkdtemp(join(tmpdir(), "boxblack-project-files-")))
  await files.put({ folder: "/drafts/0917", marks: ["kept"] })
  // the next change is already waiting when the first one fails
  const failing = files.update("/drafts/0917", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    throw new Error("unknown highlight group g9")
  })
  const next = files.update("/drafts/0917", (current) => ({ ...current!, marks: [...current!.marks, "next"] }))
  await expect(failing).rejects.toThrow("unknown highlight group g9")
  await next
  expect((await files.get("/drafts/0917"))!.marks).toEqual(["kept", "next"])
})

interface Versioned extends Note {
  version?: number
}

/** Brings a note up to version 2 once; a note at 2 is handed back as it is. */
const upgrade = (value: Versioned): Versioned => (value.version === 2 ? value : { ...value, marks: [...value.marks, "upgraded"], version: 2 })

async function stores() {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-project-files-"))
  return { plain: new ProjectFiles<Versioned>(dir), files: new ProjectFiles<Versioned>(dir, { steps: [{ upgrade }] }) }
}

test("an old file is brought up to date when it is read, and written back once", async () => {
  const { plain, files } = await stores()
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  expect(await files.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "upgraded"], version: 2 })
  // on disk now, so a store that upgrades nothing reads it up to date too
  expect(await plain.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "upgraded"], version: 2 })
  // read again it is up to date: the upgrade hands back the same object and nothing is written
  const put = vi.spyOn(files, "put")
  expect((await files.get("/drafts/0917"))!.marks).toEqual(["old", "upgraded"])
  expect(put).not.toHaveBeenCalled()
  expect(await files.get("/drafts/other")).toBeNull()
})

test("an upgrade written back waits for a change already going, and keeps what that change wrote", async () => {
  const { plain, files } = await stores()
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  const slow = files.update("/drafts/0917", async (current) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    return { ...current!, marks: [...current!.marks, "slow"] }
  })
  const read = files.get("/drafts/0917")
  await slow
  expect((await read)!.marks).toEqual(["old", "upgraded", "slow"])
  expect((await plain.get("/drafts/0917"))!.marks).toEqual(["old", "upgraded", "slow"])
})

test("a change is handed the file brought up to date", async () => {
  const { plain, files } = await stores()
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  await files.update("/drafts/0917", (current) => ({ ...current!, marks: [...current!.marks, "changed"] }))
  expect(await plain.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "upgraded", "changed"], version: 2 })
})

test("every file read at once is brought up to date in memory only", async () => {
  const { plain, files } = await stores()
  await plain.put({ folder: "/drafts/0917", marks: [] })
  expect((await files.all()).map((note) => [note.folder, note.version])).toEqual([["/drafts/0917", 2]])
  expect((await plain.get("/drafts/0917"))!.version).toBeUndefined()
})

test("an old file whose upgrade cannot be written back is still handed out up to date", async () => {
  const { plain, files } = await stores()
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  // a full disk or a folder that cannot be written
  vi.spyOn(files, "put").mockRejectedValueOnce(new Error("disk full"))
  expect(await files.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "upgraded"], version: 2 })
  // nothing was written, so the next read brings it up to date again
  expect((await plain.get("/drafts/0917"))!.version).toBeUndefined()
})

test("an upgrade that fails on a file leaves it as it is: read, listed and changed as it is, and tried again next time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-project-files-"))
  const plain = new ProjectFiles<Versioned>(dir)
  let broken = true
  const files = new ProjectFiles<Versioned>(dir, {
    steps: [
      {
        upgrade: (value) => {
          if (broken) throw new Error("a file of a shape the upgrade does not know")
          return upgrade(value)
        },
      },
    ],
  })
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  expect(await files.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old"] })
  expect(await files.all()).toEqual([{ folder: "/drafts/0917", marks: ["old"] }])
  await files.update("/drafts/0917", (current) => ({ ...current!, marks: [...current!.marks, "changed"] }))
  // nothing marked it up to date, so the upgrade runs once it can
  expect(await plain.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "changed"] })
  broken = false
  expect((await files.get("/drafts/0917"))!.version).toBe(2)
})

/** A store that keeps a copy of each old file in `backupDir` before it first writes it back up to date. */
async function backedUp(backupDir?: string) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-project-files-"))
  const backups = backupDir ?? join(await mkdtemp(join(tmpdir(), "boxblack-project-files-")), "before-upgrade")
  return { dir, backups, plain: new ProjectFiles<Versioned>(dir), files: new ProjectFiles<Versioned>(dir, { steps: [{ upgrade, backupDir: backups }] }) }
}

test("an old file is copied as it was into the backup folder before it is first written back, and that copy is never written over", async () => {
  const { dir, backups, plain, files } = await backedUp()
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  const [name] = await readdir(dir)
  const original = await readFile(join(dir, name!), "utf8")
  await files.get("/drafts/0917")
  expect(await readFile(join(backups, name!), "utf8")).toBe(original)
  expect((await plain.get("/drafts/0917"))!.version).toBe(2)
  // an old file there again (put back by hand) is brought up to date again, but the first copy stays as it was
  await plain.put({ folder: "/drafts/0917", marks: ["put back"] })
  expect((await files.get("/drafts/0917"))!.marks).toEqual(["put back", "upgraded"])
  expect(await readFile(join(backups, name!), "utf8")).toBe(original)
  // and the copy already there does not hold the write-back up
  expect((await plain.get("/drafts/0917"))!.version).toBe(2)
  // a file up to date is never copied, read or changed, and a change to an old file keeps a copy too
  await plain.put({ folder: "/drafts/new", marks: [], version: 2 })
  await files.get("/drafts/new")
  await files.update("/drafts/new", (current) => ({ ...current!, marks: ["changed"] }))
  await plain.put({ folder: "/drafts/0815", marks: ["old"] })
  await files.update("/drafts/0815", (current) => current!)
  expect((await readdir(backups)).length).toBe(2)
})

test("a part-copy a crash left behind is not taken for the copy: the whole copy is made in its place", async () => {
  const { dir, backups, plain, files } = await backedUp()
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  const [name] = await readdir(dir)
  const original = await readFile(join(dir, name!), "utf8")
  // what a copy cut short leaves: the start of the file, under the name a copy is made under before it is moved into place
  await mkdir(backups, { recursive: true })
  await writeFile(join(backups, `${name}.part`), original.slice(0, 10))
  await files.get("/drafts/0917")
  expect(await readdir(backups)).toEqual([name])
  expect(await readFile(join(backups, name!), "utf8")).toBe(original)
  expect((await plain.get("/drafts/0917"))!.version).toBe(2)
})

test("an old file whose copy cannot be kept is not written back, but is still handed out up to date", async () => {
  const blocked = join(await mkdtemp(join(tmpdir(), "boxblack-project-files-")), "a-file")
  await writeFile(blocked, "")
  // the backup folder's place holds a file, so no copy can go there
  const { dir, plain, files } = await backedUp(blocked)
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  const [name] = await readdir(dir)
  const original = await readFile(join(dir, name!), "utf8")
  expect(await files.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "upgraded"], version: 2 })
  expect(await readFile(join(dir, name!), "utf8")).toBe(original)
})

/** Two upgrades in a row, as two releases each bring one: a note with no version goes to 1, and one at 1 goes to 2. */
const toOne = (value: Versioned): Versioned => (value.version === undefined ? { ...value, marks: [...value.marks, "one"], version: 1 } : value)
const toTwo = (value: Versioned): Versioned => (value.version === 1 ? { ...value, marks: [...value.marks, "two"], version: 2 } : value)

/** A store that brings a note up to date in two steps, each with a backup folder of its own, neither made yet. */
async function stepped(second: (value: Versioned) => Versioned = toTwo) {
  const dir = await mkdtemp(join(tmpdir(), "boxblack-project-files-"))
  const root = await mkdtemp(join(tmpdir(), "boxblack-project-files-"))
  const beforeOne = join(root, "before-one")
  const beforeTwo = join(root, "before-two")
  const files = new ProjectFiles<Versioned>(dir, { steps: [{ upgrade: toOne, backupDir: beforeOne }, { upgrade: second, backupDir: beforeTwo }] })
  return { dir, beforeOne, beforeTwo, plain: new ProjectFiles<Versioned>(dir), files }
}

test("upgrades run in the order given, each on what the one before gave, and the file is written back once", async () => {
  const { plain, files } = await stepped()
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  const put = vi.spyOn(files, "put")
  expect(await files.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "one", "two"], version: 2 })
  expect(put).toHaveBeenCalledTimes(1)
  expect(await plain.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old", "one", "two"], version: 2 })
  // a file the first step has nothing to do on goes through the second alone, and one up to date through neither
  await plain.put({ folder: "/drafts/0815", marks: ["newer"], version: 1 })
  expect((await files.get("/drafts/0815"))!.marks).toEqual(["newer", "two"])
  expect((await files.all()).map((note) => note.version)).toEqual([2, 2])
})

test("an old file is copied into the backup folder of the first step that changed it, and into no other", async () => {
  const { dir, beforeOne, beforeTwo, plain, files } = await stepped()
  // from before both steps: the one copy, in the first step's folder, is the way back past both
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  const [name] = await readdir(dir)
  const original = await readFile(join(dir, name!), "utf8")
  await files.get("/drafts/0917")
  expect(await readFile(join(beforeOne, name!), "utf8")).toBe(original)
  expect(await readdir(beforeTwo).catch(() => "none")).toBe("none")
  // from after the first step: copied into the second step's folder, and the first step's folder gets nothing more
  await plain.put({ folder: "/drafts/0815", marks: ["newer"], version: 1 })
  const newer = (await readdir(dir)).find((file) => file !== name)!
  const asItWas = await readFile(join(dir, newer), "utf8")
  await files.update("/drafts/0815", (current) => current!)
  expect(await readFile(join(beforeTwo, newer), "utf8")).toBe(asItWas)
  expect(await readdir(beforeOne)).toEqual([name])
  expect(await readdir(beforeTwo)).toEqual([newer])
})

test("a copy already in a step's backup folder is never written over, and a copy that cannot be kept there stops the write-back", async () => {
  const { dir, beforeTwo, plain, files } = await stepped()
  await plain.put({ folder: "/drafts/0917", marks: ["first"], version: 1 })
  const [name] = await readdir(dir)
  const first = await readFile(join(dir, name!), "utf8")
  await files.get("/drafts/0917")
  await plain.put({ folder: "/drafts/0917", marks: ["put back"], version: 1 })
  expect((await files.get("/drafts/0917"))!.marks).toEqual(["put back", "two"])
  expect(await readFile(join(beforeTwo, name!), "utf8")).toBe(first)
  // the second step's folder cannot be made where a file stands, while the first step's could be: the first step's is not used instead
  const blocked = await stepped()
  await writeFile(blocked.beforeTwo, "")
  await blocked.plain.put({ folder: "/drafts/0917", marks: ["kept"], version: 1 })
  const asItWas = await readFile(join(blocked.dir, name!), "utf8")
  expect(await blocked.files.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["kept", "two"], version: 2 })
  expect(await readFile(join(blocked.dir, name!), "utf8")).toBe(asItWas)
  expect(await readdir(blocked.beforeOne).catch(() => "none")).toBe("none")
  // a change is refused too, and writes nothing
  await expect(blocked.files.update("/drafts/0917", (current) => ({ ...current!, marks: ["changed"] }))).rejects.toThrow()
  expect(await readFile(join(blocked.dir, name!), "utf8")).toBe(asItWas)
})

test("a step that fails on a file leaves it as it is on disk, the steps before it undone too, and nothing is copied or written", async () => {
  const { dir, beforeOne, plain, files } = await stepped(() => {
    throw new Error("a file of a shape the upgrade does not know")
  })
  await plain.put({ folder: "/drafts/0917", marks: ["old"] })
  const [name] = await readdir(dir)
  const original = await readFile(join(dir, name!), "utf8")
  expect(await files.get("/drafts/0917")).toEqual({ folder: "/drafts/0917", marks: ["old"] })
  expect(await files.all()).toEqual([{ folder: "/drafts/0917", marks: ["old"] }])
  expect(await readFile(join(dir, name!), "utf8")).toBe(original)
  expect(await readdir(beforeOne).catch(() => "none")).toBe("none")
})
