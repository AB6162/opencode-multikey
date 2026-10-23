import type { Plugin } from "@opencode/plugin"
import type { RuntimeOptions, Settings, UpdatedEvent } from "../types"
import type { AccountRegistry } from "../core/accounts"
import type { Diagnostics } from "../core/diagnostics"
import type { FailureTracker } from "../core/failures"
import type { Selector } from "../core/selector"
import type { StateRepository } from "../core/state"
import type { TargetResolver } from "../core/targets"

export type ServerRuntime = {
  readonly ctx: Plugin.Context
  readonly options: RuntimeOptions
  settings: Settings
  readonly state: StateRepository
  readonly targets: TargetResolver
  readonly accounts: AccountRegistry
  readonly selector: Selector
  readonly tracker: FailureTracker
  readonly diagnostics: Diagnostics
  emit: (event: UpdatedEvent) => Promise<void>
  setSettings: (next: Settings) => Promise<void>
  refresh: () => Promise<void>
  log: (message: string, error?: unknown) => void
}
