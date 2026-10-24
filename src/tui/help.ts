import type { AccountStatus } from "../types"

export type HelpTopic = {
  title: string
  description: string
}

/**
 * Short explanations of the concepts that are easy to confuse in the
 * dashboard. Keep these in user language, not internal implementation terms.
 */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    title: "Balancing",
    description:
      "When on, the plugin picks a healthy key for each request. When off, OpenCode uses its native key and does not fail over.",
  },
  {
    title: "Priority, preferred and native active",
    description:
      "The list is the failover order. #1 is preferred and tried first. Native active is the key OpenCode itself marks active; the balancer can use another key without changing it. 'Use' changes priority, 'Activate natively' does not.",
  },
  {
    title: "Selected for this model",
    description:
      "The key the balancer would use right now. It can differ from native active and changes when a key cools down or a quota resets.",
  },
  {
    title: "Cooldown vs quota",
    description:
      "A cooldown blocks the whole key after a rate limit or server error. A quota blocks only the current model for a 5-hour, weekly or monthly window. Healthy means neither applies.",
  },
  {
    title: "Reset, disable or remove",
    description:
      "Reset clears temporary cooldowns and auth errors. Disable keeps the key in OpenCode but removes it from balancing. Remove deletes the credential permanently.",
  },
]

export type KeyHelp = {
  key: string
  label: string
  description: string
}

export const KEY_HELP: readonly KeyHelp[] = [
  {
    key: "esc",
    label: "close",
    description: "Close help first, then close the dashboard and return to OpenCode.",
  },
  {
    key: "?",
    label: "help",
    description: "Show or hide this help screen.",
  },
  {
    key: "a",
    label: "actions",
    description: "Choose an account and then an action for it.",
  },
  {
    key: "n",
    label: "add key",
    description: "Show the /connect instructions for adding another key.",
  },
  {
    key: "b",
    label: "balancing",
    description: "Turn automatic key selection on or off.",
  },
  {
    key: "g",
    label: "diagnostics",
    description: "Show recent redacted failures when diagnostics are enabled.",
  },
  {
    key: "t",
    label: "providers",
    description: "List the providers and integrations managed by the plugin.",
  },
  {
    key: "r",
    label: "refresh",
    description: "Reload accounts, cooldowns and quota information.",
  },
]

export type HelpLineTone = "title" | "body" | "faint" | "blank"

export type HelpLine = {
  text: string
  tone: HelpLineTone
}

export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(20, Math.floor(width))
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    if (!line) {
      line = word
      continue
    }
    if (line.length + 1 + word.length <= limit) {
      line += ` ${word}`
      continue
    }
    lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Build one flat list of lines so the help panel can be rendered as a single
 * text node. Separate text nodes with wrapped content have unreliable
 * intrinsic heights in OpenTUI and overlap their neighbours.
 */
export function buildHelpLines(width: number): HelpLine[] {
  const lines: HelpLine[] = []
  for (const topic of HELP_TOPICS) {
    lines.push({ text: topic.title, tone: "title" })
    for (const line of wrapText(topic.description, width)) {
      lines.push({ text: line, tone: "body" })
    }
  }

  lines.push({ text: "", tone: "blank" })
  lines.push({ text: "KEYS", tone: "faint" })
  const keys = KEY_HELP.map((item) => `[${item.key}] ${item.label}`)
  const perLine = width >= 84 ? 4 : width >= 44 ? 2 : 1
  const column = Math.max(16, Math.floor(width / perLine))
  for (let index = 0; index < keys.length; index += perLine) {
    lines.push({
      text: keys
        .slice(index, index + perLine)
        .map((key) => key.padEnd(column))
        .join("")
        .trimEnd(),
      tone: "body",
    })
  }
  lines.push({ text: "", tone: "blank" })
  for (const line of wrapText(
    "Press a to see a description for every account action. Add keys with /connect; the plugin never stores them.",
    width,
  )) {
    lines.push({ text: line, tone: "faint" })
  }
  return lines
}

export type AccountAction =
  | "use"
  | "up"
  | "down"
  | "toggle"
  | "reset"
  | "five_hour"
  | "weekly"
  | "monthly"
  | "rename"
  | "activate"
  | "remove"

export type AccountActionHelp = {
  category: "Priority" | "Availability" | "Identity" | "OpenCode" | "Danger"
  description: string
}

/**
 * Descriptions shown in the account action picker. Several actions look
 * similar, so the descriptions call out what each one does and does not do.
 */
export const ACCOUNT_ACTION_HELP: Record<AccountAction, AccountActionHelp> = {
  use: {
    category: "Priority",
    description:
      "Moves this key to #1 in the balancer priority. It is tried first while healthy. This does not change OpenCode's native active key.",
  },
  up: {
    category: "Priority",
    description: "Raises this key one place in the failover order.",
  },
  down: {
    category: "Priority",
    description: "Lowers this key one place in the failover order.",
  },
  toggle: {
    category: "Availability",
    description:
      "Keeps the key in OpenCode but includes or excludes it from automatic balancing.",
  },
  reset: {
    category: "Availability",
    description:
      "Clears temporary cooldowns and auth-invalid state. It does not delete the key or change priority.",
  },
  five_hour: {
    category: "Availability",
    description:
      "Blocks this key for the current model for 5 hours. Other models can still use it.",
  },
  weekly: {
    category: "Availability",
    description:
      "Blocks this key for the current model for 7 days. Other models can still use it.",
  },
  monthly: {
    category: "Availability",
    description:
      "Blocks this key for the current model for 30 days. Other models can still use it.",
  },
  rename: {
    category: "Identity",
    description:
      "Changes only the display label in OpenCode and this dashboard.",
  },
  activate: {
    category: "OpenCode",
    description:
      "Makes this the native active key in OpenCode. It does not change the balancer priority or the routing order.",
  },
  remove: {
    category: "Danger",
    description:
      "Deletes the credential from OpenCode permanently, not only from the balancer.",
  },
}

export type AccountActionOption = {
  title: string
  value: AccountAction
  description: string
  category: AccountActionHelp["category"]
}

const ACTION_TITLES: Record<AccountAction, string> = {
  use: "Use for new requests (move to #1)",
  up: "Move up one place",
  down: "Move down one place",
  toggle: "Enable or disable in balancer",
  reset: "Reset cooldown and auth state",
  five_hour: "Mark 5-hour limit for this model",
  weekly: "Mark weekly limit for this model",
  monthly: "Mark monthly limit for this model",
  rename: "Rename label",
  activate: "Activate natively in OpenCode",
  remove: "Remove credential from OpenCode",
}

export function accountActionOptions(
  account?: AccountStatus | { enabled?: boolean },
): AccountActionOption[] {
  const actions: AccountAction[] = [
    "use",
    "up",
    "down",
    "toggle",
    "reset",
    "five_hour",
    "weekly",
    "monthly",
    "rename",
    "activate",
    "remove",
  ]
  return actions.map((action) => ({
    value: action,
    title:
      action === "toggle"
        ? account?.enabled === false
          ? "Enable in balancer"
          : "Disable in balancer"
        : ACTION_TITLES[action],
    description: ACCOUNT_ACTION_HELP[action].description,
    category: ACCOUNT_ACTION_HELP[action].category,
  }))
}
