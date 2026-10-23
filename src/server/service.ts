import type {
  AccountStatus,
  DiagnosticEntry,
  Settings,
  StatusOutput,
  TargetSummary,
} from "../types"
import type { ServerRuntime } from "./runtime"

function quotaDuration(
  reason: "five_hour" | "weekly" | "monthly" | "billing",
  settings: Settings,
): number {
  switch (reason) {
    case "five_hour":
      return 5 * 60 * 60 * 1000
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000
    case "monthly":
      return 30 * 24 * 60 * 60 * 1000
    case "billing":
      return settings.cooldowns.billingMs
  }
}

export class BalancerService {
  constructor(private readonly runtime: ServerRuntime) {}

  async resolveProvider(providerID?: string) {
    const selected = providerID ?? this.runtime.options.providers[0]
    if (!selected) return undefined
    return this.runtime.targets.resolve(selected)
  }

  async status(providerID?: string, modelID?: string): Promise<StatusOutput> {
    const target = await this.resolveProvider(providerID)
    if (!target) {
      return {
        providerID: providerID ?? this.runtime.options.providers[0] ?? "",
        providerName: "",
        integrationName: "",
        balancingEnabled: this.runtime.settings.balancingEnabled,
        strategy: this.runtime.settings.strategy,
        syncActive: this.runtime.settings.syncActive,
        diagnostics: this.runtime.settings.diagnostics,
        accounts: [],
      }
    }

    const accounts = await this.runtime.accounts.list(target.integrationID)
    const snapshot = await this.runtime.selector.snapshot(
      target.integrationID,
      modelID ?? "",
      accounts,
    )
    const nativeActiveID = await this.runtime.accounts.activeID(target.integrationID)

    const entries: AccountStatus[] = snapshot.entries.map((entry) => ({
      credentialID: entry.account.id,
      label: entry.account.label,
      priority: entry.priority + 1,
      preferred: entry.priority === 0,
      nativeActive: entry.account.id === nativeActiveID,
      enabled: entry.state.enabled,
      healthy: entry.health.healthy,
      ...(entry.health.reason ? { healthReason: entry.health.reason } : {}),
      authInvalid: entry.state.authInvalid === true,
      failures: entry.state.failures,
      ...(entry.state.cooldownUntil !== undefined
        ? { cooldownUntil: entry.state.cooldownUntil }
        : {}),
      ...(entry.state.cooldownReason
        ? { cooldownReason: entry.state.cooldownReason }
        : {}),
      ...(entry.state.lastStatus !== undefined
        ? { lastStatus: entry.state.lastStatus }
        : {}),
      ...(entry.state.lastErrorType
        ? { lastErrorType: entry.state.lastErrorType }
        : {}),
      ...(entry.state.lastErrorMessage
        ? { lastErrorMessage: entry.state.lastErrorMessage }
        : {}),
      quota: Object.entries(entry.state.quota).map(([id, quota]) => ({
        modelID: id,
        until: quota.until,
        reason: quota.reason,
      })),
    }))

    return {
      providerID: target.providerID,
      integrationID: target.integrationID,
      providerName: target.providerName,
      integrationName: target.integrationName,
      balancingEnabled: this.runtime.settings.balancingEnabled,
      strategy: this.runtime.settings.strategy,
      syncActive: this.runtime.settings.syncActive,
      diagnostics: this.runtime.settings.diagnostics,
      ...(snapshot.selected
        ? { selectedCredentialID: snapshot.selected.account.id }
        : {}),
      ...(nativeActiveID ? { nativeActiveCredentialID: nativeActiveID } : {}),
      accounts: entries,
    }
  }

  async targets(): Promise<TargetSummary[]> {
    const targets = await this.runtime.targets.listTargets()
    return Promise.all(
      targets.map(async (target) => ({
        providerID: target.providerID,
        integrationID: target.integrationID,
        providerName: target.providerName,
        integrationName: target.integrationName,
        accountCount: (await this.runtime.accounts.list(target.integrationID)).length,
      })),
    )
  }

  async setPriority(providerID: string | undefined, credentialIDs: string[]): Promise<void> {
    const target = await this.resolveProvider(providerID)
    if (!target) throw new Error("Provider is not managed by opencode-multikey")
    const accounts = await this.runtime.accounts.list(target.integrationID)
    if (accounts.length === 0) {
      throw new Error("No key accounts are available for this provider")
    }
    const valid = new Set(accounts.map((account) => account.id))
    const next = credentialIDs.filter((id) => valid.has(id))
    await this.runtime.state.setPriority(target.integrationID, next)
    await this.emit({
      providerID: target.providerID,
      integrationID: target.integrationID,
      kind: "settings",
    })
  }

  async setEnabled(
    providerID: string | undefined,
    credentialID: string,
    enabled: boolean,
  ): Promise<void> {
    const target = await this.resolveProvider(providerID)
    if (!target) throw new Error("Provider is not managed by opencode-multikey")
    await this.runtime.state.setEnabled(target.integrationID, credentialID, enabled)
    await this.emit({
      providerID: target.providerID,
      integrationID: target.integrationID,
      kind: "settings",
    })
  }

