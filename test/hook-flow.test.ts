import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import type { SessionHttpRequest, SessionHttpResponse, SessionRetry } from "@opencode/plugin/promise/session"
import { defaultSettings, parseOptions } from "../src/config"
import { FailureTracker } from "../src/core/failures"
import { Selector } from "../src/core/selector"
import { StateRepository } from "../src/core/state"
import { createHttpHandlers, createRetryHandler } from "../src/server/http"
import type { ServerRuntime } from "../src/server/runtime"
import type { AccountRecord, UpdatedEvent } from "../src/types"
import { MemoryStorage } from "./helpers"

const providerID = "opencode-go"
const model = { providerID, id: "glm-5.3" }

function account(id: string): AccountRecord {
  return {
    id,
    label: `key-${id}`,
    method: "key",
    active: false,
    connection: {
      type: "credential",
      id,
      label: `key-${id}`,
      method: "key",
    } as AccountRecord["connection"],
  }
}

function makeRuntime() {
  const storage = new MemoryStorage()
  const state = new StateRepository(storage)
  const accounts = [account("a"), account("b")]
  const selector = new Selector(state)
  const tracker = new FailureTracker()
  const events: UpdatedEvent[] = []
  const parsed = parseOptions({ providers: [providerID], diagnostics: false })

  const runtime = {
    ctx: {} as Plugin.Context,
    options: parsed.options,
    settings: { ...defaultSettings(), balancingEnabled: true },
    state,
    targets: {
      resolve: async (id: string) =>
        id === providerID
          ? {
              providerID,
              integrationID: providerID,
              providerName: "OpenCode Go",
              integrationName: "OpenCode Go",
            }
          : undefined,
      listTargets: async () => [],
      findByIntegration: async () => undefined,
      invalidate: () => {},
    },
    accounts: {
      list: async () => accounts,
      resolveKey: async (entry: AccountRecord) => `key-${entry.id}`,
      resolveKeyByID: async (_integrationID: string, id: string) => `key-${id}`,
      activeID: async () => "a",
      invalidate: () => {},
    },
    selector,
    tracker,
    diagnostics: {
      append: async () => {},
      list: async () => [],
      clear: async () => {},
    },
    emit: async (event: UpdatedEvent) => {
      events.push(event)
    },
    setSettings: async () => {},
    refresh: async () => {},
    log: () => {},
  } as unknown as ServerRuntime

  const handlers = createHttpHandlers(runtime)
  const retry = createRetryHandler(runtime)
  return { runtime, state, tracker, events, handlers, retry }
}

function request(): Request {
  return new Request("https://opencode.ai/inference/go/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: "Bearer native-key",
      "content-type": "application/json",
    },
    body: "{}",
  })
}

function httpRequest(requestValue: Request): SessionHttpRequest {
  return {
    sessionID: "ses_1",
    agent: "build",
    model,
    kind: "primary",
    request: requestValue,
  } as SessionHttpRequest
}

function httpResponse(requestValue: Request, response: Response): SessionHttpResponse {
  return {
    sessionID: "ses_1",
    agent: "build",
    model,
    kind: "primary",
    request: requestValue,
    response,
  } as SessionHttpResponse
}

function retryEvent(
  decision: { retry: false } | { retry: true; delay: number },
  error: Partial<SessionRetry["error"]> = {},
): SessionRetry {
  return {
    sessionID: "ses_1",
    agent: "build",
    model,
    error: {
      type: "provider.quota",
      message: "5-hour usage limit reached",
      status: 429,
      response: {
        body: '{"error":{"type":"GoUsageLimitError","message":"5-hour usage limit reached"}}',
      },
      ...error,
    },
    attempt: 1,
    decision,
  } as SessionRetry
}

function quotaResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        type: "GoUsageLimitError",
        message: "5-hour usage limit reached",
      },
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "18000",
      },
    },
  )
}

