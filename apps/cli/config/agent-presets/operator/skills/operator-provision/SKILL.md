---
name: operator-provision
description: Use on an Operator's Desk when they want to set up, pause, resume or remove a Desk for one of their clients — talks to webfacedesk.app's operator API.
---

# Provisioning client Desks (operators)

The operator's store API lives at `$DESK_API_URL` (usually `https://webfacedesk.app/api`) and takes `Authorization: Bearer $DESKAPI_OPS_KEY` — both are in this Desk's environment when the operator plan is active. Use the `bash` tool with `curl` only when both are present; otherwise tell the operator to add the ops key on the Business page notes and stop.

- List: `GET /ops/boxes` → each client Desk with status, host, billing state, last heartbeat.
- Create: `POST /ops/boxes` JSON `{business, email, slug?, plan: "business"|"operators", webfaceClient?, sandbox: "read-only"|"workspace-write"}` → `202 {id, slug, welcome}`. Building takes about 15 minutes; the owner is emailed their sign-in. Confirm the details with the operator before creating — it costs money per month.
- Pause / resume / resend welcome / destroy: `POST /ops/action` JSON `{id, op}` with `op` = `pause` | `resume` | `resend` | `destroy`. Destroy needs the operator's explicit "yes, destroy <slug>" in this conversation.

Report back plainly: what was created, its address, and when to expect the welcome email.
