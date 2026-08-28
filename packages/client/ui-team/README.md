# @webface/dsh-client-ui-team

The webfaCe Desk **Modes** surface: dsh's agent presets rendered as a first-class sidebar list (Desk, Front desk, Quotes, Bookings, Website & marketing, Everything else, and Studio on Operators plans). Picking a mode stages it on the seat owned by `ui-agent-preset` and starts a conversation in it. On a cloud Desk (fronted by deskd) the same plugin adds the sidebar foot links (Business, Routines, Connections, Browser, Files, Billing, Download app, Sign out), hides the workspace controls, and hides the harness plumbing rows a business owner never needs.

## Use

Mounted by `@webface/dsh-desk-app`; needs the `sidebar.team` slot from `ui-sidebar` and the `agentPresetSeat` service from `ui-agent-preset` (resolved lazily, so the plugin applies before a conversation scope exists).

## Model Experience

None, as the panel only renders presets and sidebar links in the browser; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Workspace controls are hidden by their localised aria-labels (en and zh); a new locale needs its labels added in `cloud.ts`.
- The Studio mode is hidden by the box's `plan` from `/deskd/status`; a local (non-cloud) Desk shows it.
