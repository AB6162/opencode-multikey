import { describe, expect, test } from "bun:test"
import type { AccountStatus, StatusOutput } from "../src/types"
import { accountHealthTone, statusSummary } from "../src/tui/format"

function account(overrides: Partial<AccountStatus> = {}): AccountStatus {
  return {
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
    ...overrides,
  }
}

function status(overrides: Partial<StatusOutput> = {}): StatusOutput {
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
    accounts: [account()],
    ...overrides,
  }
}

describe("statusSummary", () => {
  test("uses the selected account label instead of the credential ID", () => {
    const summary = statusSummary(status())
    expect(summary).toContain("OpenCode Go")
    expect(summary).not.toContain("cred_")
  })

  test("says none when no account can be selected", () => {
    expect(
      statusSummary(status({ selectedCredentialID: undefined })),
    ).toContain("selected none")
  })
})

describe("accountHealthTone", () => {
  test("maps each health state to a readable tone", () => {
    const now = Date.now()
    expect(accountHealthTone(account(), now)).toBe("success")
    expect(accountHealthTone(account({ enabled: false }), now)).toBe("muted")
    expect(accountHealthTone(account({ authInvalid: true }), now)).toBe("error")
    expect(
      accountHealthTone(
        account({ cooldownUntil: now + 60_000, cooldownReason: "rate-limit" }),
        now,
      ),
    ).toBe("warning")
    expect(
      accountHealthTone(
        account({
          quota: [{ modelID: "glm-5.3", until: now + 60_000, reason: "five_hour" }],
        }),
        now,
      ),
    ).toBe("warning")
  })
})
