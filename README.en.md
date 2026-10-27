# dshdesk

> One attention queue. One question: **is anything waiting for me right now?**

![dshdesk four-column board](shots/board.png)

![dshdesk Windows always-on-top window](shots/native-window.png)

`dshdesk` is a read-only task board for DeepSeek Harness. It folds the session list into four columns — **Needs you / In progress / Review / Done** — derived entirely from DSH's own session state. Nothing is authored, dragged, or marked done by hand. A footer button opens an 860px live bubble; on the Windows desktop shell the same board can be pinned into a true always-on-top system window.

## Columns

| Column | Source | Dot |
| --- | --- | --- |
| Needs you | `pendingInteraction` (approval / plan review / question) | amber |
| In progress | `running`, with no pending interaction | DSH ongoing ring |
| Review | `completionUnread` (finished while you were elsewhere) | green |
| Done | none of the above | neutral |

Blank, subagent and archived sessions are hidden. The current session sits first in its own column and carries a `Current` badge. Pending interactions outrank running, matching DSH's sidebar precedence. Cards are display-only.

## Surfaces

### Sidebar bubble (everywhere)

The footer button carries the active-queue total (needs you + in progress + review, excluding done) plus the amber and green dots, in both the wide sidebar and the 56px rail. It opens an 860px bubble to the right of the button, with four equal columns and `Nothing here` for empty ones. Clicking a card opens that session and closes the bubble; cards in the pinned window work the same way. The bubble can be dragged and closes on `Escape` or an outside press. Only **newly entering** Needs-you or Review items notify, and only while the board is unfocused.

### Pinned window (desktop + Windows only)

A browser tab cannot be always-on-top, so the pin is shown only when both are true:

1. the page runs inside a DSH desktop shell (`dshDesktop`, `data-windows-titlebar`, `dsh-app:`, etc.); and
2. the host can launch a native Windows window (Windows, or WSL with `powershell.exe`).

The pin opens a PowerShell 5.1 + WPF window:

- 900 × 620, borderless, true `Topmost`, minimum 760 × 210;
- 90% opacity by default, adjustable 30–100% with a header slider, remembered;
- pulls the main-window snapshot every 800ms; after 6s without a fresh snapshot it shows a stale notice and closes;
- the web UI notices the close and returns to the bubble;
- colours follow the host's resolved `--dsw-*` tokens, light or dark;
- read-only — no control mutates a session.

The companion is fed by a loopback-only, random-token mirror server. It makes no third-party requests. Theme colours travel as `#AARRGGBB` (WPF order) so translucent borders cannot turn into an unexpected hue in the native window.

## Install

```bash
dsh plugin --profile web add github:Pingze-github/dshdesk
# local development
dsh plugin --profile web add link:/mnt/f/DSH/dshdesk
```

Refresh the page after installing. No build step and no `postinstall`: `client.js` is committed.

## Limits

- The pinned window is Windows + PowerShell 5.1 + WPF only. macOS, Linux and plain browsers do not show it.
- Its liveness depends on the main page; closing or sleeping the page for more than 6s closes the companion by design.
- Browser notifications require permission, requested from the board click. A system/browser block wins.
- The board stores no card state, because it owns none.
- The native log is `%TEMP%\dshdesk-window.log`.

## Development

```bash
bash scripts/check.sh        # the single success criterion
bash scripts/smoke.sh        # hot-swap + route smoke
node scripts/build-client.mjs
```

- `index.js` — host routes, snapshot store, mirror server, WPF launcher.
- `lib/board.cjs` — pure derivation and sanitisation shared by Node tests and the browser.
- `src/client.template.js` — browser source; generates `client.js`.
- `native/dshdesk-window.ps1` — the WPF companion.
- `scripts/build-client.mjs` — inlines `lib/board.cjs` into one bundle.

## License

MIT
