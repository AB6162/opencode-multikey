import { describe, expect, test } from "bun:test"
import { redact, redactBody, truncate } from "../src/core/redact"

describe("redact", () => {
  test("removes OpenCode and generic API keys", () => {
    const value =
      "key=oc_sk_1234567890abcdef and sk-proj-abcdefghijklmnop and Bearer abcdefghijklmnop"
    const result = redact(value)
    expect(result).not.toContain("oc_sk_1234567890abcdef")
    expect(result).not.toContain("sk-proj-abcdefghijklmnop")
    expect(result).not.toContain("Bearer abcdefghijklmnop")
    expect(result).toContain("[redacted]")
  })

  test("redacts authorization fields in JSON", () => {
    const result = redact('{"authorization":"secret-value","api_key":"another"}')
    expect(result).not.toContain("secret-value")
    expect(result).not.toContain("another")
  })

  test("truncates long bodies", () => {
    const result = redactBody("x".repeat(5_000), 100)
    expect(result.length).toBeLessThanOrEqual(101)
    expect(result.endsWith("…")).toBe(true)
  })

  test("truncate handles non-finite limits", () => {
    expect(truncate("hello", Number.POSITIVE_INFINITY)).toBe("hello")
  })
})
