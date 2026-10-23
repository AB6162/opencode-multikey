import type { StorageDomain } from "@opencode/plugin/promise/storage"
import { redact, redactBody, truncate } from "./redact"
import type { DiagnosticEntry, RuntimeOptions } from "../types"

const PREFIX = "v1/diagnostics/"

const enc = encodeURIComponent

function key(integrationID: string): string {
  return `${PREFIX}${enc(integrationID)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalize(value: unknown): DiagnosticEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    if (
      typeof entry.id !== "string" ||
      typeof entry.at !== "number" ||
      typeof entry.integrationID !== "string" ||
      typeof entry.credentialID !== "string" ||
      typeof entry.label !== "string" ||
      typeof entry.modelID !== "string" ||
      typeof entry.errorType !== "string" ||
      typeof entry.message !== "string"
    ) {
      return []
    }
    return [
      {
        id: entry.id,
        at: entry.at,
        integrationID: entry.integrationID,
        credentialID: entry.credentialID,
        label: entry.label,
        modelID: entry.modelID,
        ...(typeof entry.status === "number" ? { status: entry.status } : {}),
        errorType: entry.errorType,
        message: truncate(redact(entry.message), 1_000),
        ...(typeof entry.body === "string"
          ? { body: redactBody(entry.body, 2_000) }
          : {}),
        ...(typeof entry.window === "string" ? { window: entry.window } : {}),
        ...(typeof entry.cooldownUntil === "number"
          ? { cooldownUntil: entry.cooldownUntil }
          : {}),
      },
    ]
  })
}

export class Diagnostics {
  constructor(
    private readonly storage: StorageDomain,
    private readonly options: RuntimeOptions,
    private readonly enabled: () => boolean,
  ) {}

  async append(entry: DiagnosticEntry): Promise<void> {
    if (!this.enabled()) return
    try {
      const current = normalize(await this.storage.get(key(entry.integrationID)))
      const next = [
        {
          ...entry,
          message: truncate(redact(entry.message), 1_000),
          ...(entry.body ? { body: redactBody(entry.body, 2_000) } : {}),
        },
        ...current,
      ].slice(0, this.options.diagnosticsLimit)
      await this.storage.set(key(entry.integrationID), next)
    } catch {
      // Diagnostics must never break request handling.
    }
  }

  async list(integrationID: string, limit = 50): Promise<DiagnosticEntry[]> {
    try {
      const entries = normalize(await this.storage.get(key(integrationID)))
      return entries.slice(0, Math.max(1, Math.min(limit, this.options.diagnosticsLimit)))
    } catch {
      return []
    }
  }

  async clear(integrationID: string): Promise<void> {
    try {
      await this.storage.remove(key(integrationID))
    } catch {
      // Best effort.
    }
  }
}
