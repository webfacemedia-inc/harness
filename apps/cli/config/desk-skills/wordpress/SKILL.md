---
name: wordpress
description: Use when WordPress is connected (tools named mcp__wordpress__wp_*) for anything about the site's pages, posts, media or content changes.
---

# Working with WordPress

`mcp__wordpress__wp_*` tools talk to the business's own WordPress site through its REST API as the connected user.

- Start with `wp_site_info`, then `wp_list_pages` / `wp_list_posts` to see what exists. Read a page fully with `wp_get_post` before proposing changes.
- Writing: create everything as a **draft** (`wp_create_post` default). Show the owner the draft's edit link and what you wrote.
- Changing a live page/post or publishing needs the owner's approval on the exact change, then the call with `confirm: true`. Never pass `confirm: true` without that approval in this conversation.
- Images: upload with `wp_upload_media` (from a public URL or a file in the Desk folder), then reference the returned URL in content.
- Content must match the business profile (AGENTS.md) and house rules; never mention "AI" or "generated".
- If a call fails with 401/403, the Application Password was removed — tell the owner to reconnect from Connections; do not retry with guesses.
