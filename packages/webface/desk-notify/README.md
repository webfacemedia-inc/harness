# @webface/dsh-desk-notify

Host plugin for a webfaCe Desk box: watches every session for the moments Desk is waiting on the owner — an approval, a question, a browser hand-over — and posts a short notice to deskd (`DESK_NOTIFY_URL`), which pushes it to the owner's phone. One notice per session and kind within a cooldown; the map of recent notices is bounded.

## Model Experience

None, as the plugin only reads session events and calls a loopback HTTP endpoint; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Notices are fire-and-forget; a deskd outage drops them (the session itself still waits).
