---
name: google-business-profile
description: Use when the owner wants to change what Google shows about the business (address, hours, phone, photos, description) — the Google Business Profile has no API connection, so it is done in the Desk browser with the owner signed in.
---

# Google Business Profile, through the Desk browser

Google's Business Profile is not reachable through the Gmail/Calendar connection and has no connector. Use the Desk browser (`browser_*` tools) with the owner at the mouse for sign-in.

1. Take the facts from AGENTS.md (address, hours, phone, website). Confirm with the owner exactly what should change and the final values.
2. `browser_navigate` to `https://business.google.com/`. If Google asks to sign in, stop and say exactly: "I need you for a moment: open **Browser** in the sidebar, sign in to Google there, then press **I'm done** and tell me 'done'." You have already opened business.google.com — they only sign in. Never type a password, code or passkey yourself.
3. Once signed in: open the business, go to **Edit profile → Business information**, take a `browser_snapshot`, and read back the current address / hours so the owner sees before vs after.
4. Make the edits field by field (`browser_click`, `browser_type`, `browser_select_option`). Before pressing **Save**, `browser_take_screenshot` and ask for approval — saving changes what the public sees. Only save after "yes".
5. Google may hold address changes for review; say so. Then check the same facts elsewhere (website via the site connection, email signature in Gmail) and offer to update them too, each with approval.
