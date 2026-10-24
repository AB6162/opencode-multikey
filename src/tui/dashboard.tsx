/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import type { Context } from "@opencode/plugin/tui/context"
import type {
  AccountStatus,
  DiagnosticEntry,
  StatusOutput,
  TargetSummary,
} from "../types"
import {
  accountHealthText,
  accountHealthTone,
  accountMeta,
  diagnosticsText,
  errorText,
  statusHeader,
  targetsText,
} from "./format"
import { KEY_HELP, accountActionOptions, buildHelpLines } from "./help"
import { modelIDOf, modelInput, textValue } from "./input"
import type { MultikeyRpcClient } from "./types"

export type Snapshot = {
  status: StatusOutput
  targets: TargetSummary[]
}

async function load(
  context: Context,
  rpc: MultikeyRpcClient,
): Promise<Snapshot> {
  const current = await rpc.status(modelInput(context.ui.model.current()))
  let targets: TargetSummary[] = []
  try {
    const result = (await rpc.targets({})) as { targets: TargetSummary[] }
    targets = result.targets
  } catch {
    // A failed provider listing must not hide a valid account snapshot.
  }
  return { status: current as StatusOutput, targets }
}

function toneColor(context: Context, tone: ReturnType<typeof accountHealthTone>) {
  const theme = context.theme
  switch (tone) {
    case "success":
      return theme.text.feedback.success.base
    case "warning":
      return theme.text.feedback.warning.base
    case "error":
      return theme.text.feedback.error.base
    default:
      return theme.text.faint
  }
}

function accountFlags(account: AccountStatus) {
  return [
    account.preferred ? "preferred" : undefined,
    account.nativeActive ? "native active" : undefined,
    account.enabled ? undefined : "disabled",
    account.authInvalid ? "auth invalid" : undefined,
  ].filter((flag): flag is string => Boolean(flag))
}

function currentModel(context: Context) {
  return modelInput(context.ui.model.current())
}

async function showHelp(context: Context, rpc: MultikeyRpcClient) {
  const width = Math.min(76, Math.max(40, context.renderer.width - 16))
  const message = buildHelpLines(width)
    .map((line) => line.text)
    .join("\n")
  const closed = context.ui.dialog.alert({
    title: "Multikey help",
    message,
  })
  context.ui.dialog.set({ size: "large", centered: true })
  await closed
  await openDashboard(context, rpc)
}

async function addAccount(context: Context, rpc: MultikeyRpcClient) {
  await context.ui.dialog.alert({
    title: "Add an OpenCode Go key",
    message:
      "Use OpenCode's native account flow:\n\n1. Run /connect\n2. Select OpenCode Go\n3. Paste the key\n4. Repeat /connect for every additional key\n\nThe dashboard detects new credentials automatically. The plugin never asks for or stores the key itself.",
  })
  await openDashboard(context, rpc)
}

async function toggleBalancing(
  context: Context,
  rpc: MultikeyRpcClient,
  status: StatusOutput,
) {
  try {
    await rpc.setSettings({ balancingEnabled: !status.balancingEnabled })
    context.ui.toast.show({
      message: `Balancing ${status.balancingEnabled ? "disabled" : "enabled"}`,
      variant: "success",
    })
  } catch (cause) {
    context.ui.toast.show({ message: errorText(cause), variant: "error" })
  }
  await openDashboard(context, rpc)
}

async function showDiagnostics(
  context: Context,
  rpc: MultikeyRpcClient,
  status: StatusOutput,
) {
  try {
    const providerID =
      textValue(status.providerID) ?? currentModel(context).providerID
    const result = (await rpc.diagnostics({
      ...(providerID ? { providerID } : {}),
      limit: 20,
    })) as { entries: DiagnosticEntry[] }
    context.ui.dialog.set({ size: "large", centered: true })
    await context.ui.dialog.alert({
      title: "Multikey diagnostics",
      message: diagnosticsText(result.entries).slice(0, 8_000),
    })
  } catch (cause) {
    context.ui.toast.show({ message: errorText(cause), variant: "error" })
  }
  await openDashboard(context, rpc)
}

async function showTargets(context: Context, rpc: MultikeyRpcClient) {
  try {
    const result = (await rpc.targets({})) as { targets: TargetSummary[] }
    context.ui.dialog.set({ size: "medium", centered: true })
    await context.ui.dialog.alert({
      title: "Managed providers",
      message: targetsText(result.targets),
    })
  } catch (cause) {
    context.ui.toast.show({ message: errorText(cause), variant: "error" })
  }
  await openDashboard(context, rpc)
}

