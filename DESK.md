# webfaCe Desk — developer and agent handbook

webfaCe Desk (webfacedesk.app) is a per-customer, always-on business assistant built on this fork of DeepSeek Harness (`dsh`). This file is the map of everything that is Desk-specific; the upstream harness is documented in [AGENTS.md](AGENTS.md) and [docs/](docs/). Read this before touching anything under `apps/desk*`, `packages/webface`, `packages/client/ui-team`, `infra/desk-box`, or `apps/cli/config/desk-*`.

Product rules that override taste: one assistant with **modes** (never team/staff/agents/bots); the tagline is Tommy's and verbatim; company name is **webfaCeMEdia** (no Inc); customer copy never says "generated"; no invented brand assets or durations; copy voice in [apps/site/COPY.md](apps/site/COPY.md).

## Shape

```
webfacedesk.app (apex box, DO tor1 143.198.42.231 — also the demo Desk)
├─ Caddy (/etc/caddy/Caddyfile from infra/desk-box/Caddyfile; conf.d/webfacedesk.caddy for the apex site)
├─ static site  /srv/desk/site  ← apps/site/*.html (copied, not built)
├─ deskapi :8095  apps/deskapi   store: Stripe checkout → provision a box (DO API + Cloudflare DNS) → welcome; churn; snapshots; ops console /ops; Google sign-in relay
└─ a Desk box (one per customer; the demo is demo.webfacedesk.app on the same droplet)
   ├─ deskd :8090   apps/deskd    sign-in (owner/phone roles), Business page (→ AGENTS.md), Brand, Connections + wizards, Files + viewer, Routines page, Memory page, Activity page, Browser page (noVNC), push, billing, usage, heartbeat
   ├─ desk-harness :3080  dsh with profile `desk` (bundles: base, web-app, desk-models, desk-app) — the chat, modes, tools
   ├─ MCP servers spawned by the harness: apps/google-mcp (Gmail/Calendar/Drive/Contacts via the customer's own Google app), apps/wordpress-mcp, apps/desk-kit (deliverables), apps/desk-memory (what the business has decided and promised), Playwright MCP over the shared Chrome (CDP :9222), webfaCeMEdia via deskd's loopback OAuth proxy /mcp/webface
   └─ desk-xvfb / desk-vnc / desk-novnc / desk-chrome — the Desk's own browser, streamed to /browser
Desktop app: apps/desktop (Wails v2, vendored at apps/desktop/third_party/wails with a WKDownload delegate) — a window onto a Desk; releases via .github/workflows/desktop.yml + apps/desktop/scripts/release-mac.sh (sign + notarise + DMG).
```

Modes are dsh agent presets generated from [apps/cli/config/agent-presets/desk-team.yml](apps/cli/config/agent-presets/desk-team.yml) by `node scripts/gen-desk-presets.mjs` (never edit the generated `*/agent.cordis.yml`). Each mode gets `ask_<mode>` delegation tools; a mode with `shell: false` denies shell and file-write tools to everything it delegates to (pinned by `packages/webface/desk-app/tests/presets.spec.ts`). Skills live in [apps/cli/config/desk-skills](apps/cli/config/desk-skills) and are copied per preset by the generator. The `operator` (Studio) mode only shows when the box has `DESK_PLAN=operators`.

The business identity the model sees is `/srv/desk/work/AGENTS.md`, rendered by deskd from the Business page (`apps/deskd/src/profile.js`); personas in `desk-team.yml` defer to it. Brand (`profile.json → brand`, logo in `/srv/desk/brand/`) dresses every file the kit makes.

**Memory** — what the business has decided, promised, quoted and asked for is recorded by the `remember` tool (`apps/desk-memory`) into `/srv/desk/memory.jsonl`, append-only because every conversation spawns its own copy of that server. Recall needs no new machinery: after each write the server rewrites **`$DSH_HOME/AGENTS.md`** with a *budgeted* view (pinned notes, then newest, capped by `DESK_MEMORY_BUDGET`, default 4000 characters), and `packages/context/agent-instructions` already loads that file first in every session — so the next conversation opens knowing it. The rest of the ledger stays on disk behind `recall`. Two different files, two different owners: `work/AGENTS.md` is who the business is (the Business page), `home/AGENTS.md` is what Desk remembers (the Memory page, `apps/deskd/src/memory.js`, which shares `apps/desk-memory/src/ledger.js` so there is one definition of what is remembered). Deleting a note appends a tombstone and rewrites the block, so it is gone from the very next conversation. Card numbers, security codes, passwords and SINs are refused before they are written.

