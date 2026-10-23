import type { Attempt, LastFailure } from "../types"

type ModelRef = { providerID: string; id: string }

const MAX_ENTRIES = 500
const FAILURE_TTL = 60_000
const ATTEMPT_TTL = 30 * 60_000

function key(sessionID: string, model: ModelRef): string {
  return `${sessionID}:${model.providerID}/${model.id}`
}

function trim(map: Map<string, unknown>): void {
  while (map.size > MAX_ENTRIES) {
    const first = map.keys().next()
    if (first.done) return
    map.delete(first.value)
  }
}

export class FailureTracker {
  private readonly attempts = new WeakMap<Request, Attempt>()
  private readonly lastAttempt = new Map<string, Attempt>()
  private readonly failures = new Map<string, LastFailure>()

  set(request: Request, attempt: Attempt): void {
    this.attempts.set(request, attempt)
    if (attempt.kind === "primary" || attempt.kind === "compaction") {
      this.lastAttempt.set(
        key(attempt.sessionID, {
          providerID: attempt.providerID,
          id: attempt.modelID,
        }),
        attempt,
      )
      trim(this.lastAttempt)
    }
  }

  take(request: Request): Attempt | undefined {
    const attempt = this.attempts.get(request)
    if (attempt) this.attempts.delete(request)
    return attempt
  }

  record(
    sessionID: string,
    model: ModelRef,
    attempt: Attempt,
    status: number,
    retryAfterMs?: number,
  ): void {
    this.failures.set(key(sessionID, model), {
      attempt,
      status,
      retryAfterMs,
      at: Date.now(),
    })
    trim(this.failures)
  }

  takeFailure(sessionID: string, model: ModelRef): LastFailure | undefined {
    const id = key(sessionID, model)
    const failure = this.failures.get(id)
    if (!failure) return undefined
    this.failures.delete(id)
    if (Date.now() - failure.at > FAILURE_TTL) return undefined
    return failure
  }

  lastAttemptFor(sessionID: string, model: ModelRef): Attempt | undefined {
    const id = key(sessionID, model)
    const attempt = this.lastAttempt.get(id)
    if (!attempt) return undefined
    if (Date.now() - attempt.at > ATTEMPT_TTL) {
      this.lastAttempt.delete(id)
      return undefined
    }
    return attempt
  }

  clearFailure(sessionID: string, model: ModelRef): void {
    this.failures.delete(key(sessionID, model))
  }

  clear(sessionID: string, model: ModelRef): void {
    const id = key(sessionID, model)
    this.failures.delete(id)
    this.lastAttempt.delete(id)
  }
}
