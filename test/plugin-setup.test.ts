import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { setupServer } from "../src/server/plugin"
import type { AccountRecord } from "../src/types"
import { MemoryStorage } from "./helpers"

type HookRecord = {
  name: string
  callback: (event: unknown) => unknown
}

function makeContext() {
  const storage = new MemoryStorage()
  const hooks: HookRecord[] = []
  const tools: Array<{
    execute: (input: unknown, context: unknown) => Promise<{ content: string }>
  }> = []
  const activations: string[] = []
  let rpcHandlers: Record<string, (input: unknown) => Promise<unknown>> = {}
  let rpcRegistered = false

  const connections = [
    {
      type: "credential" as const,
      id: "a",
      label: "key-a",
      method: "key" as const,
    },
    {
      type: "credential" as const,
      id: "b",
      label: "key-b",
      method: "key" as const,
    },
  ]

  const integration = {
    id: "opencode-go",
    name: "OpenCode Go",
    methods: [],
    connections,
  }

  const provider = {
    id: "opencode-go",
    name: "OpenCode Go",
    activation: "enabled",
    package: "@opencode/ai/providers/openai-compatible",
    integrationID: "opencode-go",
  }

  const ctx = {
    options: { providers: ["opencode-go"] },
    storage,
    provider: {
      get: async () => ({ location: {}, data: provider }),
    },
    integration: {
      get: async () => ({ location: {}, data: integration }),
      connection: {
        active: async () => connections[0],
        resolve: async (connection: { id: string }) => ({
          type: "key" as const,
          key: `key-${connection.id}`,
        }),
        status: async () => {},
      },
    },
    credential: {
      activate: async ({ credentialID }: { credentialID: string }) => {
        activations.push(credentialID)
      },
    },
    session: {
      hook: async (name: string, callback: (event: unknown) => unknown) => {
        hooks.push({ name, callback })
        return { dispose: async () => {} }
      },
    },
    rpc: {
      register: async (
        _definition: unknown,
        handlers: Record<string, (input: unknown) => Promise<unknown>>,
      ) => {
        rpcHandlers = handlers
        rpcRegistered = true
        return {
          dispose: async () => {},
          events: { emit: async () => {} },
        }
      },
    },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          add: (tool: (typeof tools)[number]) => tools.push(tool),
        })
        return { dispose: async () => {} }
      },
    },
    event: {
      subscribe: async function* () {
        return
      },
    },
    app: { version: "2.1.4", channel: "test" },
    location: { directory: process.cwd(), project: { id: "p", directory: process.cwd(), canonical: process.cwd() } },
  } as unknown as Plugin.Context

  return {
    ctx,
    storage,
    hooks,
    tools,
    activations,
    getRpcHandlers: () => rpcHandlers,
    rpcRegistered: () => rpcRegistered,
    connections,
  }
}

describe("setupServer", () => {
  test("registers hooks, RPC and tool, and serves status", async () => {
    const fake = makeContext()
    const cleanup = await setupServer(fake.ctx)

    expect(fake.rpcRegistered()).toBe(true)
    expect(fake.hooks.filter((hook) => hook.name === "http.request")).toHaveLength(1)
    expect(fake.hooks.filter((hook) => hook.name === "http.response")).toHaveLength(1)
    expect(fake.hooks.filter((hook) => hook.name === "retry")).toHaveLength(1)
    expect(fake.tools).toHaveLength(1)

    const status = (await fake.getRpcHandlers().status({})) as {
      accounts: Array<{ label: string; credentialID: string }>
      selectedCredentialID?: string
      balancingEnabled: boolean
    }
    expect(status.balancingEnabled).toBe(true)
    expect(status.accounts.map((account) => account.label)).toEqual([
      "key-a",
      "key-b",
    ])
    expect(status.selectedCredentialID).toBe("a")

    const toolResult = await fake.tools[0].execute(
      { action: "status" },
      { signal: new AbortController().signal, progress: async () => {} },
    )
    expect(toolResult.content).toContain("key-a")
    expect(toolResult.content).toContain("key-b")

    const requestHook = fake.hooks.find((hook) => hook.name === "http.request")
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { authorization: "Bearer native" },
      body: "{}",
    })
    await requestHook?.callback({
      sessionID: "ses_1",
      agent: "build",
      model: { providerID: "opencode-go", id: "glm-5.3" },
      kind: "primary",
      request,
    })
    expect(request.headers.get("authorization")).toBe("Bearer key-a")

    await cleanup?.()
  })

  test("uses and cooldown RPC methods", async () => {
    const fake = makeContext()
    const cleanup = await setupServer(fake.ctx)
    const handlers = fake.getRpcHandlers()

    await handlers.setPriority({
      providerID: "opencode-go",
      credentialIDs: ["b", "a"],
    })
    const afterPriority = (await handlers.status({
      providerID: "opencode-go",
      modelID: "glm-5.3",
    })) as { selectedCredentialID?: string }
    expect(afterPriority.selectedCredentialID).toBe("b")

    await handlers.markCooldown({
      providerID: "opencode-go",
      credentialID: "b",
      modelID: "glm-5.3",
      reason: "five_hour",
    })
    const afterCooldown = (await handlers.status({
      providerID: "opencode-go",
      modelID: "glm-5.3",
    })) as { selectedCredentialID?: string; accounts: Array<{ credentialID: string; quota: unknown[] }> }
    expect(afterCooldown.selectedCredentialID).toBe("a")
    expect(
      afterCooldown.accounts.find((account) => account.credentialID === "b")
        ?.quota.length,
    ).toBe(1)

    await handlers.resetCooldown({
      providerID: "opencode-go",
      credentialID: "b",
    })
    const afterReset = (await handlers.status({
      providerID: "opencode-go",
      modelID: "glm-5.3",
    })) as { selectedCredentialID?: string }
    expect(afterReset.selectedCredentialID).toBe("b")

    await cleanup?.()
  })
})
