import type { StorageDomain } from "@opencode/plugin/promise/storage"
import { defaultSettings, normalizeSettings } from "../config"
import { redact, truncate } from "./redact"
import type {
  AccountState,
  Classification,
  CooldownReason,
  FailureError,
  QuotaState,
  QuotaWindow,
  Settings,
} from "../types"

const SETTINGS_KEY = "v1/settings"
const PRIORITY_PREFIX = "v1/priority/"
const ACCOUNT_PREFIX = "v1/account/"

const enc = encodeURIComponent

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function accountKey(integrationID: string, credentialID: string): string {
  return `${ACCOUNT_PREFIX}${enc(integrationID)}/${enc(credentialID)}`
}

function accountPrefix(integrationID: string): string {
  return `${ACCOUNT_PREFIX}${enc(integrationID)}/`
}

function priorityKey(integrationID: string): string {
  return `${PRIORITY_PREFIX}${enc(integrationID)}`
}

function normalizeQuota(value: unknown): Record<string, QuotaState> {
  if (!isRecord(value)) return {}
  const quota: Record<string, QuotaState> = {}
  for (const [modelID, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue
    if (typeof entry.until !== "number" || !Number.isFinite(entry.until)) continue
    const reason = entry.reason
    if (
      reason !== "five_hour" &&
      reason !== "weekly" &&
      reason !== "monthly" &&
      reason !== "billing" &&
      reason !== "unknown"
    ) {
      continue
    }
    quota[modelID] = {
      until: entry.until,
      reason,
      updatedAt:
        typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
          ? entry.updatedAt
          : Date.now(),
      ...(typeof entry.message === "string" ? { message: entry.message } : {}),
    }
  }
  return quota
}

function normalizeAccount(value: unknown, credentialID: string): AccountState {
  const source = isRecord(value) ? value : {}
  return {
    credentialID,
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    failures:
      typeof source.failures === "number" && Number.isFinite(source.failures)
        ? Math.max(0, Math.round(source.failures))
        : 0,
    ...(typeof source.lastUsedAt === "number" ? { lastUsedAt: source.lastUsedAt } : {}),
    ...(typeof source.lastStatus === "number" ? { lastStatus: source.lastStatus } : {}),
    ...(typeof source.lastErrorType === "string"
      ? { lastErrorType: source.lastErrorType }
      : {}),
    ...(typeof source.lastErrorMessage === "string"
      ? { lastErrorMessage: source.lastErrorMessage }
      : {}),
    ...(source.authInvalid === true ? { authInvalid: true } : {}),
    ...(typeof source.cooldownUntil === "number" &&
    Number.isFinite(source.cooldownUntil)
      ? { cooldownUntil: source.cooldownUntil }
      : {}),
    ...(source.cooldownReason === "rate-limit" ||
    source.cooldownReason === "server-error" ||
    source.cooldownReason === "auth" ||
    source.cooldownReason === "manual"
      ? { cooldownReason: source.cooldownReason }
      : {}),
    quota: normalizeQuota(source.quota),
  }
}

function normalizePriority(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry),
    ),
  ]
}

export class StateRepository {
  constructor(
    private readonly storage: StorageDomain,
    private readonly defaults: Settings = defaultSettings(),
  ) {}