**Activity** — `packages/webface/desk-activity` follows the approval audit pair the harness already writes (`approval/asked` + `approval/decided` from `packages/interaction/user-approval`) into `/srv/desk/activity.json`, which deskd renders at `/activity` in owner language. Read-only: the page can never change a decision.

## Control plane (`apps/desk-control`)

The operator side is moving from `apps/deskapi` (plain Node on the apex box) to **Convex project `desk-control`** (team webfacemedia): durable `provisionBox`/`destroyBox` workflows (a redeploy resumes them; droplet adoption by `order:<id>` tag), the same HTTP surface boxes already call (nothing on boxes changes at cut-over), timed **demo Desks** (seeded from `demoTemplates`, warned at T-24h, torn down at expiry with the final snapshot kept, convert-to-paid keeps the same box), config/brand **pushes to boxes** over the box-token channel (`POST /deskd/config`, `PUT /deskd/config/logo`, `POST /deskd/seed`, `POST /deskd/record` in `apps/deskd/src/control.js`), and screen recordings (ffmpeg on `DISPLAY :1`, box-signed expiring download links).

The console is `apps/desk-control/web` (Vite + React + Clerk on Vercel, project `desk-control`) at **desk.webfacemedia.com** — sign in with a Google account listed in the deployment's `OPERATOR_EMAILS`. Deploy recipe and the cut-over checklist: [infra/desk-box/STOREFRONT.md](infra/desk-box/STOREFRONT.md). Until cut-over, deskapi still serves webfacedesk.app; the Convex deployment runs in parallel (prod `dynamic-stork-829`).

Traps: Convex **workflow handlers are deterministic** — no `process.env`, no `Date` in the handler body; read env in the `begin` mutation and stamp times inside mutations (`readyNow`/`destroyedNow` on `orders.patch`). The box bootstrap script lives in the `config` table (no disk on Convex) — `scripts/push-bootstrap.mjs [--prod]` after every deploy that touches `infra/desk-box/bootstrap.sh`. The Vercel build is `vercel build` + `deploy --prebuilt` from `apps/desk-control/web` (the remote build cannot see `../convex`).

## Box layout (`/srv/desk`)

`desk.env` (all env; 0600 — includes `DESK_MEMORY_FILE`, `DESK_MEMORY_BLOCK`, `DESK_ACTIVITY_FILE`, without which the server and the pages would disagree about where memory lives) · `auth.json` (owner accounts, scrypt) · `session.secret` · `profile.json` · `brand/logo.*` · `work/` (the Desk folder: AGENTS.md, price-list.md, uploads, `deliverables/<date>/`) · `home/` (DSH_HOME: sessions, storages, profiles/desk/cordis.patch.yml = the managed connections block) · `google/` (Google client JSON + tokens) · `push.json`, `routines.json`, `routines-actions.json`, `memory.jsonl` (what Desk remembers; the budgeted view of it is `home/AGENTS.md`), `activity.json`, `billing.json`, `webface-oauth.json` · `harness/` (this repo, branch `desk`) · `READY`.

Env keys and what reads them: `infra/desk-box/bootstrap.sh` writes `desk.env`; `apps/deskapi/src/provision.js` and `scripts/desk-box.mjs` decide the values. Store-side keys are listed in [infra/desk-box/STOREFRONT.md](infra/desk-box/STOREFRONT.md).

## Deploying to a box (the demo)

Always through the script — never `build:web` by hand:

```
ssh root@143.198.42.231 'bash /srv/desk/harness/scripts/desk-deploy.sh --client --web'
```
Flags: `--install` (dependencies changed), `--host` (packages/webface), `--client` (packages/client), `--web` (the shell), `--site` (apps/site → /srv/desk/site), `--caddy` (Caddyfile + conf.d, validated before reload), `--api` (the storefront store, apex box only), `--all`, `--no-pull`.

