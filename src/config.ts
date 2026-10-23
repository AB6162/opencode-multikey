import type {
  CompiledPatterns,
  CooldownSettings,
  RuntimeOptions,
  Settings,
} from "./types"

const DAY = 24 * 60 * 60 * 1000
const MAX_COOLDOWN = 31 * DAY

const DEFAULT_PATTERNS: Record<keyof CompiledPatterns, string[]> = {
  fiveHour: ["5[- ]?hour", "five[- ]?hour", "rolling 5", "\\b5h\\b"],
  weekly: ["weekly", "week(?:ly)?\\s+(?:usage\\s+)?limit", "7[- ]?day", "seven[- ]?day"],
  monthly: ["monthly", "month(?:ly)?\\s+(?:usage\\s+)?limit", "billing period", "30[- ]?day"],
  billing: [
    "insufficient\\s+(?:quota|balance)",
    "credit limit",
    "billing",
    "top up",
    "extra usage",
  ],
}

export const DEFAULT_COOLDOWNS: CooldownSettings = {
  quotaUnknownMs: 5 * 60 * 60 * 1000,
  rateLimitMs: 60_000,
  serverErrorMs: 60_000,
  billingMs: 30 * DAY,
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    balancingEnabled: true,
    strategy: "priority",
    syncActive: false,
    diagnostics: false,
    toast: true,
    cooldowns: { ...DEFAULT_COOLDOWNS },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
  return entries.length > 0 ? entries : undefined
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export function normalizeCooldowns(value: unknown): CooldownSettings {
  const source = isRecord(value) ? value : {}
  return {
    quotaUnknownMs: clampNumber(source.quotaUnknownMs, DEFAULT_COOLDOWNS.quotaUnknownMs, 1_000, MAX_COOLDOWN),
    rateLimitMs: clampNumber(source.rateLimitMs, DEFAULT_COOLDOWNS.rateLimitMs, 1_000, MAX_COOLDOWN),
    serverErrorMs: clampNumber(source.serverErrorMs, DEFAULT_COOLDOWNS.serverErrorMs, 1_000, MAX_COOLDOWN),
    billingMs: clampNumber(source.billingMs, DEFAULT_COOLDOWNS.billingMs, 1_000, MAX_COOLDOWN),
  }
}

export function normalizeSettings(value: unknown): Settings {
  const source = isRecord(value) ? value : {}
  return {
    schemaVersion: 1,
    balancingEnabled: booleanValue(source.balancingEnabled, true),
    strategy: "priority",
    syncActive: booleanValue(source.syncActive, false),
    diagnostics: booleanValue(source.diagnostics, false),
    toast: booleanValue(source.toast, true),
    cooldowns: normalizeCooldowns(source.cooldowns),
  }
}

export function compilePatterns(
  value: unknown,
  warn: (message: string) => void,
): CompiledPatterns {
  const source = isRecord(value) ? value : {}
  const compiled: CompiledPatterns = {
    fiveHour: [],
    weekly: [],
    monthly: [],
    billing: [],
  }

  for (const key of Object.keys(DEFAULT_PATTERNS) as Array<keyof CompiledPatterns>) {
    const custom = stringArray(source[key])
    const patterns = [...DEFAULT_PATTERNS[key], ...(custom ?? [])]
    for (const pattern of patterns) {
      try {
        compiled[key].push(new RegExp(pattern, "i"))
      } catch {
        warn(`Ignoring invalid quota pattern for ${key}: ${pattern}`)
      }
    }
  }

  return compiled
}

export type ParsedOptions = {
  settings: Settings
  options: RuntimeOptions
}

export function parseOptions(
  raw: Readonly<Record<string, unknown>>,
  warn: (message: string) => void = () => {},
): ParsedOptions {
  const settings = defaultSettings()
  settings.balancingEnabled = booleanValue(raw.enabled, settings.balancingEnabled)
  settings.syncActive = booleanValue(raw.syncActive, settings.syncActive)
  settings.diagnostics = booleanValue(raw.diagnostics, settings.diagnostics)
  settings.toast = booleanValue(raw.toast, settings.toast)
  settings.cooldowns = normalizeCooldowns(raw.cooldowns)

  if (raw.strategy !== undefined && raw.strategy !== "priority") {
    warn(`Unsupported strategy "${String(raw.strategy)}"; using "priority".`)
  }

  const providers = stringArray(raw.providers) ?? ["opencode-go"]
  const uniqueProviders = [...new Set(providers)]
  const authStyle = raw.authStyle === "auto" ? "auto" : "bearer"

  return {
    settings,
    options: {
      providers: uniqueProviders,
      authStyle,
      diagnosticsLimit: clampNumber(raw.diagnosticsLimit, 50, 1, 200),
      maxBodyBytes: clampNumber(raw.maxBodyBytes, 65_536, 1_024, 1_048_576),
      patterns: compilePatterns(raw.quotaPatterns, warn),
    },
  }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s"
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 48) return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`
}