  async getSettings(): Promise<Settings> {
    try {
      const stored = await this.storage.get(SETTINGS_KEY)
      return stored === undefined ? { ...this.defaults } : normalizeSettings(stored)
    } catch {
      return { ...this.defaults }
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.storage.set(SETTINGS_KEY, {
      schemaVersion: 1,
      balancingEnabled: settings.balancingEnabled,
      strategy: settings.strategy,
      syncActive: settings.syncActive,
      diagnostics: settings.diagnostics,
      toast: settings.toast,
      cooldowns: settings.cooldowns,
    })
  }

  async getAccount(integrationID: string, credentialID: string): Promise<AccountState> {
    try {
      const stored = await this.storage.get(accountKey(integrationID, credentialID))
      return normalizeAccount(stored, credentialID)
    } catch {
      return normalizeAccount(undefined, credentialID)
    }
  }

  async saveAccount(integrationID: string, account: AccountState): Promise<void> {
    await this.storage.set(accountKey(integrationID, account.credentialID), account)
  }

  async scanAccounts(integrationID: string): Promise<Map<string, AccountState>> {
    const result = new Map<string, AccountState>()
    const prefix = accountPrefix(integrationID)
    let after: string | undefined
    try {
      do {
        const page = await this.storage.scan({ prefix, after, limit: 200 })
        for (const entry of page.entries) {
          const suffix = entry.key.slice(prefix.length)
          if (!suffix) continue
          const credentialID = decodeURIComponent(suffix)
          result.set(credentialID, normalizeAccount(entry.value, credentialID))
        }
        after = page.next
      } while (after)
    } catch {
      // A failed scan is treated as an empty state; requests fall back to the
      // native active credential instead of breaking the session.
    }
    return result
  }

  async getPriority(integrationID: string, accountIDs: string[]): Promise<string[]> {
    const valid = new Set(accountIDs)
    let stored: string[] = []
    try {
      stored = normalizePriority(await this.storage.get(priorityKey(integrationID)))
    } catch {
      stored = []
    }
    const filtered = stored.filter((id) => valid.has(id))
    const appended = accountIDs.filter((id) => !filtered.includes(id))
    const next = [...filtered, ...appended]
    if (JSON.stringify(stored) !== JSON.stringify(next)) {
      try {
        await this.storage.set(priorityKey(integrationID), next)
      } catch {
        // Keep the computed order in memory for this call.
      }
    }
    return next
  }

  async setPriority(integrationID: string, credentialIDs: string[]): Promise<void> {
    await this.storage.set(priorityKey(integrationID), normalizePriority(credentialIDs))
  }

  async moveToFront(integrationID: string, credentialID: string, accountIDs: string[]): Promise<void> {
    const priority = await this.getPriority(integrationID, accountIDs)
    const next = [credentialID, ...priority.filter((id) => id !== credentialID)]
    await this.setPriority(integrationID, next)
  }

  async setEnabled(
    integrationID: string,
    credentialID: string,
    enabled: boolean,
  ): Promise<AccountState> {
    const account = await this.getAccount(integrationID, credentialID)
    account.enabled = enabled
    await this.saveAccount(integrationID, account)
    return account
  }

  async applyClassification(input: {
    integrationID: string
    credentialID: string
    modelID: string
    classification: Classification
    error: FailureError
    now?: number
  }): Promise<AccountState> {
    const now = input.now ?? Date.now()
    const account = await this.getAccount(input.integrationID, input.credentialID)
    account.failures += 1
    if (input.error.status === undefined) delete account.lastStatus
    else account.lastStatus = input.error.status
    account.lastErrorType = input.error.type
    account.lastErrorMessage = truncate(redact(input.error.message), 500)

    if (input.classification.kind === "auth") {
      account.authInvalid = true
      account.cooldownReason = "auth"
      delete account.cooldownUntil
    } else if (input.classification.kind === "account") {
      account.cooldownUntil = input.classification.until
      account.cooldownReason = input.classification.reason
    } else {
      account.quota[input.modelID] = {
        until: input.classification.until,
        reason: input.classification.reason,
        updatedAt: now,
        message: truncate(redact(input.classification.message), 500),
      }
    }

    await this.saveAccount(input.integrationID, account)
    return account
  }

  async setAuthInvalid(
    integrationID: string,
    credentialID: string,
    message?: string,
  ): Promise<AccountState> {
    const account = await this.getAccount(integrationID, credentialID)
    account.authInvalid = true
    account.cooldownReason = "auth"
    delete account.cooldownUntil
    if (message) account.lastErrorMessage = truncate(redact(message), 500)
    await this.saveAccount(integrationID, account)
    return account
  }

  async markAccountCooldown(input: {
    integrationID: string
    credentialID: string
    until: number
    reason: CooldownReason
    message?: string
  }): Promise<AccountState> {
    const account = await this.getAccount(input.integrationID, input.credentialID)
    account.cooldownUntil = input.until
    account.cooldownReason = input.reason
    if (input.message) account.lastErrorMessage = truncate(redact(input.message), 500)
    await this.saveAccount(input.integrationID, account)
    return account
  }

  async markModelCooldown(input: {
    integrationID: string
    credentialID: string
    modelID: string
    until: number
    reason: QuotaWindow
    message?: string
  }): Promise<AccountState> {
    const account = await this.getAccount(input.integrationID, input.credentialID)
    account.quota[input.modelID] = {
      until: input.until,
      reason: input.reason,
      updatedAt: Date.now(),
      ...(input.message ? { message: truncate(redact(input.message), 500) } : {}),
    }
    await this.saveAccount(input.integrationID, account)
    return account
  }

  async resetCooldown(
    integrationID: string,
    credentialID: string,
    modelID?: string,
  ): Promise<AccountState> {
    const account = await this.getAccount(integrationID, credentialID)
    if (modelID) {
      delete account.quota[modelID]
    } else {
      account.quota = {}
      delete account.cooldownUntil
      delete account.cooldownReason
      delete account.authInvalid
    }
    await this.saveAccount(integrationID, account)
    return account
  }

  async touch(integrationID: string, credentialID: string): Promise<void> {
    const account = await this.getAccount(integrationID, credentialID)
    account.lastUsedAt = Date.now()
    await this.saveAccount(integrationID, account)
  }

  async prune(integrationID: string, accountIDs: string[]): Promise<void> {
    const valid = new Set(accountIDs)
    const prefix = accountPrefix(integrationID)
    let after: string | undefined
    try {
      do {
        const page = await this.storage.scan({ prefix, after, limit: 200 })
        for (const entry of page.entries) {
          const suffix = entry.key.slice(prefix.length)
          if (!suffix) continue
          const credentialID = decodeURIComponent(suffix)
          if (!valid.has(credentialID)) await this.storage.remove(entry.key)
        }
        after = page.next
      } while (after)
    } catch {
      // Pruning is best effort.
    }
  }
}
