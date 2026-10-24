import { formatDuration } from "../config"
import type { AccountStatus, DiagnosticEntry, StatusOutput, TargetSummary } from "../types"

export type HealthTone = "success" | "warning" | "error" | "muted"

export function accountHealthText(account: AccountStatus, now: number): string {
  if (account.healthy) return "healthy"
  if (account.healthReason === "disabled") return "disabled"
  if (account.healthReason === "auth") return "auth invalid"
  const until = account.cooldownUntil
  if (until && until > now) {
    return `${account.healthReason ?? "cooldown"} ${formatDuration(until - now)}`
  }
  return account.healthReason ?? "unhealthy"
}

export function accountHealthTone(account: AccountStatus, now: number): HealthTone {
  if (!account.enabled) return "muted"
  if (account.authInvalid) return "error"
  if (account.cooldownUntil && account.cooldownUntil > now) return "warning"
  if (account.quota.some((entry) => entry.until > now)) return "warning"
  return "success"
}

export function accountMeta(account: AccountStatus, now: number): string {
  const parts: string[] = []
  if (account.failures > 0) {
    parts.push(`${account.failures} failure${account.failures === 1 ? "" : "s"}`)
  }
  const quota = account.quota
    .filter((entry) => entry.until > now)
    .map(
      (entry) =>
        `${entry.modelID}: ${entry.reason} ${formatDuration(entry.until - now)}`,
    )
  if (quota.length > 0) parts.push(`quota ${quota.join(", ")}`)
  if (account.cooldownUntil && account.cooldownUntil > now) {
    parts.push(
      `cooldown ${account.cooldownReason ?? "active"} ${formatDuration(account.cooldownUntil - now)}`,
    )
  }
  if (account.lastStatus !== undefined && account.failures > 0) {
    parts.push(`last HTTP ${account.lastStatus}`)
  }
  if (account.lastErrorMessage) {
    parts.push(account.lastErrorMessage.slice(0, 100))
  }
  return parts.length > 0 ? parts.join(" · ") : "No active cooldowns"
}

export function accountLine(account: AccountStatus, now: number): string {
  const flags = [
    account.preferred ? "preferred" : undefined,
    account.nativeActive ? "native" : undefined,
    account.enabled ? undefined : "disabled",
  ].filter(Boolean)
  const quota = account.quota
    .filter((entry) => entry.until > now)
    .map((entry) => `${entry.modelID}:${entry.reason} ${formatDuration(entry.until - now)}`)
  return `#${account.priority} ${account.label} [${accountHealthText(account, now)}]${
    flags.length > 0 ? ` (${flags.join(", ")})` : ""
  }${quota.length > 0 ? ` quota=${quota.join(", ")}` : ""}${
    account.failures > 0 ? ` failures=${account.failures}` : ""
  }`
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.length > 0) return message
    const type = (error as { type?: unknown }).type
    if (typeof type === "string" && type.length > 0) return type
    try {
      return JSON.stringify(error)
    } catch {
      // Fall through to String below.
    }
  }
  return String(error)
}

export function statusHeader(status: StatusOutput | undefined): string {
  if (!status) return "Loading opencode-multikey…"
  if (!status.integrationID) {
    return `${status.providerID || "(no provider)"} is not managed by opencode-multikey.`
  }
  return `${status.providerName} (${status.providerID}) → ${status.integrationName} (${status.integrationID})`
}

export function statusSummary(status: StatusOutput | undefined): string {
  if (!status) return ""
  const selected = status.accounts.find(
    (account) => account.credentialID === status.selectedCredentialID,
  )
  return `balancing ${status.balancingEnabled ? "on" : "off"} · strategy ${status.strategy} · selected ${
    selected?.label ?? "none"
  }`
}

export function targetsText(targets: TargetSummary[]): string {
  if (targets.length === 0) return "No managed providers configured."
  return targets
    .map(
      (target) =>
        `${target.providerID} → ${target.integrationID} (${target.accountCount} keys)`,
    )
    .join("\n")
}

export function diagnosticsText(entries: DiagnosticEntry[]): string {
  if (entries.length === 0) return "No diagnostics recorded."
  return entries
    .map((entry) => {
      const status = entry.status === undefined ? "-" : String(entry.status)
      const until = entry.cooldownUntil
        ? new Date(entry.cooldownUntil).toISOString()
        : "-"
      const body = entry.body ? `\n  body: ${entry.body}` : ""
      return `[${new Date(entry.at).toISOString()}] ${entry.label} ${entry.modelID} status=${status} type=${entry.errorType} window=${entry.window ?? "-"} until=${until}\n  ${entry.message}${body}`
    })
    .join("\n")
}
