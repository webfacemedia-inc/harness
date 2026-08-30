#!/usr/bin/env bash
# Deploy a webfaCe Desk box without white-screening whoever has it open.
#
# The web shell's chunks are content-hashed and `build:web` empties dist/assets, so a page
# that is already open would 404 on its own chunks — and the SPA fallback answers those with
# HTML, which a browser then tries to run as JavaScript. This script keeps the previous
# build's files alongside the new ones so open pages keep working until they reload.
#
#   ssh root@<box> 'bash /srv/desk/harness/scripts/desk-deploy.sh --web --client'
#
# Flags: --install (pnpm install), --host, --client, --web, --site (copy apps/site → /srv/desk/site),
#        --caddy (install Caddyfile + conf.d), --api (restart deskapi; apex box only), --all
#        (host+client+web), --no-pull.
set -euo pipefail
D=${DESK_ROOT:-/srv/desk}
H=$D/harness
KEEP_DAYS=${DESK_ASSET_KEEP_DAYS:-14}
DO_PULL=1; INSTALL=0; HOST=0; CLIENT=0; WEB=0; SITE=0; CADDY=0; API=0
for a in "$@"; do case $a in
  --install) INSTALL=1;; --host) HOST=1;; --client) CLIENT=1;; --web) WEB=1;;
  --site) SITE=1;; --caddy) CADDY=1;; --api) API=1;; --all) HOST=1; CLIENT=1; WEB=1;; --no-pull) DO_PULL=0;;
  *) echo "unknown flag: $a" >&2; exit 2;;
esac; done
run() { sudo -u desk -H "$@"; }

cd "$H"
if [ "$DO_PULL" = 1 ]; then
  echo "==> pull"
  run git checkout -q -- .
  run git pull -q origin desk
fi
run git rev-parse --short HEAD
[ "$INSTALL" = 1 ] && { echo "==> install"; run pnpm install --frozen-lockfile >/tmp/desk-install.log 2>&1 || { tail -20 /tmp/desk-install.log; exit 1; }; }

ASSETS=$H/apps/web/dist/assets
KEEP=$(mktemp -d); trap 'rm -rf "$KEEP"' EXIT
if [ "$WEB" = 1 ] && [ -d "$ASSETS" ]; then
  echo "==> keeping the running build's chunks"
  cp -a "$ASSETS/." "$KEEP/"
fi
[ "$HOST" = 1 ] && { echo "==> build host plugins"; run pnpm run build:lib:host >/tmp/desk-b0.log 2>&1 || { tail -20 /tmp/desk-b0.log; exit 1; }; }
[ "$CLIENT" = 1 ] && { echo "==> build client plugins"; run pnpm run build:lib:client >/tmp/desk-b1.log 2>&1 || { tail -20 /tmp/desk-b1.log; exit 1; }; }
if [ "$WEB" = 1 ]; then
  echo "==> build web shell"
  run pnpm run build:web >/tmp/desk-b2.log 2>&1 || { tail -20 /tmp/desk-b2.log; exit 1; }
  # New files win; anything the new build no longer emits is put back for the pages still on it.
  cp -a -n "$KEEP/." "$ASSETS/" 2>/dev/null || true
  chown -R desk:desk "$ASSETS"
  # Chunks nobody has touched in a fortnight belong to builds nobody still has open.
  find "$ASSETS" -type f -atime +"$KEEP_DAYS" -delete 2>/dev/null || true
  echo "    chunks now: $(find "$ASSETS" -type f | wc -l | tr -d ' ')"
fi
if [ "$SITE" = 1 ]; then
  echo "==> site pages"
  for f in "$H"/apps/site/*.html "$H"/apps/site/*.mp4 "$H"/apps/site/*.vtt "$H"/apps/site/*.jpg "$H"/apps/site/*.png "$H"/apps/site/*.svg; do
    [ -e "$f" ] && install -o caddy -g caddy -m 644 "$f" "$D/site/$(basename "$f")"
  done
fi
if [ "$CADDY" = 1 ]; then
  echo "==> caddy"
  mkdir -p /etc/caddy/conf.d
  BACKUP=/etc/caddy/Caddyfile.prev
  [ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "$BACKUP"
  cp "$H/infra/desk-box/Caddyfile" /etc/caddy/Caddyfile
  [ -f "$H/infra/desk-box/webfacedesk.caddy" ] && cp "$H/infra/desk-box/webfacedesk.caddy" /etc/caddy/conf.d/ || true
  # The site address comes from $DESK_HOST, so validation needs the box's environment —
  # without it the site block reads as a global options block and every directive looks unknown.
  if ( set -a; . "$D/desk.env" >/dev/null 2>&1; set +a; caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1 ); then
    systemctl reload caddy
  else
    echo "caddy config is invalid — restoring the previous one and stopping" >&2
    [ -f "$BACKUP" ] && cp "$BACKUP" /etc/caddy/Caddyfile
    exit 1
  fi
fi
echo "==> restart"
# Restart only what this deploy touched: a store-only deploy must not interrupt anyone's Desk.
if [ "$API" = 1 ] && [ "$HOST$CLIENT$WEB$SITE$CADDY" = "00000" ]; then
  systemctl restart deskapi
  sleep 4
  systemctl is-active deskapi
  curl -fsS -m 5 http://127.0.0.1:8095/api/health || echo '(deskapi health unavailable)'
  echo
  echo "==> done. Store only; no Desk was interrupted."
  exit 0
fi
systemctl restart deskd
if [ "$HOST" = 1 ] || [ "$CLIENT" = 1 ] || [ "$WEB" = 1 ]; then systemctl restart desk-harness; fi
if [ "$API" = 1 ]; then systemctl restart deskapi; fi
sleep 8
systemctl is-active deskd desk-harness | tr '\n' ' '; echo
curl -fsS -m 5 http://127.0.0.1:8090/deskd/build 2>/dev/null || echo '(build stamp unavailable)'
echo
echo "==> done. Open pages keep their chunks and will offer the update."
