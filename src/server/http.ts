import type {
  SessionHttpRequest,
  SessionHttpResponse,
  SessionRetry,
} from "@opencode/plugin/promise/session"
import { applyAuth, isFailoverStatus, isSuccessStatus, parseRetryAfter } from "../core/auth"
import { classifyFailure } from "../core/classifier"
import { truncate } from "../core/redact"
import type { ServerRuntime } from "./runtime"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type HttpHandlers = {
  request: (event: SessionHttpRequest) => Promise<void>
  response: (event: SessionHttpResponse) => void
}

export function createHttpHandlers(runtime: ServerRuntime): HttpHandlers {
  return {
    async request(event) {
      if (!runtime.settings.balancingEnabled) return
      try {
        const target = await runtime.targets.resolve(event.model.providerID)
        if (!target) return

        const accounts = await runtime.accounts.list(target.integrationID)
        if (accounts.length === 0) return

        let exclude: string | undefined
        for (let index = 0; index < accounts.length; index++) {
          const account = await runtime.selector.pick(
            target.integrationID,
            event.model.id,
            accounts,
            exclude,
          )
          if (!account) return

          const key = await runtime.accounts.resolveKey(account)
          if (key) {
            applyAuth(event.request.headers, key, runtime.options.authStyle)
            runtime.tracker.set(event.request, {
              sessionID: event.sessionID,
              providerID: event.model.providerID,
              integrationID: target.integrationID,
              credentialID: account.id,
              modelID: event.model.id,
              kind: event.kind,
              at: Date.now(),
            })
            return
          }

          exclude = account.id
        }
      } catch (error) {
        runtime.log("http.request hook failed; leaving the request untouched", error)
      }
    },

    response(event) {
      try {
        const attempt = runtime.tracker.take(event.request)
        if (!attempt) return
        if (attempt.kind !== "primary" && attempt.kind !== "compaction") {
          return
        }

        if (isSuccessStatus(event.response.status)) {
          runtime.tracker.clearFailure(event.sessionID, event.model)
          return
        }

        if (!isFailoverStatus(event.response.status)) {
          runtime.tracker.clearFailure(event.sessionID, event.model)
          return
        }

        runtime.tracker.record(
          event.sessionID,
          event.model,
          attempt,
          event.response.status,
          parseRetryAfter(event.response.headers),
        )
      } catch (error) {
        runtime.log("http.response hook failed; leaving the response untouched", error)
      }
    },
  }
}

export function createRetryHandler(
  runtime: ServerRuntime,
): (event: SessionRetry) => Promise<void> {
  return async (event) => {
    if (!runtime.settings.balancingEnabled) return
    try {
      const target = await runtime.targets.resolve(event.model.providerID)
      if (!target) return

      const failure = runtime.tracker.takeFailure(event.sessionID, event.model)
      const attempt =
        failure?.attempt ??
        (event.error.status === undefined
          ? runtime.tracker.lastAttemptFor(event.sessionID, event.model)
          : undefined)
      if (!attempt) return
      if (attempt.kind !== "primary" && attempt.kind !== "compaction") return

      const classification = classifyFailure({
        error: {
          type: event.error.type,
          status: event.error.status,
          message: event.error.message,
          response: event.error.response,
          retryAfterMs: event.error.retryAfterMs ?? failure?.retryAfterMs,
        },
        now: Date.now(),
        cooldowns: runtime.settings.cooldowns,
        patterns: runtime.options.patterns,
      })
      if (!classification) return

      await runtime.state.applyClassification({
        integrationID: target.integrationID,
        credentialID: attempt.credentialID,
        modelID: event.model.id,
        classification,
        error: {
          type: event.error.type,
          status: event.error.status,
          message: event.error.message,
          response: event.error.response,
        },
      })

      const accounts = await runtime.accounts.list(target.integrationID)
      const account = accounts.find((entry) => entry.id === attempt.credentialID)

      if (runtime.settings.diagnostics) {
        await runtime.diagnostics.append({
          id: crypto.randomUUID(),
          at: Date.now(),
          integrationID: target.integrationID,
          credentialID: attempt.credentialID,
          label: account?.label ?? attempt.credentialID,
          modelID: event.model.id,
          ...(event.error.status !== undefined ? { status: event.error.status } : {}),
          errorType: event.error.type,
          message: event.error.message,
          ...(event.error.response?.body
            ? {
                body: truncate(
                  event.error.response.body,
                  runtime.options.maxBodyBytes,
                ),
              }
            : {}),
          ...(classification.kind === "model"
            ? { window: classification.reason }
            : {}),
          ...(classification.kind === "auth"
            ? {}
            : { cooldownUntil: classification.until }),
        })
      }

      let next = await runtime.selector.pick(
        target.integrationID,
        event.model.id,
        accounts,
        attempt.credentialID,
      )
      let nextKey = next ? await runtime.accounts.resolveKey(next) : undefined
      for (let index = 0; next && !nextKey && index < accounts.length; index++) {
        await runtime.state.setAuthInvalid(
          target.integrationID,
          next.id,
          "The saved credential could not be resolved",
        )
        next = await runtime.selector.pick(
          target.integrationID,
          event.model.id,
          accounts,
          attempt.credentialID,
        )
        nextKey = next ? await runtime.accounts.resolveKey(next) : undefined
      }

      if (!next || !nextKey) {
        await runtime.emit({
          providerID: target.providerID,
          integrationID: target.integrationID,
          kind: "exhausted",
          modelID: event.model.id,
          reason:
            classification.kind === "model"
              ? classification.reason
              : classification.kind,
          toast: runtime.settings.toast,
        })
        return
      }

      event.decision = { retry: true, delay: 0 }

      if (runtime.settings.syncActive) {
        void runtime.ctx.credential
          .activate({ credentialID: next.id })
          .catch((error) =>
            runtime.log("failed to sync the native active credential", error),
          )
      }

      await runtime.emit({
        providerID: target.providerID,
        integrationID: target.integrationID,
        kind: classification.kind === "auth" ? "auth" : "failover",
        from: attempt.credentialID,
        to: next.id,
        modelID: event.model.id,
        reason:
          classification.kind === "model"
            ? classification.reason
            : classification.kind,
        ...(classification.kind === "auth"
          ? {}
          : { until: classification.until }),
        toast: runtime.settings.toast,
      })
    } catch (error) {
      runtime.log("retry hook failed; leaving the native retry decision untouched", error)
    }
  }
}
