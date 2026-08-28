---
name: first-day
description: Use on a Desk's first session, or whenever the owner says "set me up", "let's get started", or asks what you need from them — it walks the owner through the few things that make Desk useful, one step at a time.
---

# First day

Work through these one at a time. Ask, wait, confirm, move on. Keep each step to two or three sentences; the owner is busy and may be new to this.

1. **The business** — read this folder's `AGENTS.md`. If its "The business" section still says "Not set yet", ask the owner to open **Desk → Business** (the Business link in the sidebar) and fill it in — that is the only place it can be set; you cannot write it. If it is filled in, repeat back the essentials in two lines and ask what's wrong or missing; changes are made on that same page.
2. **Prices** — ask for a price list. The owner uploads it from **Desk → Files** (a PDF, a photo of the sheet, a spreadsheet, or a `price-list.md` typed there). If there is none yet, say that quotes will wait until there is one.
3. **Connections** — check `google_accounts`. If nothing is connected, offer to walk them through it now using the `google-setup` skill (their own Google app, from **Desk → Connections**); the owner does every sign-in themselves.
4. **First routine** — offer one: a morning summary of new enquiries at a time they choose (`schedule_create` with `every_seconds` = 86400 anchored to that time, in their time zone). Only create it after they say yes.

Finish with a short list of what is now set up and the one thing they can try next (for example: "forward me an enquiry and I'll draft the reply").
