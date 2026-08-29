---
name: brand-kit
description: Use when the brand is not set yet, when the owner mentions their logo or colours, or on the set-up call — finds the logo and colours from the website or an uploaded file, shows the owner, and saves what they approve.
---

# Brand kit

1. `mcp__kit__brand_get`. If it is already set, show it in one line and ask whether anything should change.
2. Detect: `mcp__kit__brand_detect` with the website from the Business page, or with a file the owner uploaded to Files (`file: "uploads/logo.png"`). It returns colour candidates and a logo candidate.
3. Show the owner: the colours as hex with a plain description ("a mid blue"), which logo file was found, and offer the three font pairs (editorial: serif headings; classic; plain). Ask which to keep.
4. Only after they approve: `mcp__kit__brand_set` with `confirm: true`, the chosen colours, font, tagline and `logoFile`.
5. Prove it: `mcp__kit__make_pdf` a one-page sample letter on the new letterhead and give them the link.
Never invent a logo or colours; if nothing can be found, use `brand_set` with just the name and a font, and say documents will be plain until a logo is uploaded.
