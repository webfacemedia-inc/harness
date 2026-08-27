# webfacedesk.app storefront — turning it on

The apex box (demo, 143.198.42.231) serves the site, `deskapi` (:8095) and the demo Desk.

1. Stripe (live account webfaCeMEdia): create a **restricted key** with write on Checkout Sessions, Products, Prices, Webhook Endpoints and read on Subscriptions, then on the box:
   `cd /srv/desk/harness/apps/deskapi && sudo -u desk STRIPE_SECRET_KEY=rk_live_… node src/setup.js >> /srv/deskapi/deskapi.env`
   (idempotent; creates C$1,500/249 and C$2,500/499 CAD prices + the webhook and appends the env lines — remove the empty placeholders first).
2. Cloudflare: a token with **Zone → DNS → Edit** on webfacedesk.app → `CLOUDFLARE_API_TOKEN=` in deskapi.env. Without it new Desks get `<ip>.sslip.io` addresses.
3. Google sign-in (optional): a **Web application** OAuth client with redirect `https://<slug>.webfacedesk.app/auth/google/callback` (add each slug, or use a verified app) → `DESK_SIGNIN_CLIENT_ID/SECRET`.
4. `systemctl restart deskapi` — `curl https://webfacedesk.app/api/health` shows `stripe:true, dns:true`.

Flow: `/checkout?plan=business` → Stripe Checkout (setup + monthly) → webhook → droplet in tor1 (bootstrap.sh) → `/welcome?order=…` shows the address + owner password once ready (also emailed via Brevo). Orders live in `/srv/deskapi/orders.json`.
