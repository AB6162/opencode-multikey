/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import type { StatusOutput } from "../src/types"
import {
  DashboardPanel,
  openDashboard,
  type Snapshot,
} from "../src/tui/dashboard"

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
  const layers: Array<() => Layer> = []
  const dialogs: Array<{ title: string; message?: string }> = []
  const shown: Array<() => unknown> = []
  const context = {
    location: { directory: "/workspace" },
    options: {},
    renderer: { width: 120, height: 40 },
    theme: {
      text: {
        base: "#ffffff",
        muted: "#a0a0a0",
        faint: "#707070",
        action: {
          primary: { base: "#7aa2f7" },
          secondary: { base: "#bb9af7" },
          destructive: { base: "#f7768e" },
        },
        feedback: {
          success: { base: "#9ece6a", muted: "#6a8a4a" },
          warning: { base: "#e0af68", muted: "#a07a40" },
          error: { base: "#f7768e", muted: "#a05060" },
          info: { base: "#7dcfff", muted: "#5080a0" },
        },
      },
      background: {
        base: "#000000",
        raised: { base: "#111111", high: "#222222", max: "#333333" },
        feedback: {
          error: { base: "#2a0f14" },
          warning: { base: "#2a2110" },
          success: { base: "#102a10" },
          info: { base: "#102030" },
        },
      },
      border: { base: "#444444" },
    },
    ui: {
      model: {
        current: () => ({ providerID: "opencode-go", modelID: "glm-5.3" }),
      },
      toast: { show: () => {} },
      dialog: {
        set: () => {},
        show: (render: () => unknown) => {
          shown.push(render)
        },
        alert: async (options: { title: string; message?: string }) => {
          dialogs.push(options)
        },
        select: async () => undefined,
        prompt: async () => undefined,
        confirm: async () => false,
        clear: () => {},
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
  return { context, layers, dialogs, shown }
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

function snapshot(): Snapshot {
  return {
    status: accountStatus(),
    targets: [
      {
        providerID: "opencode-go",
        integrationID: "opencode-go",
        providerName: "OpenCode Go",
        integrationName: "OpenCode Go",
        accountCount: 1,
      },
    ],
  }
}

async function renderPanel(
  context: ReturnType<typeof makeContext>["context"],
  rpc: unknown,
) {
  const app = await testRender(
    () => (
      <DashboardPanel
        context={context as never}
        rpc={rpc as never}
        snapshot={snapshot()}
      />
    ),
    { width: 120, height: 40 },
  )
  cleanups.push(app)
  return app
}

describe("DashboardPanel", () => {
  test("renders the account cards and the key hints", async () => {
    const { context } = makeContext()
    const app = await renderPanel(context, {
      status: async () => accountStatus(),
      targets: async () => ({ targets: [] }),
      events: { on: () => () => {} },
    })

    const frame = await app.waitForFrame((value) => value.includes("ACCOUNTS"))
    expect(frame).toContain("OPENCODE MULTIKEY")
    expect(frame).toContain("Selected for this model")
    expect(frame).toContain("Native active")
    expect(frame).toContain("#1")
    expect(frame).toContain("OpenCode Go")
    expect(frame).toContain("healthy")
    expect(frame).toContain("[?] help")
    expect(frame).toContain("Managed: opencode-go")
    expect(frame).not.toContain("No key accounts")
  })

  test("registers the dashboard keys, including help", async () => {
    const { context, layers } = makeContext()
    const app = await renderPanel(context, {
      status: async () => accountStatus(),
      targets: async () => ({ targets: [] }),
      events: { on: () => () => {} },
    })
    await app.waitForFrame((value) => value.includes("ACCOUNTS"))

    const layer = layers.at(-1)?.()
    const commands = layer?.commands ?? []
    for (const id of [
      "opencode-multikey.help",
      "opencode-multikey.actions",
      "opencode-multikey.add",
      "opencode-multikey.toggle",
      "opencode-multikey.diagnostics",
      "opencode-multikey.targets",
      "opencode-multikey.refresh",
    ]) {
      expect(commands.some((command) => command.id === id)).toBe(true)
    }
    expect(
      commands.find((command) => command.id === "opencode-multikey.help")?.bind,
    ).toBe("?")
  })
})

describe("openDashboard", () => {
  test("loads the snapshot and shows the panel", async () => {
    const { context, shown } = makeContext()
    const rpc = {
      status: async () => accountStatus(),
      targets: async () => ({ targets: [] }),
      events: { on: () => () => {} },
    }

    await openDashboard(context as never, rpc as never)
    expect(shown).toHaveLength(1)
  })

  test("shows the RPC error instead of an empty dashboard", async () => {
    const { context, dialogs, shown } = makeContext()
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

    await openDashboard(context as never, rpc as never)
    expect(shown).toHaveLength(0)
    expect(dialogs.at(-1)?.message).toContain("RPC is unavailable")
  })
})
