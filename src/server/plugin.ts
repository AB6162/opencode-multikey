import type { Plugin } from "@opencode/plugin"
import { normalizeSettings, parseOptions } from "../config"
import { AccountRegistry } from "../core/accounts"
import { Diagnostics } from "../core/diagnostics"
import { FailureTracker } from "../core/failures"
import { redact } from "../core/redact"
import { Selector } from "../core/selector"
import { StateRepository } from "../core/state"
import { TargetResolver } from "../core/targets"
import { createHttpHandlers, createRetryHandler } from "./http"
import { registerRpc } from "./rpc"
import type { ServerRuntime } from "./runtime"
import { BalancerService } from "./service"
import { registerTool } from "./tool"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function relevantEvent(type: string): boolean {
  return (
    type === "credential.updated" ||
    type === "credential.switched" ||
    type === "integration.updated" ||
    type === "provider.updated"
  )
}

export async function setupServer(ctx: Plugin.Context) {
  const log = (message: string, error?: unknown) => {
    if (error === undefined) {
      console.warn(`[opencode-multikey] ${redact(message)}`)
      return
    }
    console.warn(
      `[opencode-multikey] ${redact(message)}: ${redact(describe(error))}`,
    )
  }

  const parsed = parseOptions(
    ctx.options as Readonly<Record<string, unknown>>,
    (message) => log(message),
  )

  const state = new StateRepository(ctx.storage, parsed.settings)
  const settings = await state.getSettings()
  const targets = new TargetResolver(ctx, parsed.options.providers, log)
  const accounts = new AccountRegistry(ctx, log)
  const selector = new Selector(state)
  const tracker = new FailureTracker()
  const diagnostics = new Diagnostics(
    ctx.storage,
    parsed.options,
    () => runtime.settings.diagnostics,
  )

  const runtime: ServerRuntime = {
    ctx,
    options: parsed.options,
    settings,
    state,
    targets,
    accounts,
    selector,
    tracker,
    diagnostics,
    emit: async () => {},
    setSettings: async (next) => {
      const normalized = normalizeSettings(next)
      runtime.settings = normalized
      await state.saveSettings(normalized)
    },
    refresh: async () => {
      targets.invalidate()
      accounts.invalidate()
      await runtime.emit({ kind: "refresh" })
    },
    log,
  }

  const service = new BalancerService(runtime)
  const registrations: Array<{ dispose: () => Promise<void> }> = []

  async function safeRegister<T extends { dispose: () => Promise<void> }>(
    label: string,
    factory: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await factory()
    } catch (error) {
      log(`failed to register ${label}`, error)
      return undefined
    }
  }

  const rpcRegistration = await safeRegister("rpc", () =>
    registerRpc(ctx, runtime, service),
  )

  const handlers = createHttpHandlers(runtime)
  const retryHandler = createRetryHandler(runtime)

  for (const providerID of parsed.options.providers) {
    const requestRegistration = await safeRegister(
      `http.request for ${providerID}`,
      () => ctx.session.hook("http.request", handlers.request, { providerID }),
    )
    if (requestRegistration) registrations.push(requestRegistration)

    const responseRegistration = await safeRegister(
      `http.response for ${providerID}`,
      () => ctx.session.hook("http.response", handlers.response, { providerID }),
    )
    if (responseRegistration) registrations.push(responseRegistration)

    const retryRegistration = await safeRegister(
      `retry for ${providerID}`,
      () => ctx.session.hook("retry", retryHandler, { providerID }),
    )
    if (retryRegistration) registrations.push(retryRegistration)
  }

  const toolRegistration = await safeRegister("tool", () =>
    registerTool(ctx, service),
  )
  if (toolRegistration) registrations.push(toolRegistration)

  const controller = new AbortController()
  let debounce: ReturnType<typeof setTimeout> | undefined
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (!relevantEvent(event.type)) continue
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          runtime.targets.invalidate()
          runtime.accounts.invalidate()
          void runtime.emit({ kind: "refresh" }).catch(() => {})
        }, 250)
      }
    } catch (error) {
      if (!controller.signal.aborted) log("event subscription failed", error)
    }
  })()

  if (parsed.options.providers.length === 0) {
    log("No providers configured; opencode-multikey is inactive.")
  }

  return async () => {
    controller.abort()
    if (debounce) clearTimeout(debounce)
    for (const registration of registrations.reverse()) {
      try {
        await registration.dispose()
      } catch {
        // Cleanup is best effort.
      }
    }
    if (rpcRegistration) {
      try {
        await rpcRegistration.dispose()
      } catch {
        // Cleanup is best effort.
      }
    }
  }
}
