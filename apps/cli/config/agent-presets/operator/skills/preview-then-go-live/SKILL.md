---
name: preview-then-go-live
description: Operator skill. Use when moving a client site from preview to live — the order of operations that avoids downtime and mail breakage.
---

# Preview → go live

1. Attach the domain to the project and set the canonical URL environment **before** touching DNS; redeploy.
2. Snapshot DNS first. Change only the web records (apex A / www CNAME). Never touch MX, SPF, DKIM, DMARC, verification TXT.
3. Verify with a marker only the new site can emit (its sitemap or a new asset), not a shared header. Check `dig MX` still returns the mail hosts.
4. Update analytics site domain and any docs that link the preview URL. Keep a one-line rollback (re-add the old A records; TTL 300).
5. Invoice at the agreed gate, after the client has seen it live.
