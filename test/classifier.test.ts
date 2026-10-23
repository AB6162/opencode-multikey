import { describe, expect, test } from "bun:test"
import { parseOptions } from "../src/config"
import { classifyFailure, detectQuotaWindow } from "../src/core/classifier"

const parsed = parseOptions({})
const patterns = parsed.options.patterns
const cooldowns = parsed.settings.cooldowns
const now = 1_800_000_000_000

describe("quota window detection", () => {
  test("detects five-hour, weekly and monthly text", () => {
    expect(detectQuotaWindow("5-hour usage limit reached", patterns)).toBe("five_hour")
    expect(detectQuotaWindow("five hour limit", patterns)).toBe("five_hour")
    expect(detectQuotaWindow("weekly usage limit reached", patterns)).toBe("weekly")
    expect(detectQuotaWindow("monthly usage limit reached", patterns)).toBe("monthly")
    expect(detectQuotaWindow("insufficient balance", patterns)).toBe("billing")
    expect(detectQuotaWindow("something else", patterns)).toBeUndefined()
  })
})

describe("classifyFailure", () => {
  test("classifies a five-hour Go quota error", () => {
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: "5-hour usage limit reached. Resets at 2026-10-23T18:00:00Z",
        response: {
          body: '{"error":{"type":"GoUsageLimitError","message":"5-hour usage limit reached"}}',
        },
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind !== "model") throw new Error("expected model classification")
    expect(result.reason).toBe("five_hour")
    expect(result.until).toBeGreaterThan(now)
  })

  test("classifies weekly and monthly Go quota errors", () => {
    const weekly = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: "Weekly usage limit reached",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(weekly?.kind).toBe("model")
    if (weekly?.kind === "model") expect(weekly.reason).toBe("weekly")

    const monthly = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: "Monthly usage limit reached",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(monthly?.kind).toBe("model")
    if (monthly?.kind === "model") expect(monthly.reason).toBe("monthly")
  })

  test("falls back to the unknown quota window", () => {
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: "GoUsageLimitError",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind !== "model") throw new Error("expected model classification")
    expect(result.reason).toBe("unknown")
    expect(result.until).toBe(now + cooldowns.quotaUnknownMs)
  })

  test("classifies billing errors", () => {
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 402,
        message: "Insufficient balance. Top up your account.",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind === "model") expect(result.reason).toBe("billing")
  })

  test("classifies rate limits with retry-after", () => {
    const result = classifyFailure({
      error: {
        type: "provider.rate-limit",
        status: 429,
        message: "Rate limit exceeded",
        retryAfterMs: 30_000,
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result).toEqual({
      kind: "account",
      reason: "rate-limit",
      until: now + 30_000,
      message: "Rate limit exceeded",
    })
  })

  test("classifies server errors and auth errors", () => {
    const server = classifyFailure({
      error: {
        type: "provider.internal",
        status: 503,
        message: "Service unavailable",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(server?.kind).toBe("account")
    if (server?.kind === "account") {
      expect(server.reason).toBe("server-error")
      expect(server.until).toBe(now + cooldowns.serverErrorMs)
    }

    const auth = classifyFailure({
      error: { type: "provider.auth", status: 401, message: "Invalid API key" },
      now,
      cooldowns,
      patterns,
    })
    expect(auth).toEqual({ kind: "auth", message: "Invalid API key" })
  })

  test("does not fail over a content-policy 403", () => {
    const result = classifyFailure({
      error: {
        type: "provider.content-filter",
        status: 403,
        message: "Request blocked by content policy",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result).toBeUndefined()
  })

  test("classifies an auth 403", () => {
    const result = classifyFailure({
      error: { type: "provider.auth", status: 403, message: "Forbidden" },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("auth")
  })

  test("does not fail over deterministic request errors", () => {
    const result = classifyFailure({
      error: {
        type: "provider.invalid-request",
        status: 400,
        message: "Invalid request",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result).toBeUndefined()
  })

  test("uses retry-after duration to infer the weekly window", () => {
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: "usage limit reached",
        retryAfterMs: 7 * 24 * 60 * 60 * 1000,
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind === "model") expect(result.reason).toBe("weekly")
  })

  test("uses a reset timestamp from the error message", () => {
    const reset = new Date(now + 2 * 60 * 60 * 1000).toISOString()
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: `5-hour usage limit reached. Resets at ${reset}`,
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind === "model") expect(result.until).toBe(Date.parse(reset))
  })

  test("uses an epoch reset field", () => {
    const reset = Math.floor((now + 3 * 60 * 60 * 1000) / 1000)
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: `usage limit reached {"resets_at":${reset}}`,
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind === "model") expect(result.until).toBe(reset * 1000)
  })

  test("uses a relative reset duration", () => {
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: "weekly usage limit reached. Resets in 2h",
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind === "model") expect(result.until).toBe(now + 2 * 60 * 60 * 1000)
  })

  test("uses the later of retry-after and the reset timestamp", () => {
    const reset = new Date(now + 2 * 60 * 60 * 1000).toISOString()
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: `5-hour usage limit reached. Resets at ${reset}`,
        retryAfterMs: 3 * 60 * 60 * 1000,
      },
      now,
      cooldowns,
      patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind === "model") expect(result.until).toBe(now + 3 * 60 * 60 * 1000)
  })

  test("supports custom quota patterns", () => {
    const custom = parseOptions({
      quotaPatterns: { fiveHour: ["custom-five"] },
    })
    const result = classifyFailure({
      error: {
        type: "provider.quota",
        status: 429,
        message: "custom-five limit reached",
      },
      now,
      cooldowns: custom.settings.cooldowns,
      patterns: custom.options.patterns,
    })
    expect(result?.kind).toBe("model")
    if (result?.kind === "model") expect(result.reason).toBe("five_hour")
  })
})
