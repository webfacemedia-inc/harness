# webfacedesk.app storefront — turning it on

The apex box (demo, 143.198.42.231) serves the site, `deskapi` (:8095) and the demo Desk.

1. Stripe (live account webfaCeMEdia): create a **restricted key** with write on Checkout Sessions, Products, Prices, Webhook Endpoints and read on Subscriptions, then on the box:
   `cd /srv/desk/harness/apps/deskapi && sudo -u desk STRIPE_SECRET_KEY=rk_live_… node src/setup.js >> /srv/deskapi/deskapi.env`
   (idempotent; creates C$1,500/249 and C$2,500/499 CAD prices + the webhook and appends the env lines — remove the empty placeholders first).
2. Cloudflare: a token with **Zone → DNS → Edit** on webfacedesk.app → `CLOUDFLARE_API_TOKEN=` in deskapi.env. Without it new Desks get `<ip>.sslip.io` addresses.
3. Google sign-in (optional): ONE **Web application** OAuth client (scopes openid+email) with the single redirect `https://webfacedesk.app/auth/google/callback` → `DESK_SIGNIN_CLIENT_ID/SECRET` in deskapi.env. Every Desk signs in through the apex relay (`/auth/google/start` → Google → `/auth/google/callback` → a ticket signed with that box's token → the box's `/auth/google/finish`).
4. `systemctl restart deskapi` — `curl https://webfacedesk.app/api/health` shows `stripe:true, dns:true`.

Flow: `/checkout?plan=business` → Stripe Checkout (setup + monthly) → webhook → droplet in tor1 (bootstrap.sh) → `/welcome?order=…` shows the address + owner password once ready (also emailed via Brevo). Orders live in `/srv/deskapi/orders.json`.

## Every deskapi.env key
`DESK_PUBLIC_URL`, `DIGITALOCEAN_TOKEN`, `OPENROUTER_API_KEY` (Desk's own spend key), `BREVO_API_KEY`, `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_*`, `CLOUDFLARE_API_TOKEN`, `DESK_SIGNIN_CLIENT_ID/SECRET`, `AGENT_API_SECRET` (platform, for webfaCeMEdia connections), `DESKAPI_OPS_KEY` (operator console + `/api/ops/*`), `DESKAPI_ADMIN_TOKEN` (welcome-email resend), `DESKAPI_STATIC_BOXES=slug:dropletId,…` (hand-made boxes joining the nightly snapshot loop), `DESKAPI_STATIC_BOX_TOKENS=slug:token,…` (their heartbeat/portal tokens — `scripts/desk-box.mjs` prints the token in the per-box note), `DESKAPI_STATIC_CLIENTS=slug:client,…` (which webfaCeMEdia client a static box belongs to), `DESKAPI_MONTHLY_TOKEN_CAP` (usage alert threshold, default 20M), `DESKAPI_ALERT_EMAIL` (where the alert goes), `FAL_KEY` (optional; passed to each box for the kit's `make_image` picture generation).

## Analytics and downloads
Every storefront and Desk page loads Insights with siteId `webface`. Download links are `webfacedesk.app/dl/{mac,windows,linux}` (Caddy redirects to the latest GitHub release asset, so the repository name never shows).

## Deploying to the apex/demo box
As root on the box: `cd /srv/desk/harness && sudo -u desk git checkout -q -- . && sudo -u desk git pull -q origin desk`, then `sudo -u desk pnpm run build:lib:host` (host plugins), `build:lib:client` (client plugins), `build:web` (the shell) as needed; `systemctl restart deskd deskapi desk-harness`. Site pages: `install -o caddy -g caddy -m 644 apps/site/X /srv/desk/site/X`. Caddy: `cp infra/desk-box/Caddyfile /etc/caddy/Caddyfile; cp infra/desk-box/webfacedesk.caddy /etc/caddy/conf.d/; systemctl reload caddy`. Live Caddy and env files are hand-maintained on the box; the repo is the source of truth for the Caddy files.

## Control plane on Convex (`apps/desk-control`)

Runs in parallel with deskapi until cut-over. Deployments: dev `impressive-shepherd-58`, prod `dynamic-stork-829` (project `desk-control`, team webfacemedia). Console: https://desk.webfacemedia.com (Vercel project `desk-control`; Clerk instance clerk.webfacemedia.com; authorisation = `OPERATOR_EMAILS` on the deployment).

Deploy:
1. `cd apps/desk-control && npx convex deploy --yes`
2. `node scripts/push-bootstrap.mjs --prod` (whenever `infra/desk-box/bootstrap.sh` changed)
3. First deploy only: `npx convex run --prod schedule:init` (registers the 07:30 UTC nightly and the hourly demo sweep)
4. Console: `cd web && vercel pull --yes --environment=production && vercel build --prod && vercel deploy --prebuilt --prod` (local build on purpose — the remote build cannot see `../convex`)

Env on the prod deployment (set 2026-09-01 from the apex box's deskapi.env, values never printed): DIGITALOCEAN_TOKEN, OPENROUTER_API_KEY, FAL_KEY, BREVO_API_KEY, DESK_FROM_EMAIL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_{BUSINESS,OPERATORS}_{SETUP,MONTHLY}, CLOUDFLARE_API_TOKEN, DESK_SIGNIN_CLIENT_ID/SECRET, DESKAPI_OPS_KEY, DESKAPI_ADMIN_TOKEN, DESK_PUBLIC_URL, OPERATOR_EMAILS. Defaults in code cover CLOUDFLARE_ZONE_ID, DESKAPI_MONTHLY_TOKEN_CAP, DESKAPI_ALERT_EMAIL, DESK_DOMAIN, DESK_HARNESS_REF. The static demo box is registered in `staticBoxes` (droplet 595724007).

Cut-over (quiet evening; boxes untouched):
1. `curl https://dynamic-stork-829.convex.site/api/health` → all true.
2. Apex Caddy (`/etc/caddy/conf.d/webfacedesk.caddy`): proxy `/api/* /checkout /welcome /auth/*` to `dynamic-stork-829.convex.site` instead of `127.0.0.1:8095`; `handle /ops* { redir https://desk.webfacemedia.com }`. `caddy validate` with env, then reload.
3. `systemctl stop deskapi` (leave installed — rollback is `systemctl start deskapi` + Caddy revert).
4. Demo box heartbeat appears in the console within 60 s; `curl https://webfacedesk.app/api/health` still answers.
5. Import history: run `scripts/import-orders.mjs` ON THE BOX (orders.json holds passwords/tokens — it never leaves the box); keep orders.json read-only 30 d.
6. Live E2E on a checkout-test order per the control-plane spec, then destroy it.
