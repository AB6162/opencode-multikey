/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal, onCleanup, onMount } from "solid-js"
import type { StatusOutput } from "../types"
import { accountHealthText } from "./format"
import { modelInput } from "./input"
import type { MultikeyRpcClient } from "./types"

export function StatusSlot(props: {
  context: Context
  rpc: MultikeyRpcClient
}) {
  const [label, setLabel] = createSignal("MK")
  let running = false

  async function refresh() {
    if (running) return
    running = true
    try {
      const current = props.context.ui.model.current()
      const status = (await props.rpc.status(modelInput(current))) as StatusOutput
      if (!status.integrationID || status.accounts.length === 0) {
        setLabel("MK:-")
        return
      }
      if (!status.balancingEnabled) {
        setLabel("MK:off")
        return
      }
      const selected = status.accounts.find(
        (account) => account.credentialID === status.selectedCredentialID,
      )
      if (!selected) {
        setLabel("MK:none")
        return
      }
      const name =
        selected.label.length > 24
          ? `${selected.label.slice(0, 23)}…`
          : selected.label
      setLabel(
        `MK:${name}${
          selected.healthy
            ? ""
            : ` (${accountHealthText(selected, Date.now())})`
        }`,
      )
    } catch {
      setLabel("MK:?")
    } finally {
      running = false
    }
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3_000)
    const offCredential = props.context.data.on("credential.updated", () => {
      void refresh()
    })
    const offSwitched = props.context.data.on("credential.switched", () => {
      void refresh()
    })
    const offRpc = props.rpc.events.on("updated", () => {
      void refresh()
    })
    onCleanup(() => {
      clearInterval(timer)
      offCredential()
      offSwitched()
      offRpc()
    })
  })

  return <text>{label()}</text>
}
