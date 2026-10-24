# Changelog

## 0.1.5

- Replaced the custom plugin route with a host-rendered dialog dashboard. This
  fixes npm installs where the plugin and OpenCode load different Solid
  instances: data is fetched before the dialog opens, so the screen no longer
  stays on “Loading accounts…” forever.
- The dialog uses the same card layout, health colors, legend and key hints.
- Help is now a host-rendered dialog with every option explained.
- Account actions refresh the dashboard after they finish.
- Fixed the key hints showing `[undefined]` instead of the actual keys.
- Removed the footer status badge, which could not update reliably when the
  plugin was installed from npm.

## 0.1.4

- Fixed the “Plugin opencode-multikey.tui crashed in route: No renderer found”
  error. The dashboard now reads terminal dimensions from `context.renderer`
  instead of importing `useTerminalDimensions()` from `@opentui/solid`, which
  resolves to a different renderer context in installed plugins.

## 0.1.3

- Redesigned the dashboard with the active OpenCode theme: framed header,
  account cards, health colors, status legend and keycap footer.
- Added a `?` help screen that explains balancing, priority vs preferred,
  selected vs native active, cooldown vs quota, and reset vs remove.
- Account actions now have categories and descriptions, so similar actions
  such as "Use", "Activate natively", "Reset" and "Remove" are distinguishable.
- The account list shows selected, preferred, native-active and disabled state
  separately, plus quota, cooldown and failure details.

## 0.1.2

- Fixed the TUI calling the plugin RPC without its location, which made every
  request fail with `rpc.unavailable` and left the dashboard on “Loading…” with
  no accounts.
- Bound every TUI RPC call to the location of the running plugin instance.
- Added `escape` to close the dashboard and return to OpenCode.
- The dashboard no longer shows “No key accounts” while it is loading or after
  an RPC error; it shows the real error and a retry hint instead.
- Filtered failover toasts by location so one project no longer shows another
  project's notifications.

## 0.1.1

- Fixed the TUI dashboard staying on “Loading…” when OpenCode reports `null` provider/model IDs.
- Optional RPC inputs now accept `null` as well as missing values.
- TUI errors now show the RPC message instead of `[object Object]`.
- Added tests for TUI input sanitization and error formatting.

## 0.1.0

- Initial OpenCode V2 plugin.
- Multiple key accounts per provider, defaulting to `opencode-go`.
- Automatic credential failover on quota, rate limit, server and authentication errors.
- Model-scoped quota tracking for OpenCode Go's 5-hour, weekly and monthly limits.
- 5-hour, weekly, monthly and billing error classification with reset timestamp parsing.
- TUI dashboard, account actions, priority ordering, cooldowns and diagnostics.
- RPC contract for TUI and external clients.
- Headless `multikey` tool.
- Optional V1 API-key migration.
