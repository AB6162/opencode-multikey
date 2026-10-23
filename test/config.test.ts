import { describe, expect, test } from "bun:test"
import {
  defaultSettings,
  formatDuration,
  normalizeSettings,
  parseOptions,
} from "../src/config"
import { MemoryStorage } from "./helpers"
import { Diagnostics } from "../src/core/diagnostics"

describe("parseOptions", () => {
  test("uses safe defaults", () => {
    const parsed = parseOptions({})
    expect(parsed.options.providers).toEqual(["opencode-go"])
    expect(parsed.options.authStyle).toBe("bearer")
    expect(parsed.settings.balancingEnabled).toBe(true)
    expect(parsed.settings.diagnostics).toBe(false)
    expect(parsed.settings.cooldowns.quotaUnknownMs).toBe(18_000_000)
  })

  test("deduplicates providers and clamps limits", () => {
    const parsed = parseOptions({
      providers: ["opencode-go", "opencode-go", "opencode"],
      diagnosticsLimit: 500,
      maxBodyBytes: 10,
      cooldowns: { rateLimitMs: 1, billingMs: 999_999_999_999 },
    })
    expect(parsed.options.providers).toEqual(["opencode-go", "opencode"])
    expect(parsed.options.diagnosticsLimit).toBe(200)
    expect(parsed.options.maxBodyBytes).toBe(1_024)
    expect(parsed.settings.cooldowns.rateLimitMs).toBe(1_000)
    expect(parsed.settings.cooldowns.billingMs).toBe(31 * 24 * 60 * 60 * 1000)
  })

  test("ignores invalid regex patterns with a warning", () => {
    const warnings: string[] = []
    const parsed = parseOptions(
      { quotaPatterns: { fiveHour: ["[invalid"] } },
      (message) => warnings.push(message),
    )
    expect(warnings.some((message) => message.includes("invalid"))).toBe(true)
    expect(parsed.options.patterns.fiveHour.length).toBeGreaterThan(0)
  })

  test("normalizes stored settings", () => {
    const settings = normalizeSettings({
      balancingEnabled: false,
      syncActive: true,
      diagnostics: true,
      toast: false,
      cooldowns: { rateLimitMs: 2_000 },
    })
    expect(settings.balancingEnabled).toBe(false)
    expect(settings.syncActive).toBe(true)
    expect(settings.diagnostics).toBe(true)
    expect(settings.toast).toBe(false)
    expect(settings.cooldowns.rateLimitMs).toBe(2_000)
    expect(settings.cooldowns.quotaUnknownMs).toBe(
      defaultSettings().cooldowns.quotaUnknownMs,
    )
  })

  test("formats durations", () => {
    expect(formatDuration(30_000)).toBe("30s")
    expect(formatDuration(5 * 60_000)).toBe("5m")
    expect(formatDuration(5 * 60 * 60_000)).toBe("5h")
    expect(formatDuration(25 * 60 * 60_000)).toBe("25h")
  })
})

describe("Diagnostics", () => {
  test("stores, redacts, limits and clears entries", async () => {
    const storage = new MemoryStorage()
    const parsed = parseOptions({ diagnostics: true, diagnosticsLimit: 2 })
    const diagnostics = new Diagnostics(
      storage,
      parsed.options,
      () => true,
    )

    for (let index = 0; index < 3; index++) {
      await diagnostics.append({
        id: String(index),
        at: Date.now(),
        integrationID: "opencode-go",
        credentialID: "a",
        label: "key-a",
        modelID: "m",
        status: 429,
        errorType: "provider.quota",
        message: "Bearer secret-token-1234567890",
        body: "api_key=oc_sk_1234567890abcdef",
        window: "five_hour",
        cooldownUntil: Date.now() + 1000,
      })
    }

    const entries = await diagnostics.list("opencode-go")
    expect(entries).toHaveLength(2)
    expect(entries[0].message).not.toContain("secret-token")
    expect(entries[0].body).not.toContain("oc_sk_")

    await diagnostics.clear("opencode-go")
    expect(await diagnostics.list("opencode-go")).toEqual([])
  })

  test("does nothing when disabled", async () => {
    const storage = new MemoryStorage()
    const parsed = parseOptions({ diagnostics: false })
    const diagnostics = new Diagnostics(
      storage,
      parsed.options,
      () => false,
    )
    await diagnostics.append({
      id: "1",
      at: Date.now(),
      integrationID: "opencode-go",
      credentialID: "a",
      label: "key-a",
      modelID: "m",
      errorType: "provider.quota",
      message: "x",
    })
    expect(await diagnostics.list("opencode-go")).toEqual([])
  })
})
