import { expect, test } from "vitest"
import { readPem } from "./env.ts"

const PEM = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n"

test("a PEM key can be given with real newlines, escaped newlines, or base64-encoded", () => {
  expect(readPem(PEM)).toBe(PEM)
  expect(readPem(PEM.replaceAll("\n", "\\n"))).toBe(PEM)
  expect(readPem(Buffer.from(PEM).toString("base64"))).toBe(PEM)
})
