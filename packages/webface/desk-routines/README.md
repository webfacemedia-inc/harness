# @webface/dsh-desk-routines

Host plugin for a webfaCe Desk box: mirrors every session's routines (`dsh-schedule` `schedule/change` events) to a JSON file deskd renders on the Routines page, seeded from the last snapshot on start, and applies delete requests deskd leaves in an actions file by appending the same `schedule/change` delete the schedule tool would.

## Model Experience

None, as the plugin only mirrors schedule events to a file and appends session events; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- A delete for a session that has not emitted a schedule event since the last restart cannot be applied until it does; the Routines page says so.
- Add / pause / run-now live in chat (`schedule_*` tools), not on the page.
