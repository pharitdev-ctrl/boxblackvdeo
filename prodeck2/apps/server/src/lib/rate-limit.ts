import type { Db } from "./db.ts"

/** Counts a request against a bucket; false once `limit` requests fell inside the last `windowMs`. Refused requests are not counted. */
export async function allow(db: Db, bucket: string, options: { limit: number; windowMs: number; now: number }): Promise<boolean> {
  const since = new Date(options.now - options.windowMs)
  await db.query("delete from rate_events where bucket = $1 and at < $2", [bucket, since])
  const [row] = await db.query<{ count: number }>("select count(*)::int as count from rate_events where bucket = $1 and at >= $2", [bucket, since])
  if ((row?.count ?? 0) >= options.limit) return false
  await db.query("insert into rate_events (bucket, at) values ($1, $2)", [bucket, new Date(options.now)])
  return true
}
