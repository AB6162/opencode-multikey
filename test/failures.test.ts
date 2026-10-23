import { describe, expect, test } from "bun:test"
import { FailureTracker } from "../src/core/failures"
import type { Attempt } from "../src/types"

function attempt(credentialID = "a"): Attempt {
  return {
    sessionID: "ses_1",
    providerID: "opencode-go",
    integrationID: "opencode-go",
    credentialID,
    modelID: "glm-5.3",
    kind: "primary",
    at: Date.now(),
  }
}

const model = { providerID: "opencode-go", id: "glm-5.3" }

describe("FailureTracker", () => {
  test("maps a request to its attempt and returns it once", () => {
    const tracker = new FailureTracker()
    const request = new Request("https://example.com")
    tracker.set(request, attempt())
    expect(tracker.take(request)?.credentialID).toBe("a")
    expect(tracker.take(request)).toBeUndefined()
  })

  test("records and takes the last failure", () => {
    const tracker = new FailureTracker()
    const request = new Request("https://example.com")
    tracker.set(request, attempt())
    tracker.record("ses_1", model, attempt(), 429, 30_000)
    const failure = tracker.takeFailure("ses_1", model)
    expect(failure?.status).toBe(429)
    expect(failure?.retryAfterMs).toBe(30_000)
    expect(tracker.takeFailure("ses_1", model)).toBeUndefined()
  })

  test("remembers the last attempt and clears it", () => {
    const tracker = new FailureTracker()
    const request = new Request("https://example.com")
    tracker.set(request, attempt())
    expect(tracker.lastAttemptFor("ses_1", model)?.credentialID).toBe("a")
    tracker.clear("ses_1", model)
    expect(tracker.lastAttemptFor("ses_1", model)).toBeUndefined()
  })

  test("keeps the attempt after the request object is consumed", () => {
    const tracker = new FailureTracker()
    const request = new Request("https://example.com")
    tracker.set(request, attempt("b"))
    tracker.take(request)
    expect(tracker.lastAttemptFor("ses_1", model)?.credentialID).toBe("b")
  })
})
