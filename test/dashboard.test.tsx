/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import type { StatusOutput } from "../src/types"
import { Dashboard } from "../src/tui/dashboard"

type Frame = Awaited<ReturnType<typeof testRender>>
type Layer = {
  commands?: Array<{
    id?: string
    bind?: string
    run?: () => void | Promise<void>
  }>
}

const cleanups: Frame[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((app) => app.dispose()))
})

function makeContext() {
  const routes: unknown[] = []
  const layers: Array<() => Layer> = []
  const context = {
    location: { directory: "/workspace" },
    options: {},
    ui: {
      model: {
        current: () => ({ providerID: "opencode-go", modelID: "glm-5.3" }),
      },
      toast: { show: () => {} },
      router: {
        navigate: (route: unknown) => routes.push(route),
      },
      dialog: {
        alert: async () => {},
        select: async () => undefined,
        prompt: async () => undefined,
        confirm: async () => false,
      },
    },
    data: {
      on: () => () => {},
      location: { default: () => ({ directory: "/workspace" }) },
    },
    keymap: {
      layer: (factory: () => Layer) => {
        layers.push(factory)
      },
    },
  }
  return { context, routes, layers }
}

function accountStatus(): StatusOutput {
  return {
    providerID: "opencode-go",
    integrationID: "opencode-go",
    providerName: "OpenCode Go",
    integrationName: "OpenCode Go",
    balancingEnabled: true,
    strategy: "priority",
    syncActive: false,
    diagnostics: false,
    selectedCredentialID: "a",
    nativeActiveCredentialID: "a",
    accounts: [
      {
        credentialID: "a",
        label: "OpenCode Go",
        priority: 1,
        preferred: true,
        nativeActive: true,
        enabled: true,
        healthy: true,
        authInvalid: false,
        failures: 0,
        quota: [],
      },
    ],
  }
}

describe("Dashboard", () => {
  test("renders the accounts returned by the RPC", async () => {
    const { context } = makeContext()
    const rpc = {
      status: async () => accountStatus(),
      targets: async () => ({
        targets: [
          {
            providerID: "opencode-go",
            integrationID: "opencode-go",
            providerName: "OpenCode Go",
            integrationName: "OpenCode Go",
            accountCount: 1,
          },
        ],
      }),
      events: { on: () => () => {} },
    }

    const app = await testRender(
      () => <Dashboard context={context as never} rpc={rpc as never} />,
      { width: 120, height: 30 },
    )
    cleanups.push(app)

    const frame = await app.waitForFrame((value) => value.includes("#1 OpenCode Go"))
    expect(frame).toContain("OpenCode Go (opencode-go)")
    expect(frame).toContain("healthy")
    expect(frame).toContain("Managed: opencode-go")
    expect(frame).not.toContain("No key accounts")
  })

  test("shows the RPC failure and does not claim there are no accounts", async () => {
    const { context } = makeContext()
    const rpc = {
      status: async () => {
        throw {
          type: "rpc.unavailable",
          message: "RPC is unavailable: opencode-multikey",
        }
      },
      targets: async () => ({ targets: [] }),
      events: { on: () => () => {} },
    }

    const app = await testRender(
      () => <Dashboard context={context as never} rpc={rpc as never} />,
      { width: 120, height: 30 },
    )
    cleanups.push(app)

    const frame = await app.waitForFrame((value) =>
      value.includes("Error: RPC is unavailable"),
    )
    expect(frame).toContain("Press r to retry")
    expect(frame).not.toContain("No key accounts")
  })

  test("registers escape to return home", async () => {
    const { context, routes, layers } = makeContext()
    const rpc = {
      status: async () => accountStatus(),
      targets: async () => ({ targets: [] }),
      events: { on: () => () => {} },
    }

    const app = await testRender(
      () => <Dashboard context={context as never} rpc={rpc as never} />,
      { width: 120, height: 30 },
    )
    cleanups.push(app)

    const layer = layers[0]?.()
    const close = layer?.commands?.find(
      (command) => command.id === "opencode-multikey.close",
    )
    expect(close?.bind).toBe("escape")
    await close?.run?.()
    expect(routes).toEqual([{ type: "home" }])
  })
})
