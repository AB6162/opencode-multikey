import { describe, expect, test } from "bun:test"
import {
  applyAuth,
  clampRetryAfter,
  isFailoverStatus,
  parseRetryAfter,
} from "../src/core/auth"

describe("applyAuth", () => {
  test("sets bearer auth and removes conflicting api-key headers", () => {
    const headers = new Headers({
      authorization: "Bearer old",
      "x-api-key": "old",
      "api-key": "old",
    })
    applyAuth(headers, "new-key", "bearer")
    expect(headers.get("authorization")).toBe("Bearer new-key")
    expect(headers.get("x-api-key")).toBeNull()
    expect(headers.get("api-key")).toBeNull()
  })

  test("auto mode replaces existing auth headers", () => {
    const headers = new Headers({ "x-api-key": "old" })
    applyAuth(headers, "new-key", "auto")
    expect(headers.get("x-api-key")).toBe("new-key")
    expect(headers.get("authorization")).toBeNull()
  })

  test("auto mode falls back to bearer", () => {
    const headers = new Headers()
    applyAuth(headers, "new-key", "auto")
    expect(headers.get("authorization")).toBe("Bearer new-key")
  })
})

describe("parseRetryAfter", () => {
  test("parses seconds", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "30" }))).toBe(30_000)
  })

  test("parses HTTP dates", () => {
    const date = new Date(Date.now() + 10_000).toUTCString()
    const value = parseRetryAfter(new Headers({ "retry-after": date }))
    expect(value).toBeGreaterThan(5_000)
    expect(value).toBeLessThanOrEqual(10_000)
  })

  test("returns undefined for invalid values", () => {
    expect(parseRetryAfter(new Headers())).toBeUndefined()
    expect(parseRetryAfter(new Headers({ "retry-after": "nonsense" }))).toBeUndefined()
  })

  test("clamps retry-after", () => {
    expect(clampRetryAfter(0)).toBe(1_000)
    expect(clampRetryAfter(-1)).toBeUndefined()
    expect(clampRetryAfter(31 * 24 * 60 * 60 * 1000 + 1)).toBe(
      31 * 24 * 60 * 60 * 1000,
    )
  })
})

describe("failover statuses", () => {
  test("includes the documented statuses", () => {
    for (const status of [401, 402, 403, 429, 500, 502, 503, 504, 529]) {
      expect(isFailoverStatus(status)).toBe(true)
    }
    expect(isFailoverStatus(400)).toBe(false)
    expect(isFailoverStatus(200)).toBe(false)
  })
})