  async resetCooldown(
    providerID: string | undefined,
    credentialID: string,
    modelID?: string,
  ): Promise<void> {
    const target = await this.resolveProvider(providerID)
    if (!target) throw new Error("Provider is not managed by opencode-multikey")
    await this.runtime.state.resetCooldown(
      target.integrationID,
      credentialID,
      modelID,
    )
    await this.emit({
      providerID: target.providerID,
      integrationID: target.integrationID,
      kind: "settings",
    })
  }

  async markCooldown(input: {
    providerID?: string
    credentialID: string
    modelID?: string
    reason:
      | "five_hour"
      | "weekly"
      | "monthly"
      | "billing"
      | "rate-limit"
      | "server-error"
    durationMs?: number
  }): Promise<void> {
    const target = await this.resolveProvider(input.providerID)
    if (!target) throw new Error("Provider is not managed by opencode-multikey")

    const now = Date.now()
    let until = now
    if (
      input.reason === "five_hour" ||
      input.reason === "weekly" ||
      input.reason === "monthly" ||
      input.reason === "billing"
    ) {
      const duration =
        input.durationMs !== undefined
          ? Math.max(1_000, Math.min(31 * 24 * 60 * 60 * 1000, input.durationMs))
          : quotaDuration(input.reason, this.runtime.settings)
      until = now + duration
      await this.runtime.state.markModelCooldown({
        integrationID: target.integrationID,
        credentialID: input.credentialID,
        modelID: input.modelID ?? "*",
        until,
        reason: input.reason,
        message: "Marked manually from opencode-multikey",
      })
    } else {
      const duration =
        input.durationMs !== undefined
          ? Math.max(1_000, Math.min(31 * 24 * 60 * 60 * 1000, input.durationMs))
          : input.reason === "rate-limit"
            ? this.runtime.settings.cooldowns.rateLimitMs
            : this.runtime.settings.cooldowns.serverErrorMs
      until = now + duration
      await this.runtime.state.markAccountCooldown({
        integrationID: target.integrationID,
        credentialID: input.credentialID,
        until,
        reason: input.reason,
        message: "Marked manually from opencode-multikey",
      })
    }

    await this.emit({
      providerID: target.providerID,
      integrationID: target.integrationID,
      kind: "cooldown",
      modelID: input.modelID,
      reason: input.reason,
      until,
    })
  }

  async setSettings(partial: {
    balancingEnabled?: boolean
    syncActive?: boolean
    diagnostics?: boolean
    toast?: boolean
  }): Promise<void> {
    await this.runtime.setSettings({
      ...this.runtime.settings,
      ...partial,
    })
    await this.emit({ kind: "settings" })
  }

  async diagnostics(providerID?: string, limit = 50): Promise<DiagnosticEntry[]> {
    const target = await this.resolveProvider(providerID)
    if (!target) return []
    return this.runtime.diagnostics.list(target.integrationID, limit)
  }

  async refresh(providerID?: string): Promise<void> {
    if (providerID) {
      const target = await this.resolveProvider(providerID)
      if (target) {
        const accounts = await this.runtime.accounts.list(target.integrationID)
        if (accounts.length > 0) {
          await this.runtime.state.prune(
            target.integrationID,
            accounts.map((account) => account.id),
          )
        }
      }
    } else {
      this.runtime.targets.invalidate()
      this.runtime.accounts.invalidate()
      for (const target of await this.runtime.targets.listTargets()) {
        const accounts = await this.runtime.accounts.list(target.integrationID)
        if (accounts.length === 0) continue
        await this.runtime.state.prune(
          target.integrationID,
          accounts.map((account) => account.id),
        )
      }
    }
    await this.emit({ kind: "refresh", providerID })
  }

  async use(
    providerID: string | undefined,
    credentialID: string,
    modelID?: string,
  ): Promise<void> {
    const target = await this.resolveProvider(providerID)
    if (!target) throw new Error("Provider is not managed by opencode-multikey")
    const accounts = await this.runtime.accounts.list(target.integrationID)
    if (!accounts.some((account) => account.id === credentialID)) {
      throw new Error(`Unknown credential: ${credentialID}`)
    }
    await this.runtime.state.moveToFront(
      target.integrationID,
      credentialID,
      accounts.map((account) => account.id),
    )
    await this.runtime.state.resetCooldown(target.integrationID, credentialID)
    await this.runtime.state.touch(target.integrationID, credentialID)
    if (this.runtime.settings.syncActive) {
      await this.runtime.ctx.credential.activate({ credentialID })
    }
    await this.emit({
      providerID: target.providerID,
      integrationID: target.integrationID,
      kind: "settings",
      to: credentialID,
    })
  }

  private async emit(event: Parameters<ServerRuntime["emit"]>[0]): Promise<void> {
    try {
      await this.runtime.emit(event)
    } catch {
      // Notifications are best effort.
    }
  }
}
