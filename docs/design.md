# dshdesk design

## Product sentence

One question, one board: **现在有没有事需要我？**

`dshdesk` folds the DSH session list into a four-column attention queue. It is
read-only: no status is authored, no card is dragged, and no session is marked
done by hand. Every column is derived from state DSH already owns.

## Columns

| Column | Source fact | Dot |
| --- | --- | --- |
| 需要你 `needs` | `pendingInteraction` (approval / plan review / question) | amber (`warning`) |
| 进行中 `running` | `running === true`, unless a pending interaction wins | DSH ongoing spinner |
| 验收 `review` | `completionUnread === true` and not running | green (`done`) |
| 完成 `done` | neither running, pending, nor completion-unread | neutral (`idle`) |

Blank sessions, archived sessions, and subagent sessions are omitted. The
current session is first inside whichever column it belongs to and carries a
`当前` badge. A pending interaction always outranks running, matching DSH's own
sidebar status precedence.

## Surfaces

### Sidebar button

Registered in `sidebar.footer.action`. It shows the active-queue total (needs +
running + review, excluding done) plus the amber and green dots, using the DSH primitives' `StateDot` so the visual language
is the same as the sidebar. It works in the wide sidebar and the 56px rail.

### 860px bubble

Anchored to the right of the footer button, width 860 (clamped on small
viewports), height up to 620. Four equal columns; each has a coloured status
dot, name, count and cards. Empty columns say `暂无`. The bubble is portalled to
`body`, can be dragged by its header, closes on `Escape` or an outside press,
and has a pin button only when the host can create a native window.

Cards show title, project, relative time and a status pill. They are display
only.

### Native Windows companion window

The pin button exists only when **both** conditions hold:

1. the page is a DSH desktop shell (`dshDesktop`, `data-windows-titlebar`,
   `dsh-app:` or an explicit test hook); and
2. the host reports a native-window capability.

The web UI never pretends a browser tab can be always-on-top. On a Windows host
(or WSL with `powershell.exe`) the host opens a WPF window:

- 900 × 620, `WindowStyle=None`, true `Topmost`, minimum 760 × 210;
- opacity 0.9 by default, slider 30–100%;
- borderless rounded surface, draggable header, native resize grip;
- pulls the mirrored snapshot every 800 ms from a loopback-only, token-gated
  server owned by the plugin;
- after 6 s without a fresh main-window snapshot it shows the stale notice and
  closes; the web UI notices the close and re-opens the bubble;
- colours come from the host's resolved `--dsw-*` tokens, so light/dark follows
  DSH without a second palette.

The companion window is read-only. It has no controls that mutate a session.

## Data flow

```
DSH stores ──useSessions/useSessionStatus──┐
uiWorkspace ──workspaces/selection────────┤
                                          ▼
                                 deriveBoard() (pure)
                                          │
             ┌────────────────────────────┴────────────────────┐
             ▼                                                 ▼
       sidebar button + bubble                    POST /dshdesk/snapshot
                                                           │
                                              host memory (savedAt)
                                                           │
                                        loopback server /board?token=…
                                                           │
                                                     WPF window
```

The web client posts a snapshot when the board changes and a heartbeat every
second while the native window is open. The host marks a snapshot stale at 6 s.
The token is 32 random bytes and the mirror server binds `127.0.0.1` only. Colour
tokens cross this boundary as `#AARRGGBB` (WPF's alpha-first order), not CSS
`#RRGGBBAA`; a translucent border otherwise becomes an opaque wrong colour.

## Notifications

Only new entries in `needs` or `review` notify. A notification is emitted only
when the board is not focused: the bubble is closed (and no pinned window is
focused), or the pinned window reports `Deactivated`. The Web Notifications API
is used, so the OS notification centre owns delivery. Permission is requested
once from the footer-button click, never on page load.

## Theme

Web CSS uses only `--dsw-*` tokens. The native snapshot carries resolved colours
for the base, layers, labels, border, accent, amber, green and idle tokens; the
WPF window rebuilds its brushes from those values on every snapshot.

## Deliberate non-goals

- No manual completion, drag-to-column, assignment, comments or persistence of
  card state.
- No Windows/macOS/Linux window on a pure web host.
- No extra network origin: the mirror is loopback and token-gated.
- No install-time scripts.
