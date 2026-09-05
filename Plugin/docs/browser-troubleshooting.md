# Browser troubleshooting

Use the following commands from `Plugin/`:

```bash
pnpm build
pnpm verify
pnpm diagnose:browser-control -- --no-fail
pnpm diagnose:browser-control -- --require-connected
```

The expected local chain is:

```text
typed browser action
  -> Desktop Bridge
  -> GardenFlow Native Host
  -> Chromium native messaging
  -> GardenFlow extension
  -> page content script
```

## Connection checks

1. Start the current GardenFlow desktop app.
2. Load `Plugin/dist/extension/` in Chrome, Edge, or Brave.
3. In GardenFlow, open the browser extension settings and prepare the Host.
4. Restart the browser after installing or repairing the Host manifest.
5. Reload the unpacked extension after every rebuild.

Common states:

- `extension_not_found`: the extension is not loaded in a detected profile.
- `no_native_host_manifest`: the current `com.gardenflow.browser_control` manifest is missing.
- `host_missing` or `host_not_executable`: the manifest target moved or lacks execute permission.
- `bridge_descriptor_missing`: GardenFlow is not running or its Desktop Bridge is not ready.
- `bridge_handshake_failed`: registration, role token, protocol, or app version validation failed.
- `BROWSER_INSTANCE_SELECTION_REQUIRED`: more than one browser profile is connected; select an instance explicitly.
- `extension_forwarding_failed`: the Host responded but the extension did not complete the action.

## Safety

- Tests should use an isolated browser profile and must not access the user's real keychain.
- The extension must not request Cookie access or log captured page payloads.
- Clipboard, history, and broad browser reads require explicit typed user intent.
- Research runs must finalize controlled tabs and debugger attachments even after failure.
- Review manually exported diagnostics before sharing them.

For the current architecture and privacy boundary, see the [extension README](../README.md) and [browser runtime](./browser-runtime.md).
