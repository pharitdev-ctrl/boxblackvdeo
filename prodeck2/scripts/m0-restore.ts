/**
 * Undo an M0 spike write:  node scripts/m0-restore.ts <backupDir>
 * The draft folder being replaced is kept inside the backup dir as replaced-<time>.
 */
import { restoreDraft } from "../packages/core/src/capcut/index.ts"

const backupDir = process.argv[2]
if (!backupDir) throw new Error("usage: node scripts/m0-restore.ts <backupDir>")
await restoreDraft(backupDir)
console.log(`restored from ${backupDir}`)
