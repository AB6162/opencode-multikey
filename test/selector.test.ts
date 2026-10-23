import { describe, expect, test } from "bun:test"
import { Selector, accountHealth } from "../src/core/selector"
import { StateRepository } from "../src/core/state"
import type { AccountRecord } from "../src/types"
import { MemoryStorage } from "./helpers"

function account(id: string, label = id): AccountRecord {
  return {
    id,
    label,
    method: "key",
    active: false,
    connection: {
      type: "credential",
      id,
      label,
      method: "key",
    } as AccountRecord["connection"],
  }
}

function setup() {
  const storage = new MemoryStorage()
  const state = new StateRepository(storage)
  const selector = new Selector(state)
  const accounts = [account("a", "key-a"), account("b", "key-b")]
  return { storage, state, selector, accounts }
}

describe("accountHealth", () => {
  test("reports disabled, auth, account cooldown and model quota", () => {
    const now = Date.now()
    expect(
      accountHealth({ credentialID: "a", enabled: false, failures: 0, quota: {} }, "m", now),
    ).toEqual({ healthy: false, reason: "disabled" })
    expect(
      accountHealth(
        { credentialID: "a", enabled: true, failures: 0, authInvalid: true, quota: {} },
        "m",
        now,
      ),
    ).toEqual({ healthy: false, reason: "auth" })
    expect(
      accountHealth(
        {
          credentialID: "a",
          enabled: true,
          failures: 0,
          cooldownUntil: now + 10_000,
          cooldownReason: "rate-limit",
          quota: {},
        },
        "m",
        now,
      ),
    ).toEqual({ healthy: false, reason: "rate-limit" })
    expect(
      accountHealth(
        {
          credentialID: "a",
          enabled: true,
          failures: 0,
          quota: { m: { until: now + 10_000, reason: "five_hour", updatedAt: now } },
        },
        "m",
        now,
      ),
    ).toEqual({ healthy: false, reason: "five_hour" })
  })
})

describe("Selector", () => {
  test("uses priority order and skips excluded accounts", async () => {
    const { selector, accounts } = setup()
    expect((await selector.pick("go", "m", accounts))?.id).toBe("a")
    expect((await selector.pick("go", "m", accounts, "a"))?.id).toBe("b")
  })

  test("skips accounts in account cooldown", async () => {
    const { selector, state, accounts } = setup()
    await state.markAccountCooldown({
      integrationID: "go",
      credentialID: "a",
      until: Date.now() + 60_000,
      reason: "rate-limit",
    })
    expect((await selector.pick("go", "m", accounts))?.id).toBe("b")
  })

  test("tracks quota per model, not globally", async () => {
    const { selector, state, accounts } = setup()
    await state.markModelCooldown({
      integrationID: "go",
      credentialID: "a",
      modelID: "model-x",
      until: Date.now() + 60_000,
      reason: "five_hour",
    })
    expect((await selector.pick("go", "model-x", accounts))?.id).toBe("b")
    expect((await selector.pick("go", "model-y", accounts))?.id).toBe("a")
  })

  test("wildcard quota applies to every model", async () => {
    const { selector, state, accounts } = setup()
    await state.markModelCooldown({
      integrationID: "go",
      credentialID: "a",
      modelID: "*",
      until: Date.now() + 60_000,
      reason: "monthly",
    })
    expect((await selector.pick("go", "model-x", accounts))?.id).toBe("b")
    expect((await selector.pick("go", "model-y", accounts))?.id).toBe("b")
  })

  test("respects disabled and auth-invalid accounts", async () => {
    const { selector, state, accounts } = setup()
    await state.setEnabled("go", "a", false)
    expect((await selector.pick("go", "m", accounts))?.id).toBe("b")
    await state.setAuthInvalid("go", "b")
    expect(await selector.pick("go", "m", accounts)).toBeUndefined()
  })

  test("respects priority changes", async () => {
    const { selector, state, accounts } = setup()
    await state.setPriority("go", ["b", "a"])
    expect((await selector.pick("go", "m", accounts))?.id).toBe("b")
  })

  test("recovers after a cooldown expires", async () => {
    const { selector, state, accounts } = setup()
    await state.markAccountCooldown({
      integrationID: "go",
      credentialID: "a",
      until: Date.now() - 1,
      reason: "server-error",
    })
    expect((await selector.pick("go", "m", accounts))?.id).toBe("a")
  })
})
