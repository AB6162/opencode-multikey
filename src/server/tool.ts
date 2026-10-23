import type { Plugin } from "@opencode/plugin"
import { formatDuration } from "../config"
import type { AccountStatus, DiagnosticEntry, StatusOutput } from "../types"
import { migrateV1Keys } from "./migration"
import type { BalancerService } from "./service"

function formatAccount(account: AccountStatus, now: number): string {
  const state = account.healthy
    ? "healthy"
    : account.healthReason === "disabled"
      ? "disabled"
      : account.healthReason === "auth"
        ? "auth invalid"
        : account.cooldownUntil
          ? `${account.healthReason ?? "cooldown"} ${formatDuration(account.cooldownUntil - now)}`
          : (account.healthReason ?? "unhealthy")
  const flags = [
    account.preferred ? "preferred" : undefined,
    account.nativeActive ? "native-active" : undefined,
    account.enabled ? undefined : "disabled",
    account.authInvalid ? "auth-invalid" : undefined,
  ].filter(Boolean)
  const quota = account.quota
    .filter((entry) => entry.until > now)
    .map(
      (entry) =>
        `${entry.modelID}:${entry.reason} ${formatDuration(entry.until - now)}`,
    )
  return `#${account.priority} ${account.label} [${state}]${
    flags.length > 0 ? ` (${flags.join(", ")})` : ""
  }${quota.length > 0 ? ` quota=${quota.join("; ")}` : ""}${
    account.failures > 0 ? ` failures=${account.failures}` : ""
  }${account.lastErrorType ? ` last=${account.lastErrorType}` : ""}`
}

function formatStatus(status: StatusOutput): string {
  const now = Date.now()
  const lines = [
    `provider: ${status.providerID || "(none)"} -> integration ${status.integrationID || "(not found)"}`,
    `balancing: ${status.balancingEnabled ? "on" : "off"} | strategy: ${status.strategy} | syncActive: ${status.syncActive}`,
    `selected: ${status.selectedCredentialID ?? "(none healthy)"}${
      status.nativeActiveCredentialID
        ? ` | native active: ${status.nativeActiveCredentialID}`
        : ""
    }`,
  ]
  if (status.accounts.length === 0) {
    lines.push("accounts: none. Run /connect and select this provider twice to add keys.")
  } else {
    lines.push("accounts:")
    for (const account of status.accounts) lines.push(`  ${formatAccount(account, now)}`)
  }
  return lines.join("\n")
}

function formatDiagnostics(entries: DiagnosticEntry[]): string {
  if (entries.length === 0) return "No diagnostics recorded."
  return entries
    .map(
      (entry) =>
        `[${new Date(entry.at).toISOString()}] ${entry.label} ${entry.modelID} status=${
          entry.status ?? "?"
        } type=${entry.errorType} window=${entry.window ?? "-"} until=${
          entry.cooldownUntil ? new Date(entry.cooldownUntil).toISOString() : "-"
        }\n  ${entry.message}${entry.body ? `\n  body: ${entry.body}` : ""}`,
    )
    .join("\n")
}

export async function registerTool(
  ctx: Plugin.Context,
  service: BalancerService,
) {
  return ctx.tool.transform((editor) => {
    editor.add({
      name: "multikey",
      description:
        "Inspect and manage opencode-multikey: account health, priority, cooldowns, diagnostics, and optional V1 key migration.",
      input: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "status",
              "targets",
              "accounts",
              "use",
              "enable",
              "disable",
              "reset",
              "mark",
              "diagnose",
              "migrate-v1",
              "help",
            ],
          },
          providerID: { type: "string" },
          credentialID: { type: "string" },
          modelID: { type: "string" },
          reason: {
            type: "string",
            enum: [
              "five_hour",
              "weekly",
              "monthly",
              "billing",
              "rate-limit",
              "server-error",
            ],
          },
          durationMs: { type: "number" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const data = input as {
          action: string
          providerID?: string
          credentialID?: string
          modelID?: string
          reason?:
            | "five_hour"
            | "weekly"
            | "monthly"
            | "billing"
            | "rate-limit"
            | "server-error"
          durationMs?: number
        }

        try {
          switch (data.action) {
            case "status": {
              return {
                content: formatStatus(
                  await service.status(data.providerID, data.modelID),
                ),
              }
            }
            case "accounts": {
              const status = await service.status(data.providerID, data.modelID)
              return { content: formatStatus(status) }
            }
            case "targets": {
              const targets = await service.targets()
              if (targets.length === 0) return { content: "No managed providers." }
              return {
                content: targets
                  .map(
                    (target) =>
                      `${target.providerID} -> ${target.integrationID} (${target.accountCount} key accounts)`,
                  )
                  .join("\n"),
              }
            }
            case "use": {
              if (!data.credentialID) return { content: "credentialID is required." }
              await service.use(data.providerID, data.credentialID, data.modelID)
              return {
                content: `Using ${data.credentialID}\n${formatStatus(
                  await service.status(data.providerID, data.modelID),
                )}`,
              }
            }
            case "enable":
            case "disable": {
              if (!data.credentialID) return { content: "credentialID is required." }
              await service.setEnabled(
                data.providerID,
                data.credentialID,
                data.action === "enable",
              )
              return { content: `${data.action}d ${data.credentialID}` }
            }
            case "reset": {
              if (!data.credentialID) return { content: "credentialID is required." }
              await service.resetCooldown(
                data.providerID,
                data.credentialID,
                data.modelID,
              )
              return { content: `Cooldown reset for ${data.credentialID}` }
            }
            case "mark": {
              if (!data.credentialID || !data.reason) {
                return { content: "credentialID and reason are required." }
              }
              await service.markCooldown({
                providerID: data.providerID,
                credentialID: data.credentialID,
                modelID: data.modelID,
                reason: data.reason,
                durationMs: data.durationMs,
              })
              return {
                content: `Marked ${data.credentialID} as ${data.reason}${
                  data.modelID ? ` for ${data.modelID}` : ""
                }`,
              }
            }
            case "diagnose": {
              return {
                content: formatDiagnostics(
                  await service.diagnostics(data.providerID, 20),
                ),
              }
            }
            case "migrate-v1": {
              return {
                content: await migrateV1Keys(ctx, service, data.providerID),
              }
            }
            default:
              return {
                content:
                  "Actions: status, targets, accounts, use, enable, disable, reset, mark, diagnose, migrate-v1, help.",
              }
          }
        } catch (error) {
          return {
            content: `opencode-multikey error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }
        }
      },
    })
  })
}
