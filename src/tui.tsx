/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { MultikeyRpc } from "./rpc"
import { openDashboard } from "./tui/dashboard"
import { sameDirectory, scopedRpc } from "./tui/types"

export default Plugin.define({
  id: "opencode-multikey.tui",
  setup(context) {
    const rpc = scopedRpc(context, context.client.rpc(MultikeyRpc))

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-multikey.open",
          title: "Open Multikey dashboard",
          description: "Inspect and manage opencode-multikey accounts",
          group: "Multikey",
          palette: true,
          slash: { name: "multikey", aliases: ["mk"] },
          run: () => {
            void openDashboard(context, rpc)
          },
        },
      ],
    }))

    const offUpdates =
      context.options.toast === false
        ? undefined
        : rpc.events.on("updated", (event) => {
            const location = context.location ?? context.data.location.default()
            if (
              !sameDirectory(event.location?.directory, location?.directory)
            ) {
              return
            }
            const data = event.data as {
              kind?: string
              modelID?: string
              reason?: string
              from?: string
              to?: string
              toast?: boolean
            }
            if (data.toast === false) return
            if (data.kind === "failover") {
              context.ui.toast.show({
                title: "opencode-multikey",
                message: `Key switched${data.modelID ? ` for ${data.modelID}` : ""}${
                  data.reason ? ` (${data.reason})` : ""
                }`,
                variant: "warning",
                duration: 5_000,
              })
              return
            }
            if (data.kind === "auth") {
              context.ui.toast.show({
                title: "opencode-multikey",
                message: `Credential authentication failed${
                  data.modelID ? ` for ${data.modelID}` : ""
                }; trying another key`,
                variant: "error",
                duration: 5_000,
              })
              return
            }
            if (data.kind === "exhausted") {
              context.ui.toast.show({
                title: "opencode-multikey",
                message: "Every managed key is cooling down or unavailable",
                variant: "error",
                duration: 7_000,
              })
            }
          })

    return () => {
      offUpdates?.()
    }
  },
})
