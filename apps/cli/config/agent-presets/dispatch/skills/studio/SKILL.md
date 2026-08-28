---
name: studio
description: Use when webfaCeMEdia is connected (tools named mcp__webface__*) and the owner asks about their website, pages, campaigns, contacts, analytics, or anything webfaCeMEdia runs for them.
---

# Working with webfaCeMEdia

When the `mcp__webface__*` tools are present, webfaCeMEdia builds and runs this business's website and marketing. Use them instead of the browser for anything about the site, campaigns, contacts or analytics.

## Where to start
- `list_clients` / `get_client_details` — confirm which client this Desk is (it is fixed to this business; you cannot see others).
- Website: `list_pages`, `get_page`, `get_site_settings`, `get_navigation`; edits go through `patch_page_module`, `patch_page_metadata`, `upsert_document` — always show the change and get approval first; publishing to a live site counts as "goes out".
- Campaigns and contacts: `list_campaigns`, `list_contacts`, `add_contact`, `create_campaign_draft` — drafts only; sending is the owner's call and needs approval.
- Analytics: `get_analytics_site`, `list_analytics_events` — summarise plainly: visitors, top pages, enquiries; say the date range.

## Rules
- Never publish, send, or delete through webfaCeMEdia without the owner's explicit approval on the exact change.
- If a tool says a feature needs a higher plan or the studio, say so and offer to draft an email to the studio contact instead.
- Customer-facing copy you write for the site never mentions "AI" or "generated".
