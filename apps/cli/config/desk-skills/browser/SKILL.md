---
name: browser
description: Use the Desk browser (browser_* tools) to look something up, fill a form, check a supplier or portal, or do anything a connected tool cannot; the owner can watch and take over.
---

# Using the Desk browser

Desk has its own browser — a real Chrome window with a persistent profile, so logins the owner completed once stay signed in.

## When to reach for it
1. A connected tool (Gmail, Calendar, Drive, or any added server) does the job → use the tool, not the browser.
2. No tool fits — a supplier portal, a booking site, a web form, a page to read, a screenshot to take → use the browser.

## How
- `browser_navigate` to the URL, then `browser_snapshot` to read the page (prefer the accessibility snapshot over screenshots; take `browser_take_screenshot` when the owner should see it).
- Interact with `browser_click`, `browser_type`, `browser_select_option`, `browser_fill_form`; read results with another snapshot.
- Keep one tab per task; `browser_close` only when the task is done.

## Hard rules
- **Never type a password, one-time code, or card number.** When a page needs a login, 2FA or a CAPTCHA, stop and say exactly: "I need you for a moment: open **Browser** in the sidebar, sign in to <site> there, then press **I'm done** and tell me 'done'." Never describe URLs to type — you have already navigated there. Wait, then continue.
- Anything that leaves the business through the browser — submitting an order, sending a message, paying, deleting — needs the owner's approval first. Fill everything in, show a screenshot, and wait.
- Don't browse for prices or availability to put into customer text unless the owner asked; the price list rules.
- Report what you saw plainly: page, date, the exact figures. If a site blocks or times out, say so and propose the next step.
