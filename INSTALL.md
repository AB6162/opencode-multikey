# Install opencode-multikey

`opencode-multikey` is an npm package for OpenCode V2. OpenCode installs it from the `plugins` list; you do not need to run `npm install` in your project.

## 1. Add the package

Edit the global config at `~/.config/opencode/opencode.json(c)`, or a project `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-multikey"]
}
```

With options:

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

Use `plugins` (plural), not the V1 `plugin` key. Do not add a separate `tui.json`; the package exports `./tui` and the CLI loads it automatically.

To pin a version:

```jsonc
{
  "plugins": ["opencode-multikey@0.1.0"]
}
```

Restart OpenCode after changing the config.

## 2. Add two OpenCode Go keys

Run `/connect` twice:

1. `/connect` → **OpenCode Go** → paste key 1.
2. `/connect` → **OpenCode Go** → paste key 2.

If selecting an already-connected provider opens its account list, use the add-account action and repeat for each key.

OpenCode stores both accounts natively. `opencode-multikey` detects them and manages their priority and cooldowns.

## 3. Verify

```bash
opencode plugin list
```

Look for `opencode-multikey`. In a project-scoped setup, the most reliable check is opening `/multikey` in the TUI.

Open the dashboard:

```text
/multikey
```

You should see both keys, their priority, and the selected key.

For headless status:

```text
multikey status
```

## 4. Optional configuration

- Enable `diagnostics: true` to capture redacted 429 bodies.
- Set `syncActive: true` if you also want `/connect` to reflect the key used by the balancer.
- Add `quotaPatterns` if a provider changes its reset wording.
- Use `providers: ["opencode-go", "another-provider"]` for additional integrations. Each provider is managed independently; there is no cross-provider failover.

See the main [README](./README.md) for every option.

## 5. Update or uninstall

Update:

```bash
opencode plugin update
```

Then restart OpenCode if the service keeps an old package cached:

```bash
opencode service restart
```

Uninstall:

1. Remove `opencode-multikey` from `plugins` in `opencode.json(c)`.
2. Restart OpenCode.
3. If it was installed through the CLI, run `opencode plugin remove opencode-multikey`.

Removing the plugin does not remove OpenCode's saved credentials.

## Contributor-only local loading

Normal users should install from npm. For local development, a directory URL may work:

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

If your OpenCode build ignores the `file://` entry, use local plugin discovery. Create:

`.opencode/plugins/opencode-multikey/index.ts`:

```ts
export { default } from "file:///absolute/path/to/opencode-multikey/src/index.ts"
```

`.opencode/plugins/opencode-multikey/tui.tsx`:

```ts
export { default } from "file:///absolute/path/to/opencode-multikey/src/tui.tsx"
```

Both files are required for the dashboard. Restart OpenCode after creating them.

## Troubleshooting

- Plugin not loaded: confirm OpenCode V2, `plugins` plural, and restart.
- No accounts: run `/connect` twice for the same provider.
- No dashboard: confirm the package is listed in `opencode.json`; no `tui.json` is needed.
- Both keys cooling: wait for the reset, reset a cooldown from the dashboard, or add another independent key.
- Provider not managed: check `providers` in the plugin options.
- Key does not switch: enable `diagnostics` and inspect the error type/status.
