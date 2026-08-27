---
name: reply-to-lead
description: Use when a customer enquiry or lead arrives (email, form, forwarded text) and a reply is needed — drafts the reply in the business's voice, gathers what is missing, and never sends without approval.
---

# Reply to a lead

1. Read the whole thread (`gmail_read` when it is email). Note who, where, what, when, and what is missing.
2. If pricing is involved, hand the pricing to Quotes (`ask_quotes`) with everything they need; if a visit is involved, ask Dispatch (`ask_dispatch`) for availability. Do not guess either.
3. Draft the reply: greet by name, answer what was asked, ask for what is missing in one clear question, close with the next step. Plain language, no jargon, no "AI".
4. Create it as a **draft** (`gmail_draft` with `replyToMessageId` so it threads). Show the owner the draft text and say exactly who it goes to.
5. Send only when the owner approves — `gmail_send_draft` with `confirm: true` — and then confirm it went.

Never promise availability, a price, or a policy that is not in the business profile, the price list, or the calendar.
