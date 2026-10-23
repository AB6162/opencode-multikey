import { describe, expect, test } from "bun:test"
import { errorText } from "../src/tui/format"
import { modelIDOf, modelInput, textValue } from "../src/tui/input"

describe("modelInput", () => {
  test("omits null fields returned by the TUI when no model is selected", () => {
    expect(modelInput({ providerID: null, modelID: null })).toEqual({})
  })

  test("keeps only valid string fields", () => {
    expect(
      modelInput({ providerID: "opencode-go", modelID: null }),
    ).toEqual({ providerID: "opencode-go" })
    expect(
      modelInput({ providerID: "opencode-go", modelID: "glm-5.3" }),
    ).toEqual({ providerID: "opencode-go", modelID: "glm-5.3" })
  })

  test("handles undefined, empty strings and non-objects", () => {
    expect(modelInput(undefined)).toEqual({})
    expect(modelInput({ providerID: "", modelID: "  " })).toEqual({})
    expect(modelInput("not-an-object")).toEqual({})
  })

  test("modelIDOf returns only a valid model ID", () => {
    expect(modelIDOf({ modelID: "glm-5.3" })).toBe("glm-5.3")
    expect(modelIDOf({ modelID: null })).toBeUndefined()
    expect(modelIDOf(undefined)).toBeUndefined()
  })

  test("textValue rejects non-strings and empty strings", () => {
    expect(textValue("x")).toBe("x")
    expect(textValue("")).toBeUndefined()
    expect(textValue(null)).toBeUndefined()
    expect(textValue(1)).toBeUndefined()
  })
})

describe("errorText", () => {
  test("prefers a plain RPC error message", () => {
    expect(
      errorText({
        type: "rpc.invalid_input",
        message: 'Expected string at ["providerID"]',
      }),
    ).toBe('Expected string at ["providerID"]')
  })

  test("handles Error, strings and typed objects", () => {
    expect(errorText(new Error("boom"))).toBe("boom")
    expect(errorText("plain")).toBe("plain")
    expect(errorText({ type: "rpc.unavailable" })).toBe("rpc.unavailable")
  })

  test("serializes unknown objects instead of [object Object]", () => {
    expect(errorText({ code: 1, detail: "x" })).toBe(
      '{"code":1,"detail":"x"}',
    )
  })
})
