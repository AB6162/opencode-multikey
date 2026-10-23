# Changelog

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
