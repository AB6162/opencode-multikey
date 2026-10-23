import type { Plugin } from "@opencode/plugin"
import { MultikeyRpc } from "../rpc"
import type { UpdatedEvent } from "../types"
import type { BalancerService } from "./service"
import type { ServerRuntime } from "./runtime"

function clean(event: UpdatedEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) data[key] = value
  }
  return data
}

export async function registerRpc(
  ctx: Plugin.Context,
  runtime: ServerRuntime,
  service: BalancerService,
) {
  const registration = await ctx.rpc.register(MultikeyRpc, {
    status: async (input) => {
      const data = (input ?? {}) as { providerID?: string; modelID?: string }
      return service.status(data.providerID, data.modelID)
    },
    targets: async () => ({ targets: await service.targets() }),
    setPriority: async (input) => {
      const data = (input ?? {}) as { providerID?: string; credentialIDs: string[] }
      await service.setPriority(data.providerID, data.credentialIDs)
      return {}
    },
    use: async (input) => {
      const data = (input ?? {}) as {
        providerID?: string
        credentialID: string
        modelID?: string
      }
      await service.use(data.providerID, data.credentialID, data.modelID)
      return {}
    },
    setEnabled: async (input) => {
      const data = (input ?? {}) as {
        providerID?: string
        credentialID: string
        enabled: boolean
      }
      await service.setEnabled(data.providerID, data.credentialID, data.enabled)
      return {}
    },
    resetCooldown: async (input) => {
      const data = (input ?? {}) as {
        providerID?: string
        credentialID: string
        modelID?: string
      }
      await service.resetCooldown(
        data.providerID,
        data.credentialID,
        data.modelID,
      )
      return {}
    },
    markCooldown: async (input) => {
      const data = (input ?? {}) as {
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
      }
      await service.markCooldown(data)
      return {}
    },
    setSettings: async (input) => {
      const data = (input ?? {}) as {
        balancingEnabled?: boolean
        syncActive?: boolean
        diagnostics?: boolean
        toast?: boolean
      }
      await service.setSettings(data)
      return {}
    },
    diagnostics: async (input) => {
      const data = (input ?? {}) as { providerID?: string; limit?: number }
      return { entries: await service.diagnostics(data.providerID, data.limit) }
    },
    refresh: async (input) => {
      const data = (input ?? {}) as { providerID?: string }
      await service.refresh(data.providerID)
      return {}
    },
  })

  runtime.emit = async (event) => {
    try {
      await registration.events.emit("updated", clean(event))
    } catch {
      // Best effort; a missing TUI must not affect request handling.
    }
  }

  return registration
}