describe("HTTP and retry hook flow", () => {
  test("switches from key A to key B on a Go quota 429", async () => {
    const { state, events, handlers, retry } = makeRuntime()

    const first = request()
    await handlers.request(httpRequest(first))
    expect(first.headers.get("authorization")).toBe("Bearer key-a")

    handlers.response(httpResponse(first, quotaResponse()))

    const decision: { retry: false } | { retry: true; delay: number } = {
      retry: false,
    }
    const event = retryEvent(decision)
    await retry(event)

    expect(event.decision).toEqual({ retry: true, delay: 0 })
    const accountA = await state.getAccount(providerID, "a")
    expect(accountA.quota[model.id]?.reason).toBe("five_hour")
    expect(accountA.failures).toBe(1)
    expect(events.some((event) => event.kind === "failover")).toBe(true)

    const second = request()
    await handlers.request(httpRequest(second))
    expect(second.headers.get("authorization")).toBe("Bearer key-b")
  })

  test("stops when both keys are exhausted", async () => {
    const { state, events, handlers, retry } = makeRuntime()

    const first = request()
    await handlers.request(httpRequest(first))
    handlers.response(httpResponse(first, quotaResponse()))
    await retry(retryEvent({ retry: false }))

    const second = request()
    await handlers.request(httpRequest(second))
    handlers.response(httpResponse(second, quotaResponse()))
    const decision: { retry: false } | { retry: true; delay: number } = {
      retry: false,
    }
    const event = retryEvent(decision)
    await retry(event)

    expect(event.decision).toEqual({ retry: false })
    expect((await state.getAccount(providerID, "b")).quota[model.id]?.reason).toBe(
      "five_hour",
    )
    expect(events.at(-1)?.kind).toBe("exhausted")
  })

  test("switches on a 5xx with a short cooldown", async () => {
    const { state, handlers, retry } = makeRuntime()
    const first = request()
    await handlers.request(httpRequest(first))
    handlers.response(
      httpResponse(first, new Response("bad gateway", { status: 502 })),
    )
    const decision: { retry: false } | { retry: true; delay: number } = {
      retry: false,
    }
    const event = retryEvent(decision, {
      type: "provider.internal",
      status: 502,
      message: "bad gateway",
      response: undefined,
    })
    await retry(event)
    expect(event.decision).toEqual({ retry: true, delay: 0 })
    expect((await state.getAccount(providerID, "a")).cooldownReason).toBe(
      "server-error",
    )
  })

  test("switches on 401 and marks the key as auth-invalid", async () => {
    const { state, events, handlers, retry } = makeRuntime()
    const first = request()
    await handlers.request(httpRequest(first))
    handlers.response(
      httpResponse(first, new Response("unauthorized", { status: 401 })),
    )
    const decision: { retry: false } | { retry: true; delay: number } = {
      retry: false,
    }
    const event = retryEvent(decision, {
      type: "provider.auth",
      status: 401,
      message: "invalid key",
      response: undefined,
    })
    await retry(event)
    expect(event.decision).toEqual({ retry: true, delay: 0 })
    expect((await state.getAccount(providerID, "a")).authInvalid).toBe(true)
    expect(events.some((event) => event.kind === "auth")).toBe(true)
  })

  test("does not fail over an HTTP error without a recorded primary attempt", async () => {
    const { retry } = makeRuntime()
    const event = retryEvent({ retry: false })
    await retry(event)
    expect(event.decision).toEqual({ retry: false })
  })

  test("does not fail over a 400", async () => {
    const { handlers, retry } = makeRuntime()
    const first = request()
    await handlers.request(httpRequest(first))
    handlers.response(
      httpResponse(first, new Response("bad request", { status: 400 })),
    )
    const decision: { retry: false } | { retry: true; delay: number } = {
      retry: false,
    }
    const event = retryEvent(decision, {
      type: "provider.invalid-request",
      status: 400,
      message: "bad request",
      response: undefined,
    })
    await retry(event)
    expect(event.decision).toEqual({ retry: false })
  })

  test("fails over a mid-stream quota error after a 200 response", async () => {
    const { handlers, retry } = makeRuntime()
    const primary = request()
    await handlers.request(httpRequest(primary))
    handlers.response(httpResponse(primary, new Response("ok", { status: 200 })))

    const event = retryEvent(
      { retry: false },
      {
        status: undefined,
        message: "5-hour usage limit reached",
        response: undefined,
      },
    )
    await retry(event)
    expect(event.decision).toEqual({ retry: true, delay: 0 })
  })

  test("ignores title requests when tracking a primary failure", async () => {
    const { handlers, retry } = makeRuntime()
    const primary = request()
    await handlers.request(httpRequest(primary))
    handlers.response(httpResponse(primary, quotaResponse()))

    const titleRequest = request()
    await handlers.request({
      sessionID: "ses_1",
      agent: "title",
      model,
      kind: "title",
      request: titleRequest,
    } as SessionHttpRequest)
    handlers.response({
      sessionID: "ses_1",
      agent: "title",
      model,
      kind: "title",
      request: titleRequest,
      response: new Response("ok", { status: 200 }),
    } as SessionHttpResponse)

    const event = retryEvent({ retry: false })
    await retry(event)
    expect(event.decision).toEqual({ retry: true, delay: 0 })
  })

  test("keeps a key usable for another model after a per-model quota", async () => {
    const { handlers, retry } = makeRuntime()
    const first = request()
    await handlers.request(httpRequest(first))
    handlers.response(httpResponse(first, quotaResponse()))
    await retry(retryEvent({ retry: false }))

    const second = request()
    await handlers.request(httpRequest(second))
    expect(second.headers.get("authorization")).toBe("Bearer key-b")

    const other = new Request("https://opencode.ai/inference/go/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer native-key" },
      body: "{}",
    })
    await handlers.request({
      sessionID: "ses_2",
      agent: "build",
      model: { providerID, id: "another-model" },
      kind: "primary",
      request: other,
    } as SessionHttpRequest)
    expect(other.headers.get("authorization")).toBe("Bearer key-a")
  })
})
