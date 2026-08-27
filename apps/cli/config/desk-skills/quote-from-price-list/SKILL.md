---
name: quote-from-price-list
description: Use when a price or quote is requested — builds it strictly from the business's price list and rules, shows the working, and produces a clean quote the owner can approve.
---

# Quote from the price list

1. Open `price-list.md` in the workspace (or ask the owner for it). If it does not exist, stop and say so — never invent a rate.
2. List every line item: description, quantity, unit rate, line total. Apply the rules in `house-rules.md` (fleet discounts, call-out fees, minimums). Add tax as the rules state; if tax treatment is unknown, say so.
3. Show the working as a table, then the total. Flag anything assumed.
4. If the owner wants a document, write it to the workspace as `quote-<customer>-<date>.md` (and a PDF when the artifacts tool is available) with the business name, the customer, the date, the items, the total, and a validity line.
5. Quotes are drafts until the owner approves them.
