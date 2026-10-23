import type { ConnectionInfo as ClientConnectionInfo } from "@opencode/client"

export type ConnectionInfo = ClientConnectionInfo

export type CooldownReason = "rate-limit" | "server-error" | "auth" | "manual"

export type QuotaWindow = "five_hour" | "weekly" | "monthly" | "billing" | "unknown"

export type QuotaState = {
  until: number
  reason: QuotaWindow
  updatedAt: number
  message?: string
}

export type AccountState = {
  credentialID: string
  enabled: boolean
  failures: number
  lastUsedAt?: number
  lastStatus?: number
  lastErrorType?: string
  lastErrorMessage?: string
  authInvalid?: boolean
  cooldownUntil?: number
  cooldownReason?: CooldownReason
  quota: Record<string, QuotaState>
}

export type CooldownSettings = {
  quotaUnknownMs: number
  rateLimitMs: number
  serverErrorMs: number
  billingMs: number
}

export type Settings = {
  schemaVersion: 1
  balancingEnabled: boolean
  strategy: "priority"
  syncActive: boolean
  diagnostics: boolean
  toast: boolean
  cooldowns: CooldownSettings
}

export type CompiledPatterns = {
  fiveHour: RegExp[]
  weekly: RegExp[]
  monthly: RegExp[]
  billing: RegExp[]
}

export type RuntimeOptions = {
  providers: string[]
  authStyle: "bearer" | "auto"
  diagnosticsLimit: number
  maxBodyBytes: number
  patterns: CompiledPatterns
}

export type Target = {
  providerID: string
  integrationID: string
  providerName: string
  integrationName: string
}

export type AccountRecord = {
  id: string
  label: string
  method: "key"
  connection: ConnectionInfo
  active: boolean
}

export type Attempt = {
  sessionID: string
  providerID: string
  integrationID: string
  credentialID: string
  modelID: string
  kind: "primary" | "compaction" | "title" | "generate"
  at: number
}

export type LastFailure = {
  attempt: Attempt
  status: number
  retryAfterMs?: number
  at: number
}

export type FailureError = {
  type: string
  status?: number
  message: string
  response?: { body: string }
  retryAfterMs?: number
}

export type Classification =
  | { kind: "auth"; message: string }
  | {
      kind: "account"
      reason: "rate-limit" | "server-error"
      until: number
      message: string
    }
  | {
      kind: "model"
      reason: QuotaWindow
      until: number
      message: string
    }

export type DiagnosticEntry = {
  id: string
  at: number
  integrationID: string
  credentialID: string
  label: string
  modelID: string
  status?: number
  errorType: string
  message: string
  body?: string
  window?: string
  cooldownUntil?: number
}

export type AccountStatus = {
  credentialID: string
  label: string
  priority: number
  preferred: boolean
  nativeActive: boolean
  enabled: boolean
  healthy: boolean
  healthReason?: string
  authInvalid: boolean
  failures: number
  cooldownUntil?: number
  cooldownReason?: string
  lastStatus?: number
  lastErrorType?: string
  lastErrorMessage?: string
  quota: Array<{ modelID: string; until: number; reason: string }>
}

export type StatusOutput = {
  providerID: string
  integrationID?: string
  providerName: string
  integrationName: string
  balancingEnabled: boolean
  strategy: string
  syncActive: boolean
  diagnostics: boolean
  selectedCredentialID?: string
  nativeActiveCredentialID?: string
  accounts: AccountStatus[]
}

export type TargetSummary = {
  providerID: string
  integrationID: string
  providerName: string
  integrationName: string
  accountCount: number
}

export type UpdatedEvent = {
  providerID?: string
  integrationID?: string
  kind?: "failover" | "cooldown" | "exhausted" | "refresh" | "settings" | "auth"
  from?: string
  to?: string
  modelID?: string
  reason?: string
  until?: number
  toast?: boolean
}
