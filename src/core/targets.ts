import type { Plugin } from "@opencode/plugin"
import type { Target } from "../types"

type CacheEntry = { value: Target | undefined; expires: number }

export class TargetResolver {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly ctx: Plugin.Context,
    private readonly providerIDs: readonly string[],
    private readonly warn: (message: string) => void = () => {},
  ) {}

  async resolve(providerID: string): Promise<Target | undefined> {
    if (!this.providerIDs.includes(providerID)) return undefined

    const cached = this.cache.get(providerID)
    if (cached && cached.expires > Date.now()) return cached.value

    try {
      const provider = (await this.ctx.provider.get({ providerID })).data
      const integrationID = String(provider.integrationID ?? providerID)
      const integration = (await this.ctx.integration.get({ integrationID })).data
      const value: Target = {
        providerID,
        integrationID,
        providerName: provider.name,
        integrationName: integration.name,
      }
      this.cache.set(providerID, { value, expires: Date.now() + 5_000 })
      return value
    } catch (error) {
      this.warn(
        `Unable to resolve provider ${providerID}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      this.cache.set(providerID, { value: undefined, expires: Date.now() + 2_000 })
      return undefined
    }
  }

  async listTargets(): Promise<Target[]> {
    const targets: Target[] = []
    const seen = new Set<string>()
    for (const providerID of this.providerIDs) {
      const target = await this.resolve(providerID)
      if (!target || seen.has(target.integrationID)) continue
      seen.add(target.integrationID)
      targets.push(target)
    }
    return targets
  }

  async findByIntegration(integrationID: string): Promise<Target | undefined> {
    for (const providerID of this.providerIDs) {
      const target = await this.resolve(providerID)
      if (target?.integrationID === integrationID) return target
    }
    return undefined
  }

  invalidate(): void {
    this.cache.clear()
  }
}
