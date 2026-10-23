const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi
const API_KEY = /\b(?:oc_sk|sk|rk|pk)[_-][A-Za-z0-9_-]{8,}\b/g
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g
const SECRET_FIELD =
  /("?(?:api[_-]?key|authorization|token|secret|access_token|refresh_token)"?\s*[:=]\s*"?)([^"\s,}]{4,})/gi

export function truncate(value: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength < 0) return value
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

export function redact(value: string): string {
  return value
    .replace(BEARER, "Bearer [redacted]")
    .replace(API_KEY, "[redacted]")
    .replace(OPENAI_KEY, "[redacted]")
    .replace(SECRET_FIELD, "$1[redacted]")
}

export function redactBody(value: string, maxLength = 2_000): string {
  return truncate(redact(value), maxLength)
}
