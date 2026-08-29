---
name: deliverables
description: Use when the owner wants a file — a PDF, Word document, spreadsheet, slide deck, plain text file, or a branded graphic — or when a quote, letter, report or invoice should be sent as a document rather than a chat reply.
---

# Deliverables

Every file is made with the kit tools and comes out on the business's own letterhead and colours (Business → Brand). Never write documents with the file tools.

- Letter, quote, invoice, report, one-pager → `mcp__kit__make_pdf` (Markdown or ready HTML). Word wanted too → `mcp__kit__make_document` with format `both`.
- Presentation → `mcp__kit__make_deck`: `#` first line = title slide, each `##` = a slide, `-` bullets, `|` tables. Keep 5–10 slides, one idea per slide.
- Spreadsheet → `mcp__kit__make_sheet`: columns + rows; put numbers as numbers; ask for totals on money columns.
- Plain file → `mcp__kit__make_text` (name with extension).
- Social post / header / Open Graph card in the brand → `mcp__kit__brand_image`. A picture from a description → `mcp__kit__make_image` (say so plainly if it is not switched on).
- Each tool returns a link: repeat it in the reply so the owner can open or download the file from their phone; the file is also under Files → deliverables.
- If `mcp__kit__brand_get` shows no brand, offer to set it up with the `brand-kit` skill before producing customer-facing documents.
