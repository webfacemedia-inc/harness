# @webface/dsh-desk-activity

Host plugin for a webfaCe Desk box: mirrors the approval audit pair (`dsh-user-approval`'s `approval/asked` and `approval/decided`) to a JSON file deskd renders on the Activity page, so the owner can read what Desk asked to do and what they answered. Bounded to the last `keep` entries, seeded from the last snapshot on start, and written at most once per tick because an ask and its decision arrive milliseconds apart.

Read-only: it never appends a session event and never influences a decision. A `approval/decided` whose ask was not seen — the pair straddled a restart — is recorded on its own rather than dropped.

## Model Experience

None, as the plugin only mirrors approval events to a file; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Approvals only. Work that needed no approval — a document written, a page read — is not listed, so the page reads as "what Desk asked", not a full journal.
- Tool names are turned into owner language in deskd (`apps/deskd/src/activity.js`), not here; an unrecognised tool is shown by its own name.
