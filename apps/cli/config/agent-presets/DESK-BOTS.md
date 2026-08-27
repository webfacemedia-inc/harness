# @webface/desk-bots

The shipped webfaCe Desk teammates ("Bots") as agent presets. Each directory
here is one preset: `agent.cordis.yml` (the composition, derived
from dsh's `standard` preset with a Desk persona) and `preset.yml` (name,
description, order).

| Preset | Shell | Role |
|---|---|---|
| `desk-operator` | yes | Tommy's own Desk — the full studio toolset |
| `front-desk` | no | answers leads and enquiries, hands off to Quotes/Dispatch |
| `quotes` | no | prices only from the business's own price list |
| `dispatch` | no | bookings, confirmations, reminders, follow-ups |

They live in the shipped preset root (`apps/cli/config/agent-presets`), so every profile mounts them with `system` trust automatically; the
`agent-presets` row. Customer-specific personas are authored per Desk under
`$DSH_HOME/.agent-presets` (user trust) and override by id.
