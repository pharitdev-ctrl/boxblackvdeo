import type { ApiDeps, ApiResult } from "./api.ts"
import { database } from "./database.ts"
import { serverEnv } from "./env.ts"

/**
 * The caller's address for rate limiting. Behind Vercel the first x-forwarded-for entry is
 * set by the platform; a self-hosted proxy must overwrite the header, not append to it.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown"
}

type Handler = (deps: ApiDeps, body: unknown, ip: string) => Promise<ApiResult>

const noStore = { "cache-control": "no-store" }

/** A JSON POST endpoint of the license API. */
export function licenseRoute(handler: Handler) {
  return async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: "bad-request" }, { status: 400, headers: noStore })
    }
    try {
      const deps: ApiDeps = { db: await database(), signingKey: serverEnv().signingKey, now: Date.now }
      const result = await handler(deps, body, clientIp(request.headers))
      return Response.json(result.body, { status: result.status, headers: noStore })
    } catch (error) {
      console.error("license api failed", error)
      return Response.json({ error: "server-error" }, { status: 500, headers: noStore })
    }
  }
}
