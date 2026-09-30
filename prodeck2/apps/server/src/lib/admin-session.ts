import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createSession, verifySession } from "./admin-auth.ts"
import { serverEnv } from "./env.ts"

const COOKIE = "pd2_admin"

export async function isAdmin(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE)?.value
  return verifySession(value, serverEnv().sessionSecret, Date.now())
}

/** Every admin page and every admin action calls this; actions are reachable by direct POST, not only through the pages. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login")
}

export async function startSession(): Promise<void> {
  const env = serverEnv()
  ;(await cookies()).set(COOKIE, createSession(env.sessionSecret, Date.now()), {
    httpOnly: true,
    secure: env.production,
    sameSite: "strict",
    path: "/admin",
    maxAge: 12 * 3600,
  })
}

export async function endSession(): Promise<void> {
  ;(await cookies()).delete({ name: COOKIE, path: "/admin" })
}
