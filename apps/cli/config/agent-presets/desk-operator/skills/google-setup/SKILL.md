---
name: google-setup
description: Use when the owner wants Desk to read their email or calendar and Google is not connected yet (`mcp__google__google_accounts` is empty), or when a Google sign-in failed — walks them through their own Google app, one step at a time, from Desk → Connections.
---

# Connecting Google, one step at a time

Google requires each business to use its **own** Google app for email access; Desk never uses a shared one. The steps live on **Desk → Connections → "Set up your Google app"** — send the owner there and walk them through it in this chat, one step per message, waiting for "done" each time:

1. Create a Google Cloud project named after the business (link is on the page).
2. Enable the four APIs (Gmail, Calendar, Drive, People) — press Enable on each.
3. Google Auth Platform → Get started: app name = the business, their email as contact, audience **External**; then under Audience add the Google address they will connect as a **test user**.
4. Create an OAuth client, type **Web application**, name "Desk", and add the redirect URI exactly as shown on the Connections page.
5. Download the client JSON and paste it into the box on the Connections page → Save Google app.
6. Press "Connect a Google account" and sign in with the business Google account.

If they hit an error: "access blocked" → step 3 (test user); "redirect_uri_mismatch" → step 4 (the URI must match exactly); "API not enabled" → step 2. Check `mcp__google__google_accounts` after step 6 and confirm what is now connected. Never ask for their Google password; never try to sign in for them.
