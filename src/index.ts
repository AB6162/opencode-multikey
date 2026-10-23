import { Plugin } from "@opencode/plugin"
import { setupServer } from "./server/plugin"

export default Plugin.define({
  id: "opencode-multikey",
  setup(ctx) {
    return setupServer(ctx)
  },
})
