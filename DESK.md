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
   ├─ deskd :8090   apps/deskd    sign-in (owner/phone roles), Business page (→ AGENTS.md), Brand, Connections + wizards, Files + viewer, Routines page, Browser page (noVNC), push, billing, usage, heartbeat
   ├─ desk-harness :3080  dsh with profile `desk` (bundles: base, web-app, desk-models, desk-app) — the chat, modes, tools
   ├─ MCP servers spawned by the harness: apps/google-mcp (Gmail/Calendar/Drive/Contacts via the customer's own Google app), apps/wordpress-mcp, apps/desk-kit (deliverables), Playwright MCP over the shared Chrome (CDP :9222), webfaCeMEdia via deskd's loopback OAuth proxy /mcp/webface
   └─ desk-xvfb / desk-vnc / desk-novnc / desk-chrome — the Desk's own browser, streamed to /browser
Desktop app: apps/desktop (Wails v2, vendored at apps/desktop/third_party/wails with a WKDownload delegate) — a window onto a Desk; releases via .github/workflows/desktop.yml + apps/desktop/scripts/release-mac.sh (sign + notarise + DMG).
```

Modes are dsh agent presets generated from [apps/cli/config/agent-presets/desk-team.yml](apps/cli/config/agent-presets/desk-team.yml) by `node scripts/gen-desk-presets.mjs` (never edit the generated `*/agent.cordis.yml`). Each mode gets `ask_<mode>` delegation tools; a mode with `shell: false` denies shell and file-write tools to everything it delegates to (pinned by `packages/webface/desk-app/tests/presets.spec.ts`). Skills live in [apps/cli/config/desk-skills](apps/cli/config/desk-skills) and are copied per preset by the generator. The `operator` (Studio) mode only shows when the box has `DESK_PLAN=operators`.

The business identity the model sees is `/srv/desk/work/AGENTS.md`, rendered by deskd from the Business page (`apps/deskd/src/profile.js`); personas in `desk-team.yml` defer to it. Brand (`profile.json → brand`, logo in `/srv/desk/brand/`) dresses every file the kit makes.

## Box layout (`/srv/desk`)

`desk.env` (all env; 0600) · `auth.json` (owner accounts, scrypt) · `session.secret` · `profile.json` · `brand/logo.*` · `work/` (the Desk folder: AGENTS.md, price-list.md, uploads, `deliverables/<date>/`) · `home/` (DSH_HOME: sessions, storages, profiles/desk/cordis.patch.yml = the managed connections block) · `google/` (Google client JSON + tokens) · `push.json`, `routines.json`, `routines-actions.json`, `billing.json`, `webface-oauth.json` · `harness/` (this repo, branch `desk`) · `READY`.

Env keys and what reads them: `infra/desk-box/bootstrap.sh` writes `desk.env`; `apps/deskapi/src/provision.js` and `scripts/desk-box.mjs` decide the values. Store-side keys are listed in [infra/desk-box/STOREFRONT.md](infra/desk-box/STOREFRONT.md).

## Deploying to a box (the demo)

```
ssh root@143.198.42.231
cd /srv/desk/harness && sudo -u desk git checkout -q -- . && sudo -u desk git pull -q origin desk
sudo -u desk pnpm install --frozen-lockfile            # only when dependencies changed
sudo -u desk pnpm run build:lib:host                    # packages/webface/* (host plugins) changed
sudo -u desk pnpm run build:lib:client                  # packages/client/* changed
sudo -u desk pnpm run build:web                         # the web shell
systemctl restart deskd deskapi desk-harness
install -o caddy -g caddy -m 644 apps/site/X /srv/desk/site/X   # site pages (served from /srv/desk/site, NOT the checkout)
cp infra/desk-box/Caddyfile /etc/caddy/Caddyfile; cp infra/desk-box/webfacedesk.caddy /etc/caddy/conf.d/; systemctl reload caddy
```
`apps/deskd` and `apps/deskapi` are plain Node — restart is enough. `apps/desk-kit`, `apps/google-mcp`, `apps/wordpress-mcp` are spawned per session — restart `desk-harness`. Presets (`apps/cli/config`) and `packages/webface/desk-app/cordis.patch.yml` are read at harness start.

Verify like a customer, not with grep: Playwright against `https://demo.webfacedesk.app` (owner password in `~/PROJECTS/2026/webface-desk/CREDENTIALS.local.md`), WebKit engine for anything the desktop app shows, iPhone profile for phone layouts. Every page deskd serves is `no-store`.

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
