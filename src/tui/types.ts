import type { RpcCallOptions, RpcClient } from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"
import type { MultikeyRpc } from "../rpc"

export type MultikeyRpcClient = RpcClient<typeof MultikeyRpc>

/**
 * RPC registrations are scoped to the location that loaded the server plugin.
 * Calls without a location are rejected with `rpc.unavailable`, so every TUI
 * request must carry the location of the plugin instance that made it.
 */
export function rpcOptions(context: Context): RpcCallOptions {
  const location = context.location ?? context.data.location.default()
  return location ? { location } : {}
}

export function callOptions(context: Context, options?: RpcCallOptions): RpcCallOptions {
  const base = rpcOptions(context)
  if (!options) return base
  return {
    ...base,
    ...options,
    // Keep the scoped location when a caller passes an options object that
    // does not include one.
    location: options.location ?? base.location,
  }
}

/**
 * Compare two location directories the way OpenCode would. Missing values are
 * treated as a match: filtering must never drop every event just because the
 * host has not resolved a location yet.
 */
export function sameDirectory(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) return true
  const normalize = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "")
    return process.platform === "win32" ? normalized.toLowerCase() : normalized
  }
  return normalize(left) === normalize(right)
}

type AnyMethod = (input: unknown, options?: RpcCallOptions) => Promise<unknown>

/**
 * Bind every RPC method to the TUI's current location. The returned client
 * keeps the same surface as the raw one, so components never have to remember
 * to pass a location by hand.
 */
export function scopedRpc(context: Context, client: MultikeyRpcClient): MultikeyRpcClient {
  const bind = (method: AnyMethod): AnyMethod => (input, options) =>
    method(input, callOptions(context, options))

  return {
    status: bind(client.status as AnyMethod) as MultikeyRpcClient["status"],
    targets: bind(client.targets as AnyMethod) as MultikeyRpcClient["targets"],
    setPriority: bind(client.setPriority as AnyMethod) as MultikeyRpcClient["setPriority"],
    use: bind(client.use as AnyMethod) as MultikeyRpcClient["use"],
    setEnabled: bind(client.setEnabled as AnyMethod) as MultikeyRpcClient["setEnabled"],
    resetCooldown: bind(client.resetCooldown as AnyMethod) as MultikeyRpcClient["resetCooldown"],
    markCooldown: bind(client.markCooldown as AnyMethod) as MultikeyRpcClient["markCooldown"],
    setSettings: bind(client.setSettings as AnyMethod) as MultikeyRpcClient["setSettings"],
    diagnostics: bind(client.diagnostics as AnyMethod) as MultikeyRpcClient["diagnostics"],
    refresh: bind(client.refresh as AnyMethod) as MultikeyRpcClient["refresh"],
    events: client.events,
  }
}
