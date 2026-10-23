/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import type { DiagnosticEntry, StatusOutput, TargetSummary } from "../types"
import {
  accountHealthText,
  accountLine,
  diagnosticsText,
  errorText,
  statusHeader,
  statusSummary,
  targetsText,
} from "./format"
import { modelIDOf, modelInput, textValue } from "./input"
import type { MultikeyRpcClient } from "./types"

export function Dashboard(props: {
  context: Context
  rpc: MultikeyRpcClient
}) {
  const [status, setStatus] = createSignal<StatusOutput | undefined>()
  const [targets, setTargets] = createSignal<TargetSummary[]>([])
  const [error, setError] = createSignal<string | undefined>()
  const [loaded, setLoaded] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  let running = false

  const model = () => props.context.ui.model.current()
  const currentInput = () => modelInput(model())
  const modelID = () => modelIDOf(model())

  async function refresh() {
    if (running) return
    running = true
    setLoading(true)
    try {
      const next = (await props.rpc.status(currentInput())) as StatusOutput
      setStatus(next)
      setLoaded(true)
      setError(undefined)
      try {
        const targetResult = (await props.rpc.targets({})) as {
          targets: TargetSummary[]
        }
        setTargets(targetResult.targets)
      } catch (cause) {
        // A failed provider listing must not hide a valid account snapshot.
        setError(errorText(cause))
      }
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      running = false
      setLoading(false)
    }
  }

  function closeDashboard() {
    props.context.ui.router.navigate({ type: "home" })
  }

  function headerText(): string {
    if (status()) return statusHeader(status())
    if (error()) return "Unable to load opencode-multikey."
    return "Loading opencode-multikey…"
  }

  async function toast(message: string, variant: "info" | "success" | "warning" | "error" = "info") {
    props.context.ui.toast.show({ message, variant })
  }

  async function addAccount() {
    await props.context.ui.dialog.alert({
      title: "Add an OpenCode Go key",
      message:
        "Use OpenCode's native account flow:\n\n1. Run /connect\n2. Select OpenCode Go\n3. Paste the key\n4. Repeat /connect for every additional key\n\nThe dashboard detects new credentials automatically. The plugin never asks for or stores the key itself.",
    })
  }

  async function toggleBalancing() {
    const current = status()
    if (!current) return
    try {
      await props.rpc.setSettings({
        balancingEnabled: !current.balancingEnabled,
      })
      await refresh()
      await toast(
        `Balancing ${current.balancingEnabled ? "disabled" : "enabled"}`,
        "success",
      )
    } catch (cause) {
      await toast(errorText(cause), "error")
    }
  }

  async function showDiagnostics() {
    try {
      const current = status()
      const providerID =
        textValue(current?.providerID) ?? currentInput().providerID
      const result = (await props.rpc.diagnostics({
        ...(providerID ? { providerID } : {}),
        limit: 20,
      })) as { entries: DiagnosticEntry[] }
      await props.context.ui.dialog.alert({
        title: "Multikey diagnostics",
        message: diagnosticsText(result.entries).slice(0, 8_000),
      })
    } catch (cause) {
      await toast(errorText(cause), "error")
    }
  }

  async function showTargets() {
    try {
      const result = (await props.rpc.targets({})) as {
        targets: TargetSummary[]
      }
      await props.context.ui.dialog.alert({
        title: "Managed providers",
        message: targetsText(result.targets),
      })
    } catch (cause) {
      await toast(errorText(cause), "error")
    }
  }

  async function accountActions() {
    const current = status()
    if (!current || current.accounts.length === 0) {
      await addAccount()
      return
    }

    const credentialID = await props.context.ui.dialog.select({
      title: "Multikey account",
      options: current.accounts.map((account) => ({
        title: `${account.label} · ${accountHealthText(account, now())}`,
        value: account.credentialID,
        description: `#${account.priority}${
          account.preferred ? " · preferred" : ""
        }${account.nativeActive ? " · native active" : ""}${
          account.failures > 0 ? ` · ${account.failures} failures` : ""
        }`,
      })),
    })
    if (!credentialID) return

    const account = current.accounts.find(
      (entry) => entry.credentialID === credentialID,
    )
    const action = await props.context.ui.dialog.select({
      title: `Action: ${account?.label ?? credentialID}`,
      options: [
        { title: "Use / make preferred", value: "use" },
        { title: "Move up in priority", value: "up" },
        { title: "Move down in priority", value: "down" },
        {
          title: account?.enabled ? "Disable in balancer" : "Enable in balancer",
          value: "toggle",
        },
        { title: "Reset cooldown / auth state", value: "reset" },
        { title: "Mark 5-hour limit", value: "five_hour" },
        { title: "Mark weekly limit", value: "weekly" },
        { title: "Mark monthly limit", value: "monthly" },
        { title: "Rename", value: "rename" },
        { title: "Activate natively in OpenCode", value: "activate" },
        { title: "Remove credential", value: "remove" },
      ],
    })
    if (!action) return

    try {
      if (action === "use") {
        await props.rpc.use({
          providerID: current.providerID,
          credentialID,
          modelID: modelID(),
        })
        await toast(`Using ${account?.label ?? credentialID}`, "success")
      } else if (action === "up" || action === "down") {
        const order = current.accounts
          .slice()
          .sort((left, right) => left.priority - right.priority)
          .map((entry) => entry.credentialID)
        const index = order.indexOf(credentialID)
        const target = action === "up" ? index - 1 : index + 1
        if (index >= 0 && target >= 0 && target < order.length) {
          const [moved] = order.splice(index, 1)
          order.splice(target, 0, moved)
          await props.rpc.setPriority({
            providerID: current.providerID,
            credentialIDs: order,
          })
          await toast("Priority updated", "success")
        }
      } else if (action === "toggle") {
        await props.rpc.setEnabled({
          providerID: current.providerID,
          credentialID,
          enabled: !(account?.enabled ?? true),
        })
      } else if (action === "reset") {
        await props.rpc.resetCooldown({
          providerID: current.providerID,
          credentialID,
        })
        await toast("Cooldown reset", "success")
      } else if (
        action === "five_hour" ||
        action === "weekly" ||
        action === "monthly"
      ) {
        await props.rpc.markCooldown({
          providerID: current.providerID,
          credentialID,
          modelID: modelID(),
          reason: action,
        })
        await toast(`Marked as ${action}`, "success")
      } else if (action === "rename") {
        const label = await props.context.ui.dialog.prompt({
          title: "Rename account",
          value: account?.label ?? "",
        })
        if (label && label.trim()) {
          await props.context.client.credential.update({
            credentialID,
            label: label.trim(),
          })
        }
      } else if (action === "activate") {
        await props.context.client.credential.activate({ credentialID })
        await toast("Native active credential changed", "success")
      } else if (action === "remove") {
        const confirmed = await props.context.ui.dialog.confirm({
          title: "Remove credential?",
          message: `This removes ${account?.label ?? credentialID} from OpenCode, not only from the balancer.`,
          label: { confirm: "Remove", cancel: "Cancel" },
        })
        if (confirmed) {
          await props.context.client.credential.remove({ credentialID })
          await toast("Credential removed", "success")
        }
      }
      await refresh()
    } catch (cause) {
      await toast(errorText(cause), "error")
    }
  }

  // Register the page commands from the component body so they exist even if
  // one of the data subscriptions below fails. OpenCode disposes layers that
  // a component creates when the route unmounts.
  props.context.keymap.layer(() => ({
    mode: "global",
    // Let an open dialog keep escape for itself; this layer only needs it when
    // the dashboard is the topmost surface.
    priority: -1,
    commands: [
      {
        id: "opencode-multikey.close",
        title: "Close Multikey dashboard",
        group: "Multikey",
        palette: true,
        bind: "escape",
        run: () => closeDashboard(),
      },
      {
        id: "opencode-multikey.actions",
        title: "Multikey account actions",
        group: "Multikey",
        palette: true,
        bind: "a",
        run: () => void accountActions(),
      },
      {
        id: "opencode-multikey.add",
        title: "Add a Multikey account",
        group: "Multikey",
        palette: true,
        bind: "n",
        run: () => void addAccount(),
      },
      {
        id: "opencode-multikey.toggle",
        title: "Toggle Multikey balancing",
        group: "Multikey",
        palette: true,
        bind: "b",
        run: () => void toggleBalancing(),
      },
      {
        id: "opencode-multikey.diagnostics",
        title: "Show Multikey diagnostics",
        group: "Multikey",
        palette: true,
        bind: "g",
        run: () => void showDiagnostics(),
      },
      {
        id: "opencode-multikey.targets",
        title: "Show managed providers",
        group: "Multikey",
        palette: true,
        bind: "t",
        run: () => void showTargets(),
      },
      {
        id: "opencode-multikey.refresh",
        title: "Refresh Multikey",
        group: "Multikey",
        palette: true,
        bind: "r",
        run: () => void refresh(),
      },
    ],
  }))

  onMount(() => {
    void refresh()
    const clock = setInterval(() => setNow(Date.now()), 1_000)
    const poll = setInterval(() => void refresh(), 10_000)
    const offCredential = props.context.data.on("credential.updated", () => {
      void refresh()
    })
    const offSwitched = props.context.data.on("credential.switched", () => {
      void refresh()
    })
    const offIntegration = props.context.data.on("integration.updated", () => {
      void refresh()
    })
    const offRpc = props.rpc.events.on("updated", () => {
      void refresh()
    })

    onCleanup(() => {
      clearInterval(clock)
      clearInterval(poll)
      offCredential()
      offSwitched()
      offIntegration()
      offRpc()
    })
  })

  return (
    <box flexDirection="column" padding={1}>
      <text>opencode-multikey</text>
      <text>{headerText()}</text>
      <Show when={status()}>
        <text>{statusSummary(status())}</text>
      </Show>
      <Show when={loading() && status()}>
        <text>Refreshing…</text>
      </Show>
      <Show when={error()}>
        <text>{`Error: ${error()}`}</text>
        <text>Press r to retry or esc to return home.</text>
      </Show>
      <Show when={loaded() && status() && !status()?.integrationID}>
        <text>
          This provider is not managed by opencode-multikey. Press t to list
          managed providers.
        </text>
      </Show>
      <Show
        when={
          loaded() &&
          (status()?.integrationID?.length ?? 0) > 0 &&
          (status()?.accounts.length ?? 0) === 0
        }
      >
        <text>No key accounts. Press n for instructions.</text>
      </Show>
      <For each={status()?.accounts ?? []}>
        {(account) => <text>{accountLine(account, now())}</text>}
      </For>
      <Show when={targets().length > 0}>
        <text>{`Managed: ${targets()
          .map((target) => target.providerID)
          .join(", ")}`}</text>
      </Show>
      <text>
        esc close · a account actions · n add key · b toggle balancing · g diagnostics · t providers · r refresh
      </text>
    </box>
  )
}
