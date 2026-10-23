import type { AccountRecord, AccountState } from "../types"
import type { StateRepository } from "./state"

export type HealthResult = {
  healthy: boolean
  reason?: string
}

export type AccountEvaluation = {
  account: AccountRecord
  state: AccountState
  priority: number
  health: HealthResult
}

export type Snapshot = {
  priority: string[]
  entries: AccountEvaluation[]
  selected?: AccountEvaluation
}

export function accountHealth(
  state: AccountState,
  modelID: string,
  now = Date.now(),
): HealthResult {
  if (!state.enabled) return { healthy: false, reason: "disabled" }
  if (state.authInvalid) return { healthy: false, reason: "auth" }
  if (state.cooldownUntil && state.cooldownUntil > now) {
    return { healthy: false, reason: state.cooldownReason ?? "cooldown" }
  }
  const quota = state.quota[modelID]
  if (quota && quota.until > now) {
    return { healthy: false, reason: quota.reason }
  }
  const wildcard = state.quota["*"]
  if (wildcard && wildcard.until > now) {
    return { healthy: false, reason: wildcard.reason }
  }
  return { healthy: true }
}

export class Selector {
  constructor(private readonly state: StateRepository) {}

  async snapshot(
    integrationID: string,
    modelID: string,
    accounts: AccountRecord[],
    now = Date.now(),
  ): Promise<Snapshot> {
    const priority = await this.state.getPriority(
      integrationID,
      accounts.map((account) => account.id),
    )
    const byID = new Map(accounts.map((account) => [account.id, account]))
    const states = await Promise.all(
      priority.map((id) => this.state.getAccount(integrationID, id)),
    )
    const entries: AccountEvaluation[] = []
    for (const [index, id] of priority.entries()) {
      const account = byID.get(id)
      const state = states[index]
      if (!account || !state) continue
      entries.push({
        account,
        state,
        priority: index,
        health: accountHealth(state, modelID, now),
      })
    }
    return {
      priority,
      entries,
      selected: entries.find((entry) => entry.health.healthy),
    }
  }

  async pick(
    integrationID: string,
    modelID: string,
    accounts: AccountRecord[],
    exclude?: string,
  ): Promise<AccountRecord | undefined> {
    const snapshot = await this.snapshot(integrationID, modelID, accounts)
    const selected =
      snapshot.entries.find(
        (entry) => entry.health.healthy && entry.account.id !== exclude,
      ) ?? undefined
    return selected?.account
  }
}
