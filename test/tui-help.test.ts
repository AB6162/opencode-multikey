import { describe, expect, test } from "bun:test"
import {
  ACCOUNT_ACTION_HELP,
  HELP_TOPICS,
  KEY_HELP,
  accountActionOptions,
  buildHelpLines,
  wrapText,
} from "../src/tui/help"

describe("help content", () => {
  test("documents the concepts that are easy to confuse", () => {
    const titles = HELP_TOPICS.map((topic) => topic.title.toLowerCase())
    for (const title of [
      "balancing",
      "priority, preferred and native active",
      "selected for this model",
      "cooldown vs quota",
      "reset, disable or remove",
    ]) {
      expect(titles).toContain(title)
    }
  })

  test("documents every dashboard key", () => {
    const keys = KEY_HELP.map((item) => item.key)
    for (const key of ["esc", "?", "a", "n", "b", "g", "t", "r"]) {
      expect(keys).toContain(key)
    }
  })

  test("explains every account action", () => {
    for (const action of [
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
    ] as const) {
      expect(ACCOUNT_ACTION_HELP[action].description.length).toBeGreaterThan(20)
      expect(ACCOUNT_ACTION_HELP[action].category.length).toBeGreaterThan(2)
    }
  })

  test("distinguishes use from native activation", () => {
    expect(ACCOUNT_ACTION_HELP.use.description).toContain("priority")
    expect(ACCOUNT_ACTION_HELP.activate.description).toContain("native")
    expect(ACCOUNT_ACTION_HELP.use.description).not.toBe(
      ACCOUNT_ACTION_HELP.activate.description,
    )
  })

  test("distinguishes reset from remove", () => {
    expect(ACCOUNT_ACTION_HELP.reset.description).toContain("temporary")
    expect(ACCOUNT_ACTION_HELP.remove.description.toLowerCase()).toContain(
      "deletes",
    )
  })

  test("wraps help text without exceeding the available width", () => {
    const lines = wrapText(
      "The list is the failover order and every line must fit the panel width.",
      28,
    )
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => line.length <= 28)).toBe(true)
  })

  test("builds a flat help block with titles, keys and the action hint", () => {
    const lines = buildHelpLines(60)
    const text = lines.map((line) => line.text).join("\n")
    expect(text).toContain("Priority, preferred and native active")
    expect(text).toContain("[esc] close")
    expect(text).toContain("[?] help")
    expect(text).toContain("Press a to see a description")
    expect(lines.some((line) => line.tone === "title")).toBe(true)
  })

  test("builds the action menu from the documented descriptions", () => {
    const options = accountActionOptions({
      credentialID: "a",
      label: "Key A",
      priority: 1,
      preferred: true,
      nativeActive: true,
      enabled: true,
      healthy: true,
      authInvalid: false,
      failures: 0,
      quota: [],
    })
    expect(options.map((option) => option.value)).toEqual([
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
    ])
    expect(options.every((option) => option.description === ACCOUNT_ACTION_HELP[option.value].description)).toBe(true)
    expect(options.find((option) => option.value === "toggle")?.title).toBe(
      "Disable in balancer",
    )
  })
})
