export const FAILOVER_STATUS = new Set([
  401, 402, 403, 429, 500, 502, 503, 504, 529,
])

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

export function isFailoverStatus(status: number): boolean {
  return FAILOVER_STATUS.has(status)
}

export function applyAuth(
  headers: Headers,
  key: string,
  style: "bearer" | "auto" = "bearer",
): void {
  if (style === "bearer") {
    headers.set("authorization", `Bearer ${key}`)
    headers.delete("x-api-key")
    headers.delete("api-key")
    headers.delete("x-goog-api-key")
    headers.delete("x-stainless-api-key")
    headers.delete("anthropic-api-key")
    return
  }

  const names = [
    "authorization",
    "x-api-key",
    "api-key",
    "x-goog-api-key",
    "x-stainless-api-key",
    "anthropic-api-key",
  ]
  let changed = false
  for (const name of names) {
    const current = headers.get(name)
    if (!current) continue
    headers.set(
      name,
      name === "authorization" && current.toLowerCase().startsWith("bearer ")
        ? `Bearer ${key}`
        : key,
    )
    changed = true
  }
  if (!changed) headers.set("authorization", `Bearer ${key}`)
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after")
  if (!raw) return undefined

  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())

  return undefined
}

export function clampRetryAfter(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined
  return Math.min(31 * 24 * 60 * 60 * 1000, Math.max(1_000, Math.round(value)))
}
