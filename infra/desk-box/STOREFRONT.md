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
`DESK_PUBLIC_URL`, `DIGITALOCEAN_TOKEN`, `OPENROUTER_API_KEY` (Desk's own spend key), `BREVO_API_KEY`, `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_*`, `CLOUDFLARE_API_TOKEN`, `DESK_SIGNIN_CLIENT_ID/SECRET`, `AGENT_API_SECRET` (platform, for webfaCeMEdia connections), `DESKAPI_OPS_KEY` (operator console + `/api/ops/*`), `DESKAPI_ADMIN_TOKEN` (welcome-email resend), `DESKAPI_STATIC_BOXES=slug:dropletId,…` (hand-made boxes joining the nightly snapshot loop), `DESKAPI_STATIC_BOX_TOKENS=slug:token,…` (their heartbeat/portal tokens — `scripts/desk-box.mjs` prints the token in the per-box note), `DESKAPI_STATIC_CLIENTS=slug:client,…` (which webfaCeMEdia client a static box belongs to), `DESKAPI_MONTHLY_TOKEN_CAP` (usage alert threshold, default 20M), `DESKAPI_ALERT_EMAIL` (where the alert goes).

## Analytics and downloads
Every storefront and Desk page loads Insights with siteId `webface`. Download links are `webfacedesk.app/dl/{mac,windows,linux}` (Caddy redirects to the latest GitHub release asset, so the repository name never shows).

## Deploying to the apex/demo box
As root on the box: `cd /srv/desk/harness && sudo -u desk git checkout -q -- . && sudo -u desk git pull -q origin desk`, then `sudo -u desk pnpm run build:lib:host` (host plugins), `build:lib:client` (client plugins), `build:web` (the shell) as needed; `systemctl restart deskd deskapi desk-harness`. Site pages: `install -o caddy -g caddy -m 644 apps/site/X /srv/desk/site/X`. Caddy: `cp infra/desk-box/Caddyfile /etc/caddy/Caddyfile; cp infra/desk-box/webfacedesk.caddy /etc/caddy/conf.d/; systemctl reload caddy`. Live Caddy and env files are hand-maintained on the box; the repo is the source of truth for the Caddy files.