async function accountActions(
  context: Context,
  rpc: MultikeyRpcClient,
  status: StatusOutput,
) {
  if (status.accounts.length === 0) {
    await addAccount(context, rpc)
    return
  }

  const credentialID = await context.ui.dialog.select({
    title: "Multikey account",
    options: status.accounts.map((account) => ({
      title: `${account.label} · ${accountHealthText(account, Date.now())}`,
      value: account.credentialID,
      description: `#${account.priority} · ${accountMeta(account, Date.now())}`,
    })),
  })
  if (!credentialID) {
    await openDashboard(context, rpc)
    return
  }

  const account = status.accounts.find(
    (entry) => entry.credentialID === credentialID,
  )
  const action = await context.ui.dialog.select({
    title: `Action: ${account?.label ?? credentialID}`,
    placeholder: "Choose one action · descriptions explain the difference",
    options: accountActionOptions(account),
  })
  if (!action) {
    await openDashboard(context, rpc)
    return
  }

  try {
    if (action === "use") {
      await rpc.use({
        providerID: status.providerID,
        credentialID,
        modelID: modelIDOf(context.ui.model.current()),
      })
      context.ui.toast.show({
        message: `Using ${account?.label ?? credentialID}`,
        variant: "success",
      })
    } else if (action === "up" || action === "down") {
      const order = status.accounts
        .slice()
        .sort((left, right) => left.priority - right.priority)
        .map((entry) => entry.credentialID)
      const index = order.indexOf(credentialID)
      const target = action === "up" ? index - 1 : index + 1
      if (index >= 0 && target >= 0 && target < order.length) {
        const [moved] = order.splice(index, 1)
        order.splice(target, 0, moved)
        await rpc.setPriority({
          providerID: status.providerID,
          credentialIDs: order,
        })
        context.ui.toast.show({ message: "Priority updated", variant: "success" })
      }
    } else if (action === "toggle") {
      await rpc.setEnabled({
        providerID: status.providerID,
        credentialID,
        enabled: !(account?.enabled ?? true),
      })
    } else if (action === "reset") {
      await rpc.resetCooldown({
        providerID: status.providerID,
        credentialID,
      })
      context.ui.toast.show({ message: "Cooldown reset", variant: "success" })
    } else if (
      action === "five_hour" ||
      action === "weekly" ||
      action === "monthly"
    ) {
      await rpc.markCooldown({
        providerID: status.providerID,
        credentialID,
        modelID: modelIDOf(context.ui.model.current()),
        reason: action,
      })
      context.ui.toast.show({
        message: `Marked as ${action}`,
        variant: "success",
      })
    } else if (action === "rename") {
      const label = await context.ui.dialog.prompt({
        title: "Rename account",
        value: account?.label ?? "",
      })
      if (label && label.trim()) {
        await context.client.credential.update({
          credentialID,
          label: label.trim(),
        })
      }
    } else if (action === "activate") {
      await context.client.credential.activate({ credentialID })
      context.ui.toast.show({
        message: "Native active credential changed",
        variant: "success",
      })
    } else if (action === "remove") {
      const confirmed = await context.ui.dialog.confirm({
        title: "Remove credential?",
        message: `This removes ${account?.label ?? credentialID} from OpenCode, not only from the balancer.`,
        label: { confirm: "Remove", cancel: "Cancel" },
      })
      if (confirmed) {
        await context.client.credential.remove({ credentialID })
        context.ui.toast.show({ message: "Credential removed", variant: "success" })
      }
    }
  } catch (cause) {
    context.ui.toast.show({ message: errorText(cause), variant: "error" })
  }
  await openDashboard(context, rpc)
}

function KeyHint(props: { context: Context; shortcut: string; label: string }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={props.context.theme.text.action.primary.base}>
        {`[${props.shortcut}]`}
      </text>
      <text fg={props.context.theme.text.muted}>{props.label}</text>
    </box>
  )
}

