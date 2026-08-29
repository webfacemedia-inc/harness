# webfaCe Desk — copy rules

Who we write for: an owner-operator of a small service business who runs it from a phone and an inbox and has never used an AI tool beyond maybe ChatGPT. They don't know what "easier" could look like; the page has to show them a day.

- Tagline, verbatim, never edited: **Your tireless AI business assistant, on your own computer. Minding your business, 24/7** (eyebrow "Minding your business, 24/7"). Its "AI" is the one allowed use.
- One assistant with **modes**. Never team, teammates, staff, agents, bots, employees.
- Every feature is written as what the owner gets back (time, sleep, fewer missed leads), never as a capability.
- Second person, plain words, short sentences. Read it as a plumber: if a word needs explaining, it goes.
- Jargon blocklist on the homepage, download page, welcome page and emails: machine, server, model, model account, token, tool server, MCP, browser (as a feature), Chrome, application password, always-on, hardware, sandbox, agent. They are allowed only on `/already-using-tools` and inside the product's Connections pages.
- Never "generated", never "AI-written". Never invented durations or effort ("about ten minutes").
- Company name is **webfaCeMEdia** (no Inc). Products are "webfaCe <Thing>".
- Prices come from the pricing section only; no numbers elsewhere.
- The guide is part of the product: "we set it up with you and stay" (set-up call, first-week check-in, monthly note) must remain true on every page that says it.

Check before shipping: `grep -niE "machine|model|token|server|chrome|application password|always-on|hardware|sandbox|\bagents?\b" apps/site/index.html apps/site/download.html` → nothing.
