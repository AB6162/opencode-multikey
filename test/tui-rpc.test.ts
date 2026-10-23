import { describe, expect, test } from "bun:test"
import type { RpcCallOptions } from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"
import { sameDirectory, scopedRpc } from "../src/tui/types"

const methods = [
  "status",
  "targets",
  "setPriority",
  "use",
  "setEnabled",
  "resetCooldown",
  "markCooldown",
  "setSettings",
  "diagnostics",
  "refresh",
] as const

function makeClient() {
  const calls = new Map<
    string,
    { input: unknown; options: RpcCallOptions | undefined }
  >()
  const client: Record<string, unknown> = {}
  for (const name of methods) {
    client[name] = async (input: unknown, options?: RpcCallOptions) => {
      calls.set(name, { input, options })
      return {}
    }
  }
  client.events = {
    on: () => () => {},
    subscribe: async function* () {
      return
    },
  }
  return { client, calls }
}

function makeContext(location?: { directory: string }) {
  const fallback = { directory: "/fallback" }
  return {
    location,
    data: { location: { default: () => fallback } },
  } as unknown as Context
}

describe("scopedRpc", () => {
  test("adds the plugin location to every RPC method", async () => {
    const { client, calls } = makeClient()
    const rpc = scopedRpc(makeContext({ directory: "/workspace" }), client as never)

    for (const name of methods) {
      await (
        rpc[name] as (input: unknown, options?: RpcCallOptions) => Promise<unknown>
      )({ marker: name })
    }

    for (const name of methods) {
      expect(calls.get(name)?.input).toEqual({ marker: name })
      expect(calls.get(name)?.options).toEqual({
        location: { directory: "/workspace" },
      })
    }
  })

  test("falls back to the default location when the plugin has none", async () => {
    const { client, calls } = makeClient()
    const rpc = scopedRpc(makeContext(undefined), client as never)

    await rpc.status({})

    expect(calls.get("status")?.options).toEqual({
      location: { directory: "/fallback" },
    })
  })

  test("keeps per-call options while preserving the location", async () => {
    const { client, calls } = makeClient()
    const rpc = scopedRpc(makeContext({ directory: "/workspace" }), client as never)

    await rpc.status(
      {},
      {
        location: { directory: "/explicit" },
        signal: new AbortController().signal,
      },
    )

    expect(calls.get("status")?.options?.location).toEqual({
      directory: "/explicit",
    })
    expect(calls.get("status")?.options?.signal).toBeDefined()
  })

  test("keeps event subscriptions untouched", () => {
    const { client } = makeClient()
    const rpc = scopedRpc(makeContext({ directory: "/workspace" }), client as never)

    expect(rpc.events).toBe(client.events as never)
  })
})

describe("sameDirectory", () => {
  test("matches separators and trailing slashes", () => {
    expect(sameDirectory("C:\\work\\project\\", "C:/work/project")).toBe(true)
  })

  test("is case-insensitive on Windows", () => {
    expect(sameDirectory("C:\\Work\\Project", "c:\\work\\project")).toBe(
      process.platform === "win32",
    )
  })

  test("treats missing values as a match", () => {
    expect(sameDirectory(undefined, "/workspace")).toBe(true)
    expect(sameDirectory("/workspace", undefined)).toBe(true)
  })

  test("rejects different directories", () => {
    expect(sameDirectory("/workspace/a", "/workspace/b")).toBe(false)
  })
})
