import { z } from "zod"

/** JSON Schema for a reply format; the `$schema` marker zod adds is not part of what the API takes. */
export function replySchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return rest
}
