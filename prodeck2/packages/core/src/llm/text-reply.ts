import { z } from "zod"

/**
 * The schema of a reply that is plain text and not data: a transport given this very schema asks for no JSON and returns what Claude wrote, as it is.
 *
 * It has a module of its own, apart from the other names a request is made of (types.ts), because making it loads
 * zod: types.ts is where the renderer takes the list of models from, and takes zod as a type only, so that none
 * of zod can reach the renderer's bundle.
 */
export const TEXT_REPLY: z.ZodType<string> = z.string()
