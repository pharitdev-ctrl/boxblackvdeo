// Backs up, restores and compares draft 0917 only (the one draft the user allows us to write).
//   node draft-backup.mts backup <label>   copies the draft folder and its root_meta entry into backups/<label>
//   node draft-backup.mts restore <label>  moves the current folder to the Trash, then copies the backup back and puts the entry back
//   node draft-backup.mts check <label>    compares the draft folder and its entry with the backup
// Refuses to restore while CapCut runs. Never deletes: what it replaces goes to ~/.Trash.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const DRAFTS = join(homedir(), "Movies/CapCut/User Data/Projects/com.lveditor.draft")
const NAME = "0917"
const DRAFT = join(DRAFTS, NAME)
const ROOT = join(DRAFTS, "root_meta_info.json")
const HERE = new URL(".", import.meta.url).pathname
const [cmd, label] = process.argv.slice(2)
if (!cmd || !label) throw new Error("usage: backup|restore|check <label>")
const dir = join(HERE, "backups", label)

const entryOf = (root: { all_draft_store: { draft_fold_path: string }[] }) => root.all_draft_store.find((e) => e.draft_fold_path === DRAFT || e.draft_fold_path.endsWith(`/${NAME}`))
const readRoot = () => JSON.parse(readFileSync(ROOT, "utf8"))
const capcutRunning = () => {
  try { execFileSync("pgrep", ["-x", "CapCut"]); return true } catch { return false }
}

if (cmd === "backup") {
  if (existsSync(dir)) throw new Error(`backup ${label} exists already`)
  mkdirSync(dir, { recursive: true })
  execFileSync("cp", ["-Rp", DRAFT, join(dir, NAME)])
  writeFileSync(join(dir, "entry.json"), JSON.stringify(entryOf(readRoot()) ?? null, null, 1))
  copyFileSync(ROOT, join(dir, "root_meta_info.json"))
  console.log(`backed up ${DRAFT} to ${dir}`)
} else if (cmd === "restore") {
  if (capcutRunning()) throw new Error("CapCut is running: ask the user to close it first")
  if (!existsSync(join(dir, NAME))) throw new Error(`no backup ${label}`)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  renameSync(DRAFT, join(homedir(), ".Trash", `${NAME}-before-restore-${stamp}`))
  execFileSync("cp", ["-Rp", join(dir, NAME), DRAFT])
  const saved = JSON.parse(readFileSync(join(dir, "entry.json"), "utf8"))
  const root = readRoot()
  copyFileSync(ROOT, join(homedir(), ".Trash", `root_meta_info-before-restore-${stamp}.json`))
  const at = root.all_draft_store.findIndex((e: { draft_fold_path: string }) => e === entryOf(root))
  if (saved && at >= 0) root.all_draft_store[at] = saved
  writeFileSync(ROOT, JSON.stringify(root))
  console.log(`restored ${DRAFT} from ${dir}`)
} else if (cmd === "check") {
  let same = true
  try { execFileSync("diff", ["-rq", join(dir, NAME), DRAFT], { stdio: "pipe" }); console.log("folder: identical") } catch (e) {
    same = false; console.log("folder: DIFFERENT\n" + String((e as { stdout?: Buffer }).stdout ?? ""))
  }
  const now = JSON.stringify(entryOf(readRoot()) ?? null)
  const then = JSON.stringify(JSON.parse(readFileSync(join(dir, "entry.json"), "utf8")))
  console.log(now === then ? "root_meta entry: identical" : "root_meta entry: DIFFERENT")
  if (!same || now !== then) process.exitCode = 1
} else throw new Error(`unknown command ${cmd}`)
