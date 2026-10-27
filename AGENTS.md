# dshdesk — project facts

A DSH plugin, not a standalone app. Two halves plus one native helper:

- `index.js` — host Cordis plugin: browser routes, snapshot store, loopback
  mirror server, WPF launcher.
- `client.js` — generated browser bundle (`window.__ModuleLoader__` form).
  **Never hand-edit**; edit `src/client.template.js` / `lib/board.cjs`, then
  `node scripts/build-client.mjs`.
- `native/dshdesk-window.ps1` — Windows PowerShell 5.1 + WPF companion window.

No build step at install. `client.js` is committed and is the final artifact.

## Commands

| Command | Meaning |
| --- | --- |
| `bash scripts/check.sh` | **The single success criterion**: rebuild check, syntax, unit tests, manifest/wiring assertions. |
| `bash scripts/smoke.sh` | Gate then live hot-swap + route checks. |
| `node scripts/build-client.mjs` | Regenerate `client.js` from `src/`. |
| `node --test test/*.test.mjs` | Unit tests only. |
| `node scripts/gui-probe.mjs --url <url> --click '[data-dshdesk-trigger]'` | Headless render check. |

Install into a profile:

```bash
dsh plugin --profile web add link:/mnt/f/DSH/dshdesk
```

## Architecture facts that cost time

- **Session status is a client fact.** `props.useSessionStatus` returns
  `running`, `pendingInteraction` and `completionUnread`; the host cannot derive
  `completionUnread`, so the board must be computed in the browser.
- **The current selection is not in `useSessions`.** `uiWorkspace.selection` is a
  snapshot store persisted as `dsh.sessions.current`, shape `{sessionId}`. The
  client reads the service store and falls back to `localStorage`.
- **The native window must be a separate WPF process.** The official DSH Desktop
  preload exposes `dshDesktop` (browser/deviceInfo/keyboard/shortcuts/updates)
  but no window control. `BrowserWindow` is not reachable from the host's
  `ELECTRON_RUN_AS_NODE` process. Patching `app.asar` is invasive and needs a
  restart; WPF + PowerShell 5.1 is native, always-on-top, and needs no Electron
  modification. Verified on this machine: WPF 900×620, `Topmost=True`,
  `Opacity=.9`, and Windows→WSL `127.0.0.1` HTTP both work.
- **WPF requires `-STA`.** The host spawns
  `powershell.exe -STA -NoProfile -NonInteractive -ExecutionPolicy Bypass`.
- **WSL path conversion.** `native/dshdesk-window.ps1` must be passed to
  `powershell.exe` as a Windows path. Use `wslpath -w` on Linux.
- **Never expose the mirror on the LAN.** Bind `127.0.0.1`; the WPF process
  reaches it through WSL localhost forwarding (verified). The token is a
  32-byte random hex string.
- **Browser timers can be throttled in a hidden tab.** The pin is shown only in
  an Electron desktop shell, where the main window keeps timers running. If a
  host throttles it, the 6 s stale rule closes the companion instead of showing
  frozen data.
- **The client's theme snapshot must contain resolved colours, not `var(...)`.**
  Resolve each token through a hidden element's computed `color`.
- **Theme colours sent to WPF are `#AARRGGBB` (alpha first), not CSS
  `#RRGGBBAA`.** WPF's `BrushConverter` accepts `#AARRGGBB`; CSS order turns a
  translucent white border into opaque yellow. The browser's `rgbaToToken`
  already emits alpha-first.
- **`StateDot` state names are `warning` / `ongoing` / `done` / `idle`.** Amber =
  warning, green = done. Do not invent a new dot.

## Layout constraints

- Bubble: 860px wide (clamped to viewport), four equal columns, header drag,
  Escape/outside close, `z-index` 2147483000, portalled to `body`.
- Native: 900×620, min 760×210, opacity 0.9, 800 ms poll, 6 s stale.
- No card mutations. Do not add manual completion, drag-to-column or status
  writes.

## Publishing

- Repo must be ≥ 24h old, carry the `dsh-plugin` topic, and declare
  `dsh.bundle.patch` before a marketplace PR.
- The catalog is `awesome-dsh-plugin/awesome-dsh-plugin`; one YAML entry under
  `data/plugins/`.
- `scripts/market-submit.sh` automates the PR and sends a Bark result. It is
  installed as a daily retry after the repo's first day.
