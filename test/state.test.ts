import { describe, expect, test } from "bun:test"
import { defaultSettings } from "../src/config"
import { StateRepository } from "../src/core/state"
import type { Classification } from "../src/types"
import { MemoryStorage } from "./helpers"

function repository() {
  const storage = new MemoryStorage()
  return { storage, state: new StateRepository(storage, defaultSettings()) }
}

describe("StateRepository", () => {
  test("returns defaults when empty and persists settings", async () => {
    const { storage, state } = repository()
    const initial = await state.getSettings()
    expect(initial.balancingEnabled).toBe(true)
    expect(initial.cooldowns.quotaUnknownMs).toBe(18_000_000)

    await state.saveSettings({
      ...initial,
      balancingEnabled: false,
      syncActive: true,
      diagnostics: true,
      cooldowns: { ...initial.cooldowns, rateLimitMs: 5_000 },
    })
    const loaded = await state.getSettings()
    expect(loaded.balancingEnabled).toBe(false)
    expect(loaded.syncActive).toBe(true)
    expect(loaded.diagnostics).toBe(true)
    expect(loaded.cooldowns.rateLimitMs).toBe(5_000)
    expect(storage.has("v1/settings")).toBe(true)
  })

  test("reconciles priority with new and removed accounts", async () => {
    const { state } = repository()
    expect(await state.getPriority("go", ["a", "b"])).toEqual(["a", "b"])
    await state.setPriority("go", ["b", "a", "missing"])
    expect(await state.getPriority("go", ["a", "b"])).toEqual(["b", "a"])
    expect(await state.getPriority("go", ["a", "b", "c"])).toEqual(["b", "a", "c"])
  })

  test("moves an account to the front", async () => {
    const { state } = repository()
    await state.setPriority("go", ["a", "b", "c"])
    await state.moveToFront("go", "c", ["a", "b", "c"])
    expect(await state.getPriority("go", ["a", "b", "c"])).toEqual(["c", "a", "b"])
  })

  test("applies model quota, account cooldown and auth state", async () => {
    const { state } = repository()
    const now = Date.now()
    const quota: Classification = {
      kind: "model",
      reason: "five_hour",
      until: now + 60_000,
      message: "5-hour usage limit",
    }
    const afterQuota = await state.applyClassification({
      integrationID: "go",
      credentialID: "a",
      modelID: "model-x",
      classification: quota,
      error: { type: "provider.quota", status: 429, message: "5-hour usage limit" },
      now,
    })
    expect(afterQuota.failures).toBe(1)
    expect(afterQuota.quota["model-x"]?.reason).toBe("five_hour")
    expect(afterQuota.lastStatus).toBe(429)

    const account: Classification = {
      kind: "account",
      reason: "server-error",
      until: now + 30_000,
      message: "upstream down",
    }
    const afterAccount = await state.applyClassification({
      integrationID: "go",
      credentialID: "b",
      modelID: "model-x",
      classification: account,
      error: { type: "provider.internal", status: 502, message: "upstream down" },
      now,
    })
    expect(afterAccount.cooldownReason).toBe("server-error")

    const auth = await state.applyClassification({
      integrationID: "go",
      credentialID: "c",
      modelID: "model-x",
      classification: { kind: "auth", message: "bad key" },
      error: { type: "provider.auth", status: 401, message: "bad key" },
      now,
    })
    expect(auth.authInvalid).toBe(true)
  })

  test("resets account and model cooldowns", async () => {
    const { state } = repository()
    const now = Date.now()
    await state.markModelCooldown({
      integrationID: "go",
      credentialID: "a",
      modelID: "m",
      until: now + 60_000,
      reason: "weekly",
    })
    await state.markAccountCooldown({
      integrationID: "go",
      credentialID: "a",
      until: now + 60_000,
      reason: "rate-limit",
    })
    await state.setAuthInvalid("go", "a")
    const afterModelReset = await state.resetCooldown("go", "a", "m")
    expect(afterModelReset.quota["m"]).toBeUndefined()
    expect(afterModelReset.authInvalid).toBe(true)

    const afterFullReset = await state.resetCooldown("go", "a")
    expect(afterFullReset.quota).toEqual({})
    expect(afterFullReset.cooldownUntil).toBeUndefined()
    expect(afterFullReset.authInvalid).toBeUndefined()
  })

  test("prunes orphan account state", async () => {
    const { storage, state } = repository()
    await state.setEnabled("go", "a", true)
    await state.setEnabled("go", "b", true)
    await state.prune("go", ["a"])
    const dump = storage.dump()
    expect(Object.keys(dump).some((key) => key.includes("b"))).toBe(false)
    expect(Object.keys(dump).some((key) => key.includes("a"))).toBe(true)
  })

  test("touch records last use", async () => {
    const { state } = repository()
    await state.touch("go", "a")
    const account = await state.getAccount("go", "a")
    expect(account.lastUsedAt).toBeGreaterThan(0)
  })
})
