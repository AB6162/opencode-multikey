import { clampRetryAfter } from "./auth"
import { redact, truncate } from "./redact"
import type {
  Classification,
  CooldownSettings,
  CompiledPatterns,
  FailureError,
  QuotaWindow,
} from "../types"

const FIVE_HOURS = 5 * 60 * 60 * 1000
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
const MAX_COOLDOWN = 31 * 24 * 60 * 60 * 1000

export function detectQuotaWindow(
  text: string,
  patterns: CompiledPatterns,
): QuotaWindow | undefined {
  if (patterns.fiveHour.some((pattern) => pattern.test(text))) return "five_hour"
  if (patterns.weekly.some((pattern) => pattern.test(text))) return "weekly"
  if (patterns.monthly.some((pattern) => pattern.test(text))) return "monthly"
  if (patterns.billing.some((pattern) => pattern.test(text))) return "billing"
  return undefined
}

export function windowFromDuration(ms: number | undefined): QuotaWindow | undefined {
  if (ms === undefined) return undefined
  const hours = ms / (60 * 60 * 1000)
  if (hours >= 4 && hours <= 8) return "five_hour"
  const days = hours / 24
  if (days >= 6 && days <= 8) return "weekly"
  if (days >= 25 && days <= 31) return "monthly"
  return undefined
}

function defaultDuration(window: QuotaWindow, cooldowns: CooldownSettings): number {
  switch (window) {
    case "five_hour":
      return FIVE_HOURS
    case "weekly":
      return SEVEN_DAYS
    case "monthly":
      return THIRTY_DAYS
    case "billing":
      return cooldowns.billingMs
    case "unknown":
      return cooldowns.quotaUnknownMs
  }
}

function messageOf(error: FailureError, maxLength = 500): string {
  return truncate(redact(error.message), maxLength)
}

function looksLikeQuota(text: string): boolean {
  return /usage limit|quota|limit exhausted|usage_not_included|gousagelimiterror|freeusagelimiterror/i.test(
    text,
  )
}

function futureWithin(ms: number, now: number): number | undefined {
  if (!Number.isFinite(ms)) return undefined
  const delta = ms - now
  if (delta <= 0) return undefined
  return delta > MAX_COOLDOWN ? now + MAX_COOLDOWN : ms
}

/**
 * Extract a reset timestamp from a provider message. OpenCode Go messages have
 * been observed to include a human-readable "Resets at ..." timestamp, but the
 * exact wording is provider/version dependent, so this is best effort.
 */
export function parseResetAt(text: string, now: number): number | undefined {
  const iso = text.match(
    /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/,
  )
  if (iso) {
    const parsed = futureWithin(Date.parse(iso[1]), now)
    if (parsed !== undefined) return parsed
  }

  const epoch = text.match(
    /(?:resets?[_-]?(?:at|in)|resetAt|reset_at)["']?\s*[:=]\s*["']?(\d{10,13})/i,
  )
  if (epoch) {
    const raw = Number(epoch[1])
    const parsed = futureWithin(raw > 1_000_000_000_000 ? raw : raw * 1000, now)
    if (parsed !== undefined) return parsed
  }

  const relative = text.match(
    /resets?\s+in\s+(\d+)\s*(d|day|days|h|hour|hours|m|min|minute|minutes)\b/i,
  )
  if (relative) {
    const amount = Number(relative[1])
    const unit = relative[2].toLowerCase()
    const factor = unit.startsWith("d")
      ? 24 * 60 * 60 * 1000
      : unit.startsWith("h")
        ? 60 * 60 * 1000
        : 60 * 1000
    const parsed = futureWithin(now + amount * factor, now)
    if (parsed !== undefined) return parsed
  }

  return undefined
}

export function classifyFailure(input: {
  error: FailureError
  now: number
  cooldowns: CooldownSettings
  patterns: CompiledPatterns
}): Classification | undefined {
  const { error, now, cooldowns, patterns } = input
  const status = error.status
  const retryAfter = clampRetryAfter(error.retryAfterMs)
  const text = truncate(
    `${error.message}\n${error.response?.body ?? ""}`,
    16_384,
  )
  const message = messageOf(error)

  if (error.type === "provider.auth" || status === 401) {
    return { kind: "auth", message }
  }

  const quota =
    error.type === "provider.quota" ||
    status === 402 ||
    (status === 429 && (detectQuotaWindow(text, patterns) !== undefined || looksLikeQuota(text)))

  if (quota) {
    const window =
      detectQuotaWindow(text, patterns) ??
      windowFromDuration(retryAfter) ??
      (status === 402 ? "billing" : "unknown")
    const resetAt = parseResetAt(text, now)
    const retryUntil = retryAfter === undefined ? undefined : now + retryAfter
    const until =
      resetAt !== undefined && retryUntil !== undefined
        ? Math.max(resetAt, retryUntil)
        : (resetAt ?? retryUntil ?? now + defaultDuration(window, cooldowns))
    return { kind: "model", reason: window, until, message }
  }

  if (error.type === "provider.rate-limit" || status === 429) {
    const resetAt = parseResetAt(text, now)
    const until =
      resetAt ?? now + (retryAfter ?? cooldowns.rateLimitMs)
    return { kind: "account", reason: "rate-limit", until, message }
  }

  if (
    (error.type === "provider.internal" && (status === undefined || status >= 500)) ||
    (status !== undefined && status >= 500)
  ) {
    const until = now + cooldowns.serverErrorMs
    return { kind: "account", reason: "server-error", until, message }
  }

  return undefined
}
