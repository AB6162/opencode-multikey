import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import type { BalancerService } from "./service"

type V1Row = {
  provider_id: string
  alias: string
  auth_json: string
  auth_type: string
}

function configDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return join(xdg, "opencode")
  return join(homedir(), ".config", "opencode")
}

function candidates(): string[] {
  const paths = [join(configDir(), "balancer.sqlite")]
  if (process.env.LOCALAPPDATA) {
    paths.push(join(process.env.LOCALAPPDATA, "opencode", "balancer.sqlite"))
  }
  return [...new Set(paths)]
}

function keyFromAuth(authJSON: string): string | undefined {
  try {
    const auth = JSON.parse(authJSON) as { type?: unknown; key?: unknown }
    if (
      (auth.type === "api" || auth.type === "key") &&
      typeof auth.key === "string" &&
      auth.key.length > 0
    ) {
      return auth.key
    }
  } catch {
    // Invalid legacy rows are reported as skipped.
  }
  return undefined
}

export async function migrateV1Keys(
  ctx: Plugin.Context,
  service: BalancerService,
  providerID?: string,
): Promise<string> {
  const target = await service.resolveProvider(providerID)
  if (!target) return "This provider is not managed by opencode-multikey."

  const databasePath = candidates().find((path) => existsSync(path))
  if (!databasePath) {
    return `No V1 balancer database found. Checked:\n${candidates()
      .map((path) => `  ${path}`)
      .join("\n")}`
  }

  let Database: typeof import("bun:sqlite").Database
  try {
    ;({ Database } = await import("bun:sqlite"))
  } catch {
    return "bun:sqlite is not available in this OpenCode runtime; V1 migration cannot run."
  }

  const integration = (await ctx.integration.get({
    integrationID: target.integrationID,
  })).data
  const existing = new Set<string>()
  const labels = new Set<string>()
  for (const connection of integration.connections) {
    if (connection.type !== "credential") continue
    labels.add(connection.label)
    if (connection.method !== "key") continue
    try {
      const value = await ctx.integration.connection.resolve(connection)
      if (value?.type === "key") existing.add(value.key)
    } catch {
      // Unreadable credentials are ignored for dedupe.
    }
  }

  const db = new Database(databasePath, { readonly: true })
  let imported = 0
  let present = 0
  let skipped = 0
  let failed = 0
  const failures: string[] = []

  try {
    const rows = db
      .query<V1Row, []>(
        "SELECT provider_id, alias, auth_json, auth_type FROM accounts",
      )
      .all()

    for (const row of rows) {
      if (row.provider_id !== target.providerID || row.auth_type !== "api") {
        skipped += 1
        continue
      }
      const key = keyFromAuth(row.auth_json)
      if (!key) {
        skipped += 1
        continue
      }
      if (existing.has(key)) {
        present += 1
        continue
      }

      let label = row.alias || "v1"
      if (labels.has(label)) label = `${label} (v1)`
      let suffix = 2
      while (labels.has(label)) {
        label = `${row.alias || "v1"} (v1 ${suffix})`
        suffix += 1
      }

      try {
        await ctx.integration.connect.key({
          integrationID: target.integrationID,
          key,
          label,
        })
        existing.add(key)
        labels.add(label)
        imported += 1
      } catch (error) {
        failed += 1
        failures.push(
          `${row.alias}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } finally {
    db.close()
  }

  const lines = [
    `V1 database: ${databasePath}`,
    `Provider: ${target.providerID} -> integration ${target.integrationID}`,
    `Imported: ${imported}`,
    `Already present: ${present}`,
    `Skipped (other provider or non-API auth): ${skipped}`,
    `Failed: ${failed}`,
    "OAuth/wellknown accounts cannot be migrated automatically; reconnect them with /connect.",
  ]
  if (failures.length > 0) lines.push(`Failures:\n  ${failures.join("\n  ")}`)
  return lines.join("\n")
}
