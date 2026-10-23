# opencode-multikey

[![npm version](https://img.shields.io/npm/v/opencode-multikey.svg)](https://www.npmjs.com/package/opencode-multikey)
[![npm downloads](https://img.shields.io/npm/dm/opencode-multikey.svg)](https://www.npmjs.com/package/opencode-multikey)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![OpenCode V2](https://img.shields.io/badge/OpenCode-V2-111111.svg)](https://opencode.ai/v2/docs/)

**Multi-key credential failover for OpenCode V2 providers.**

`opencode-multikey` keeps several API keys for the same provider and switches credentials automatically when the current key hits a quota or a retryable failure. It changes **only the key**; the provider and model stay the same.

```
opencode-go/glm-5.3
  key A  → 429 GoUsageLimitError (5-hour limit)
  key B  → retry succeeds
```

## Why

- OpenCode Go limits are per model: 5-hour, weekly and monthly windows.
- A single key eventually hits a limit.
- `opencode-multikey` rotates to another healthy key **inside the same request**, without changing the provider or the model.
- Keys stay in OpenCode's credential database. The plugin never stores them in its own storage.

## Requirements

- **OpenCode V2** (V1 is not supported).
- `@opencode/plugin` 2.1.3 or newer in the 2.x line.
- Two or more saved API-key accounts for the same integration.
- Default target: **OpenCode Go** (`opencode-go`).
- The plugin manages **key credentials only**. OAuth, external and environment connections are left untouched.

## Install from npm

OpenCode installs npm plugins itself. You do **not** run `npm install opencode-multikey` in your project.

Add the package to `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-multikey"]
}
```

`plugins` is plural. Do **not** use the V1 `plugin` key.

Restart OpenCode. The same package provides the server hooks and the TUI dashboard.

To pass options, use the object form:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-multikey",
      "options": {
        "providers": ["opencode-go"]
      }
    }
  ]
}
```

To pin a version:

```jsonc
{
  "plugins": ["opencode-multikey@0.1.2"]
}
```

Omit the version to let OpenCode refresh to newer published versions on restart.

### Global or project install

| Scope | File |
| --- | --- |
| All projects | `~/.config/opencode/opencode.json(c)` |
| One project | `<project>/opencode.json(c)` or `<project>/.opencode/opencode.json(c)` |

If you use a remote OpenCode server, install the plugin on the server. The CLI gets the active plugin list from the connected server.

### Verify

```bash
opencode plugin list
```

Look for `opencode-multikey`. In a project-scoped setup, the most reliable check is opening `/multikey` in the TUI.

In the TUI:

```text
/multikey
```

The package exports `./tui`, so **no `tui.json` is required**.

## Add two keys

OpenCode V2 already supports multiple accounts per integration:

1. Run `/connect`.
2. Select **OpenCode Go**.
3. Paste key 1.
4. Run `/connect` again.
5. Select **OpenCode Go**.
6. Paste key 2.

If selecting an already-connected provider opens its account list, use the add-account action and repeat for each key.

The plugin detects new credentials through `credential.updated` and refreshes the dashboard automatically. The key is entered only in OpenCode's native `/connect` flow; `opencode-multikey` never stores keys in its own storage.

> Two keys from the same workspace may share the same Go quota. For real failover, use keys whose quotas are independent.

## Open the dashboard

Open the dashboard with:

- `/multikey`
- `/mk`
- The command palette: **Open Multikey dashboard**

The dashboard shows:

- provider and resolved integration,
- whether balancing is on,
- the key that would be used for the current model,
- each key's priority, native-active flag, health, cooldown and per-model quota,
- optional diagnostics.

A compact `MK:key` indicator is added to the home and prompt footer status slots.

Dashboard keys:

| Key | Action |
| --- | --- |
| `esc` | Close the dashboard and return to OpenCode |
| `a` | Account actions: use, move up/down in priority, enable/disable, reset cooldown/auth, mark 5h/weekly/monthly, rename, activate natively, remove |
| `n` | Instructions to add another key through `/connect` |
| `b` | Toggle balancing on/off |
| `g` | Show redacted diagnostics |
| `t` | Show managed providers |
| `r` | Refresh |

There is no default global keybind, so the plugin does not collide with OpenCode's bindings.

## How it works

OpenCode V2 resolves the native active credential when it prepares a request. Retries reuse that prepared request. `credential.activate` alone therefore cannot switch keys in the middle of a retry.

`opencode-multikey` uses the official V2 hooks:

1. `session.hook("http.request")` selects the first healthy key for the current model and rewrites the request's `Authorization` header.
2. `session.hook("http.response")` records which key produced a retryable response.
3. `session.hook("retry")` marks the failed key, picks the next healthy key, and forces `{ retry: true, delay: 0 }`.

The next HTTP attempt receives the next key's header. The provider and model do not change.

### Failure handling

| Failure | Behavior | Cooldown |
| --- | --- | --- |
| `provider.quota` / HTTP 402 / 429 quota text | Switch key | 5h / weekly / monthly / billing, parsed from the message or `retry-after` |
| `provider.rate-limit` / HTTP 429 | Switch key | Reset timestamp, `retry-after` or 60s |
| HTTP 500/502/503/504/529 | Switch key | 60s |
| HTTP 401 / auth 403 | Switch key and mark auth-invalid | Manual reset |
| HTTP 400/413/422/403 content policy | No switch | — |

Quota is tracked **per key and per model**, because OpenCode Go defines its 5-hour, weekly and monthly limits per model. A key that is exhausted for one model can still serve another model.

If every managed key is cooling down, the plugin does not force another retry. The original OpenCode error is surfaced, and the dashboard shows the cooldown and reset time.

### Go quota detection

OpenCode classifies the Go `GoUsageLimitError` as `provider.quota`. The plugin recognizes:

- `5-hour`, `five hour`, `rolling 5`, `5h`
- `weekly`, `week limit`, `7-day`
- `monthly`, `month limit`, `billing period`
- `insufficient balance`, `credit limit`, `billing`, `top up`, `extra usage`

It also extracts reset information when present:

- ISO timestamps such as `2026-10-23T20:00:00Z`,
- epoch fields such as `"resets_at": 1790000000`,
- relative text such as `resets in 2h`.

If the provider sends `retry-after`, that value bounds the cooldown. If the message also includes a reset timestamp, the later of the two is used. If the text does not identify a window, the plugin falls back to the configurable unknown-quota cooldown (5 hours by default).

## Configuration

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-multikey",
      "options": {
        "providers": ["opencode-go"],
        "enabled": true,
        "syncActive": false,
        "authStyle": "bearer",
        "diagnostics": false,
        "diagnosticsLimit": 50,
        "maxBodyBytes": 65536,
        "toast": true,
        "cooldowns": {
          "quotaUnknownMs": 18000000,
          "rateLimitMs": 60000,
          "serverErrorMs": 60000,
          "billingMs": 2592000000
        },
        "quotaPatterns": {
          "fiveHour": ["your custom 5h pattern"],
          "weekly": [],
          "monthly": [],
          "billing": []
        }
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `providers` | `["opencode-go"]` | Provider IDs managed by the plugin |
| `enabled` | `true` | Initial balancing state; the dashboard can toggle it |
| `syncActive` | `false` | Also call `credential.activate` after a failover. Routing does not depend on it |
| `authStyle` | `"bearer"` | `"bearer"` sets `Authorization: Bearer`; `"auto"` replaces an existing auth header |
| `diagnostics` | `false` | Store redacted failure entries for the dashboard |
| `diagnosticsLimit` | `50` | Maximum stored diagnostic entries |
| `maxBodyBytes` | `65536` | Maximum error body captured in diagnostics |
| `toast` | `true` | Show a TUI toast on failover |
| `cooldowns` | see above | Cooldown durations in milliseconds |
| `quotaPatterns` | built-in | Extra regex patterns for quota windows |

`providers` entries are resolved at runtime. For each provider, the plugin uses:

```text
provider.integrationID ?? providerID
```

This matters because OpenCode can map a provider to an integration with a different ID. Only key credentials are eligible.

## Headless tool

The server plugin registers a `multikey` tool:

| Action | Description |
| --- | --- |
| `status` | Account status, health and selected key |
| `targets` | Managed providers |
| `accounts` | Account list with priority and health |
| `use` | Make an account preferred and reset its cooldown |
| `enable` / `disable` | Enable or disable an account in the balancer |
| `reset` | Clear account or model cooldown |
| `mark` | Manually mark 5h/weekly/monthly/billing/rate/server cooldown |
| `diagnose` | Redacted recent failures |
| `migrate-v1` | Import API-key accounts from the V1 balancer database |

The tool is useful with `opencode run` and does not require the TUI.

## RPC

The server plugin exposes the `opencode-multikey` RPC for the TUI and external clients:

- `status`
- `targets`
- `setPriority`
- `use`
- `setEnabled`
- `resetCooldown`
- `markCooldown`
- `setSettings`
- `diagnostics`
- `refresh`

The RPC never returns credential secrets.

External clients can import the contract:

```ts
import { OpenCode } from "@opencode/client"
import { MultikeyRpc } from "opencode-multikey/rpc"

const client = OpenCode.make({ baseUrl: "http://127.0.0.1:4096" })
const rpc = client.rpc(MultikeyRpc)
const status = await rpc.status({ providerID: "opencode-go" })
```

## V1 migration

`multikey migrate-v1` imports **API-key** accounts from the old `@thelioo/opencode-balancer` SQLite store:

- Windows/XDG location: `~/.config/opencode/balancer.sqlite`
- Legacy Windows location: `%LOCALAPPDATA%/opencode/balancer.sqlite`

It reads the old database, deduplicates keys already present, and writes new credentials through OpenCode's native integration API. It never modifies or deletes the V1 database.

OAuth and well-known accounts cannot be migrated automatically; reconnect them with `/connect`.

## Security

- Keys stay in OpenCode's credential database, not in `opencode-multikey` storage.
- The plugin resolves a key in memory only to write the request header.
- Plugin storage contains credential IDs, labels, cooldowns and counters, never secrets.
- Diagnostics are opt-in, truncated, and redacted (`oc_sk_...`, `sk-...`, `Bearer ...`, API-key fields).
- RPC responses never include key material.
- Logs use the `[opencode-multikey]` prefix and never print keys.

## Limitations

- **Same provider only.** The plugin never changes the model or provider. Cross-provider failover is out of scope.
- **No proactive quota query.** OpenCode Go does not expose a verified public usage endpoint for provider keys. The plugin reacts to the actual error and parses its reset information.
- **Key-only failover.** OAuth, external and environment connections are passthrough.
- **Shared integration keys.** If OpenCode maps `opencode-go` to an integration that also stores unrelated key credentials, disable those keys in the dashboard. The plugin cannot tell which key belongs to which product from the credential alone.
- **Shared quota is not magic.** Two keys from the same workspace may both be exhausted at the same time.
- **OpenCode retry budget.** OpenCode caps retries; with two or three keys this is normally enough. If every key is cooling, the error is surfaced.
- **Empirical Go wording.** The `GoUsageLimitError` classification is confirmed in OpenCode source; the exact reset wording can vary. Use `diagnostics` and `quotaPatterns` if a new wording appears.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Plugin does not load | `plugins` is plural; OpenCode is V2; restart OpenCode |
| Dashboard does not appear | The package is listed in `opencode.json`; no `tui.json` is needed; try `/multikey` |
| Dashboard stays on “Loading…” | Update to `opencode-multikey@0.1.2` or newer and restart OpenCode |
| `opencode plugin list` does not show it | Check the config scope (global vs project) and restart the service |
| No accounts | Run `/connect` twice and select OpenCode Go each time |
| Provider is not managed | `providers` includes the provider ID; check the dashboard's `t` view |
| Key does not switch | Enable `diagnostics`; check the error type/status; add a custom `quotaPatterns` entry |
| Both keys cooling | Wait for the reset, use the dashboard to reset a cooldown, or add another independent key |
| Key was removed | The next refresh prunes its local state automatically |
| TUI shows `MK:-` | The current model's provider is not managed or has no key accounts |

Logs:

```bash
OPENCODE_LOG_LEVEL=DEBUG opencode
```

Filter the log for `[opencode-multikey]`.

## Updating

- Remove a version pin or change it, then restart OpenCode.
- `opencode plugin update` updates package plugins.
- If the service keeps an old package cached, run `opencode service restart`.

## Uninstall

- Remove `opencode-multikey` from `plugins` in `opencode.json(c)` and restart.
- If it was installed through the CLI, run `opencode plugin remove opencode-multikey`.
- Removing the plugin leaves OpenCode's saved credentials untouched. Remove keys separately with `/connect` or `opencode auth logout` if desired.

## Development

This section is for contributors. Normal users should install from npm.

```bash
bun install
bun run typecheck
bun test
bun run check
```

The tests use a fake provider flow and do not consume real quotas.

### Contributor-only local loading

A local package can be referenced with a directory URL:

```jsonc
{
  "plugins": [
    {
      "package": "file:///absolute/path/to/opencode-multikey",
      "options": { "providers": ["opencode-go"] }
    }
  ]
}
```

On Windows use a URL such as `file:///C:/Users/you/plugins/opencode-multikey`.

If your OpenCode build ignores the `file://` entry, use local plugin discovery, which was verified with OpenCode 2.1.3. Create these two files inside your project:

`.opencode/plugins/opencode-multikey/index.ts`:

```ts
export { default } from "file:///absolute/path/to/opencode-multikey/src/index.ts"
```

`.opencode/plugins/opencode-multikey/tui.tsx`:

```ts
export { default } from "file:///absolute/path/to/opencode-multikey/src/tui.tsx"
```

OpenCode discovers both files and reports the plugin with `features: { server: true, tui: true }`. Restart OpenCode after creating them.

## Publishing

Maintainer checklist:

```bash
bun install
bun run check
npm pack --dry-run
npm login
npm publish --access public
```

Before publishing:

1. Update `version` in `package.json`.
2. Verify `name` is `opencode-multikey` (or your scoped name).
3. Verify the `files` list includes `src`, `README.md`, `INSTALL.md`, `CHANGELOG.md` and `LICENSE`.
4. Commit and tag the release:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The package publishes TypeScript source. OpenCode loads it with Bun.

## Validation performed

- TypeScript typecheck against `@opencode/plugin` 2.1.4.
- 84 unit, TUI and hook-flow tests.
- Loaded with OpenCode 2.1.3 as a local plugin with `features: { server: true, tui: true }` and state `active`.
- Verified the dashboard end-to-end with OpenCode 2.1.3's headless TUI: the saved OpenCode Go account renders with its location-scoped RPC, and `escape` returns to the home screen.
- Manual end-to-end test with a fake OpenAI-compatible provider: key A returned `429 GoUsageLimitError` with `retry-after: 18000`, key B returned a valid SSE response, and OpenCode completed the run. No real provider quota was consumed.
- `npm pack` tarball imported successfully as `opencode-multikey`, `opencode-multikey/rpc` and `opencode-multikey/tui`.
- `npm publish --dry-run` completed successfully.

The exact reset text of a real OpenCode Go `429` is the only field verified through a simulated body. Use `diagnostics` and `quotaPatterns` if the real wording differs.

## Contributing

- Open an issue for bugs or provider wording changes.
- Keep the plugin V2-native; do not port V1 hooks or the global `fetch` patch.
- Add tests for new failure classifications and selection rules.
- Run `bun run check` before opening a pull request.
- Never commit real API keys, the OpenCode credential database, or diagnostic bodies with secrets.

## License

MIT. See [LICENSE](./LICENSE).

`opencode-multikey` is inspired by the architecture of `@thelioo/opencode-balancer`, but is a V2-native implementation. It does not bypass provider limits, create accounts, or modify quotas.
