import type { Plugin } from "@opencode/plugin"
import type { AccountRecord, ConnectionInfo } from "../types"

type KeyCacheEntry = { key: string; expires: number }

export class AccountRegistry {
  private readonly keys = new Map<string, KeyCacheEntry>()

  constructor(
    private readonly ctx: Plugin.Context,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  async list(integrationID: string): Promise<AccountRecord[]> {
    try {
      const integration = (await this.ctx.integration.get({ integrationID })).data
      const active = await this.ctx.integration.connection.active(integrationID)
      const activeID = active?.type === "credential" ? active.id : undefined

      return integration.connections
        .filter(
          (
            connection,
          ): connection is Extract<ConnectionInfo, { type: "credential" }> =>
            connection.type === "credential" && connection.method === "key",
        )
        .map((connection) => ({
          id: connection.id,
          label: connection.label,
          method: "key" as const,
          connection,
          active: connection.id === activeID,
        }))
    } catch (error) {
      this.warn(
        `Unable to list accounts for ${integrationID}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }

  async resolveKey(account: AccountRecord): Promise<string | undefined> {
    const cached = this.keys.get(account.id)
    if (cached && cached.expires > Date.now()) return cached.key

    try {
      const value = await this.ctx.integration.connection.resolve(account.connection)
      if (value?.type !== "key" || !value.key) return undefined
      this.keys.set(account.id, { key: value.key, expires: Date.now() + 60_000 })
      return value.key
    } catch (error) {
      this.warn(
        `Unable to resolve credential ${account.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return undefined
    }
  }

  async resolveKeyByID(
    integrationID: string,
    credentialID: string,
  ): Promise<string | undefined> {
    const accounts = await this.list(integrationID)
    const account = accounts.find((entry) => entry.id === credentialID)
    if (!account) return undefined
    return this.resolveKey(account)
  }

  async activeID(integrationID: string): Promise<string | undefined> {
    try {
      const active = await this.ctx.integration.connection.active(integrationID)
      return active?.type === "credential" ? active.id : undefined
    } catch {
      return undefined
    }
  }

  invalidate(): void {
    this.keys.clear()
  }
}