`--api` on its own restarts `deskapi` and nothing else, so shipping a store change never interrupts a Desk. On boot the store picks up any order whose provisioning was cut short — it adopts the droplet that run already made (by saved id, then by the `order:<id>` tag) rather than building a second billed box, and gives up after three attempts. Failures are recorded on the order as `lastError` and shown in `/ops`, not just logged.

**Why the script and not the commands.** The shell's chunks are content-hashed and `build:web` empties `apps/web/dist/assets`; a page that is already open then asks for chunks that no longer exist, and the SPA fallback answers those with `index.html` — HTTP 200 of HTML, which the browser tries to run as JavaScript. That is the white screen. The script keeps the previous build's files beside the new ones (pruned after 14 days untouched), so open pages keep working until they take the update. `apps/deskd` and `apps/deskapi` are plain Node — a restart is enough; MCP servers (`desk-kit`, `google-mcp`, `wordpress-mcp`) are spawned per session, so restart `desk-harness`.

Every user-visible change adds a line to `WHATS-NEW.md` (owner language, no jargon): it is what the update notice and `/whats-new` show.

## Releasing the desktop app

Tag `desktop-vX.Y.Z` (bump `apps/desktop/wails.json` productVersion first) → CI builds Windows + Linux zips and creates the Release → on the Mac run `NOTARY_KEY=~/Documents/AuthKey_….p8 NOTARY_KEY_ID=… NOTARY_ISSUER=… apps/desktop/scripts/release-mac.sh desktop-vX.Y.Z` (builds universal, signs with the Developer ID cert in the login keychain, notarises, staples, DMG, uploads with `--clobber`). `/dl/{mac,windows,linux}` on the apex redirect to the latest assets. Check a Mac build really used the vendored Wails: `go list -m -json github.com/wailsapp/wails/v2` → Dir under `third_party`, and `strings` of the binary contains `decideDestinationUsingResponse`.

## Adding things

- **A mode**: add a teammate in `desk-team.yml` (id, name, description, order, shell, skills, persona) → `node scripts/gen-desk-presets.mjs` → the presets spec runs in `pnpm exec vitest run packages/webface`.
- **A skill**: `apps/cli/config/desk-skills/<name>/SKILL.md` (frontmatter `name`, `description` = when to use) → list it under the modes that need it → regenerate.
- **A connector**: an MCP server under `apps/<name>-mcp` (see `apps/wordpress-mcp`), a row written by deskd's Connections page into the managed block of `profiles/desk/cordis.patch.yml` (`apps/deskd/src/connections.js`), a wizard in `apps/deskd/src/wizards.js` (one step per screen), and copy on the site's Connections section.
- **A deliverable type**: a tool in `apps/desk-kit/src/index.js` that writes into `work/deliverables/<date>/` and returns the `FILE READY` line with an absolute `/files/view?p=` link (the chat renders absolute links only; chips and the push notice read that line).
- **A deskd page**: use `layout()` from `apps/deskd/src/ui.js` (top bar with ← Desk), gate owner-only routes in the phone fence in `index.js`, and add the path to Caddy's `@public`/route list if it must be reachable before sign-in.

## Traps (each cost real time)

- Only `- insert:` rows add plugins in a profile patch; bare top-level ids are ignored.
- `git push` can fail silently under the hooks: always compare `origin/desk` with `HEAD`. The lint/whitespace hooks exempt `apps/desk-kit/vendor` and `apps/desktop/third_party`.
- Markdown in the chat drops relative links; the KaTeX single-dollar parser is off (`$6,900` is money).
- WKWebView (the desktop app) shows what it can render and drops the rest; downloads exist only because of the vendored delegate. `X-Frame-Options: SAMEORIGIN` is on every Desk — nothing may iframe a Desk.
- `~/Downloads` on Tommy's Mac is unreadable from an agent session; ask for files to be moved to `~/Documents`.
- The demo Desk is Tommy's live webfaCeMEdia Desk: never test destructive flows on it, never send mail from it.