export function DashboardPanel(props: {
  context: Context
  rpc: MultikeyRpcClient
  snapshot: Snapshot
}) {
  const context = props.context
  const theme = () => context.theme
  const status = () => props.snapshot.status
  const accounts = () => status().accounts
  const selected = () =>
    accounts().find(
      (account) => account.credentialID === status().selectedCredentialID,
    )
  const native = () =>
    accounts().find(
      (account) => account.credentialID === status().nativeActiveCredentialID,
    )
  const healthy = () => accounts().filter((account) => account.healthy).length

  context.keymap.layer(() => ({
    mode: "global",
    priority: -1,
    commands: [
      {
        id: "opencode-multikey.help",
        title: "Multikey help",
        group: "Multikey",
        bind: "?",
        run: () => void showHelp(context, props.rpc),
      },
      {
        id: "opencode-multikey.actions",
        title: "Multikey account actions",
        group: "Multikey",
        bind: "a",
        run: () => void accountActions(context, props.rpc, status()),
      },
      {
        id: "opencode-multikey.add",
        title: "Add a Multikey account",
        group: "Multikey",
        bind: "n",
        run: () => void addAccount(context, props.rpc),
      },
      {
        id: "opencode-multikey.toggle",
        title: "Toggle Multikey balancing",
        group: "Multikey",
        bind: "b",
        run: () => void toggleBalancing(context, props.rpc, status()),
      },
      {
        id: "opencode-multikey.diagnostics",
        title: "Show Multikey diagnostics",
        group: "Multikey",
        bind: "g",
        run: () => void showDiagnostics(context, props.rpc, status()),
      },
      {
        id: "opencode-multikey.targets",
        title: "Show managed providers",
        group: "Multikey",
        bind: "t",
        run: () => void showTargets(context, props.rpc),
      },
      {
        id: "opencode-multikey.refresh",
        title: "Refresh Multikey",
        group: "Multikey",
        bind: "r",
        run: () => void openDashboard(context, props.rpc),
      },
    ],
  }))

  return (
    <box
      width="100%"
      flexDirection="column"
      padding={1}
      gap={1}
      backgroundColor={theme().background.base}
    >
      <box
        width="100%"
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme().border.base}
        backgroundColor={theme().background.raised.base}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box width="100%" flexDirection="row" alignItems="center">
          <text attributes={TextAttributes.BOLD} fg={theme().text.base}>
            OPENCODE MULTIKEY
          </text>
          <box flexGrow={1} />
          <text
            fg={
              status().balancingEnabled
                ? theme().text.feedback.success.base
                : theme().text.feedback.warning.base
            }
          >
            {status().balancingEnabled ? "● balancing on" : "○ balancing off"}
          </text>
        </box>
        <text fg={theme().text.muted}>{statusHeader(status())}</text>
        <box
          width="100%"
          flexDirection="row"
          flexWrap="wrap"
          columnGap={2}
          rowGap={0}
          marginTop={1}
        >
          <box flexDirection="row" gap={1}>
            <text fg={theme().text.faint}>Selected for this model:</text>
            <text fg={theme().text.base}>{selected()?.label ?? "none"}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme().text.faint}>Native active:</text>
            <text fg={theme().text.base}>{native()?.label ?? "none"}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme().text.faint}>Accounts:</text>
            <text fg={theme().text.base}>
              {`${healthy()}/${accounts().length} healthy`}
            </text>
          </box>
        </box>
        <text fg={theme().text.faint}>
          {`strategy ${status().strategy} · sync native ${
            status().syncActive ? "on" : "off"
          } · diagnostics ${status().diagnostics ? "on" : "off"}`}
        </text>
      </box>

      <box width="100%" flexDirection="column" gap={1}>
        <box width="100%" flexDirection="row">
          <text attributes={TextAttributes.BOLD} fg={theme().text.muted}>
            ACCOUNTS
          </text>
          <box flexGrow={1} />
          <text fg={theme().text.faint}>
            {`${healthy()}/${accounts().length} healthy`}
          </text>
        </box>

        {status().integrationID === undefined ? (
          <box
            width="100%"
            flexDirection="column"
            border
            borderStyle="rounded"
            borderColor={theme().text.feedback.warning.base}
            backgroundColor={theme().background.raised.base}
            padding={1}
            gap={1}
          >
            <text
              attributes={TextAttributes.BOLD}
              fg={theme().text.feedback.warning.base}
            >
              Provider not managed
            </text>
            <text fg={theme().text.muted} wrapMode="word" width="100%">
              The current model's provider is not managed by opencode-multikey.
              Press t to list managed providers, or add its ID to the providers
              option.
            </text>
          </box>
        ) : null}

        {status().integrationID !== undefined && accounts().length === 0 ? (
          <box
            width="100%"
            flexDirection="column"
            border
            borderStyle="rounded"
            borderColor={theme().text.feedback.warning.base}
            backgroundColor={theme().background.raised.base}
            padding={1}
            gap={1}
          >
            <text
              attributes={TextAttributes.BOLD}
              fg={theme().text.feedback.warning.base}
            >
              No key accounts yet
            </text>
            <text fg={theme().text.muted} wrapMode="word" width="100%">
              Run /connect, select OpenCode Go and paste a key. Repeat /connect
              for every additional key. Keys stay in OpenCode; this plugin never
              stores them.
            </text>
            <text fg={theme().text.faint}>
              Press n to see these instructions at any time.
            </text>
          </box>
        ) : null}

        {accounts().map((account) => {
          const tone = () => accountHealthTone(account, Date.now())
          const isSelected = () =>
            account.credentialID === status().selectedCredentialID
          return (
            <box
              width="100%"
              flexDirection="row"
              border={["left"]}
              borderColor={toneColor(context, tone())}
              backgroundColor={theme().background.raised.base}
              paddingLeft={1}
              paddingRight={1}
              gap={1}
            >
              <box width={4} flexShrink={0}>
                <text fg={theme().text.faint}>{`#${account.priority}`}</text>
              </box>
              <box flexGrow={1} flexDirection="column" minWidth={0} gap={0}>
                <box flexDirection="row" flexWrap="wrap" columnGap={1}>
                  <text attributes={TextAttributes.BOLD} fg={theme().text.base}>
                    {account.label}
                  </text>
                  {isSelected() ? (
                    <text fg={theme().text.action.primary.base}>selected</text>
                  ) : null}
                  {accountFlags(account).map((flag) => (
                    <text fg={theme().text.faint}>{flag}</text>
                  ))}
                </box>
                <text fg={theme().text.faint} wrapMode="word" width="100%">
                  {accountMeta(account, Date.now())}
                </text>
              </box>
              <box flexShrink={0}>
                <text fg={toneColor(context, tone())}>
                  {`● ${accountHealthText(account, Date.now())}`}
                </text>
              </box>
            </box>
          )
        })}

        {accounts().length > 0 ? (
          <box
            width="100%"
            flexDirection="row"
            flexWrap="wrap"
            columnGap={2}
            paddingLeft={1}
          >
            <text fg={theme().text.feedback.success.base}>● healthy</text>
            <text fg={theme().text.feedback.warning.base}>
              ● cooling / quota
            </text>
            <text fg={theme().text.feedback.error.base}>● auth invalid</text>
            <text fg={theme().text.faint}>● disabled</text>
          </box>
        ) : null}
      </box>

      {props.snapshot.targets.length > 0 ? (
        <box width="100%" flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme().text.faint}>Managed:</text>
          <text fg={theme().text.muted}>
            {props.snapshot.targets
              .map((target) => target.providerID)
              .join(", ")}
          </text>
        </box>
      ) : null}

      <box
        width="100%"
        flexDirection="column"
        border={["top"]}
        borderColor={theme().border.base}
        paddingTop={1}
        gap={1}
      >
        <box
          width="100%"
          flexDirection="row"
          flexWrap="wrap"
          columnGap={2}
          rowGap={1}
        >
          {KEY_HELP.map((item) => (
            <KeyHint
              context={context}
              shortcut={item.key}
              label={item.label}
            />
          ))}
        </box>
        <text fg={theme().text.faint} wrapMode="word" width="100%">
          The balancer changes only the key. It never changes the model or
          provider.
        </text>
      </box>
    </box>
  )
}

export async function openDashboard(
  context: Context,
  rpc: MultikeyRpcClient,
): Promise<void> {
  let snapshot: Snapshot
  try {
    snapshot = await load(context, rpc)
  } catch (cause) {
    context.ui.dialog.set({ size: "medium", centered: true })
    await context.ui.dialog.alert({
      title: "opencode-multikey",
      message: errorText(cause),
    })
    return
  }
  context.ui.dialog.show(() => (
    <DashboardPanel context={context} rpc={rpc} snapshot={snapshot} />
  ))
  context.ui.dialog.set({ size: "xlarge", centered: true })
}
