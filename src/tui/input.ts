export function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Build an RPC status/use input from the TUI's current model.
 *
 * The TUI can expose `{ providerID: null, modelID: null }` when no model is
 * selected. The RPC schema accepts null defensively, but omitting undefined
 * fields keeps the request canonical and avoids validation surprises.
 */
export function modelInput(current: unknown): {
  providerID?: string
  modelID?: string
} {
  const value =
    current && typeof current === "object"
      ? (current as { providerID?: unknown; modelID?: unknown })
      : undefined
  const input: { providerID?: string; modelID?: string } = {}
  const providerID = textValue(value?.providerID)
  const modelID = textValue(value?.modelID)
  if (providerID) input.providerID = providerID
  if (modelID) input.modelID = modelID
  return input
}

export function modelIDOf(current: unknown): string | undefined {
  return modelInput(current).modelID
}
