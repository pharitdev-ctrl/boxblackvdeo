import { expect, test } from "vitest"
import { clientIp } from "./http.ts"

test("the caller's address is the first forwarded one", () => {
  expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7")
  expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2")
  expect(clientIp(new Headers())).toBe("unknown")
})
