---
name: quote-from-price-list
description: Use when a price or quote is requested — builds it strictly from the business's price list and rules, shows the working, and produces a clean quote the owner can approve.
---

# Quote from the price list

1. Find the price list in the Desk folder: `price-list.md` first, otherwise any file whose name says price/rates/tariff (PDF, image or spreadsheet — read it with the file tools; images and PDFs can be read as attachments). If there is none, stop and say so — never invent a rate.
2. List every line item: description, quantity, unit rate, line total. Apply the rules in the "House rules" section of `AGENTS.md` (discounts, call-out fees, minimums). Add tax as the rules state; if tax treatment is unknown, say so.
3. Show the working as a table, then the total. Flag anything assumed.
4. If the owner wants a document: call `mcp__kit__make_pdf` (title "Quote — <customer>", the quote as Markdown with a table of items, the total, and a validity line) — it lands on the business letterhead; add `mcp__kit__make_document` when they want Word too. Reply with the link the tool returns. Never write the file yourself.
5. Quotes are drafts until the owner approves them.
