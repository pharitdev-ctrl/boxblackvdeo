/** Reads a password from stdin and prints its hash for ADMIN_PASSWORD_HASH: printf '%s' 'password' | node apps/server/scripts/hash-password.ts */
import { hashPassword } from "../src/lib/admin-auth.ts"

let input = ""
for await (const chunk of process.stdin) input += chunk
const password = input.replace(/\r?\n$/, "")
if (password.length < 12) throw new Error("use a password of at least 12 characters")
console.log(await hashPassword(password))
