#!/usr/bin/env bash
# webfaCe Desk box — cloud-init bootstrap for a fresh Ubuntu 24.04 droplet.
# `scripts/desk-box.mjs` prepends the DESK_* variables and hands this file to
# DigitalOcean as user-data. Idempotent enough to re-run by hand:
#   sudo bash /srv/desk/bootstrap.sh
# Progress: /var/log/desk-bootstrap.log; done marker: /srv/desk/READY
set -euo pipefail
exec > >(tee -a /var/log/desk-bootstrap.log) 2>&1
echo "==> desk bootstrap $(date -u +%FT%TZ)"

: "${DESK_SLUG:=desk}"
: "${DESK_BUSINESS:=Your business}"
: "${DESK_HARNESS_REPO:=https://github.com/webfacemedia-inc/harness.git}"
: "${DESK_HARNESS_REF:=desk}"
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required}"
: "${DESK_OWNER_PASSWORD:?DESK_OWNER_PASSWORD is required}"
PUBLIC_IP=$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || curl -fsS -4 https://ifconfig.me)
: "${DESK_HOST:=${PUBLIC_IP}.sslip.io}"
export DEBIAN_FRONTEND=noninteractive
D=/srv/desk

echo "==> swap (builds need it on 4 GB)"
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> apt"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw jq unzip \
  xvfb x11vnc novnc websockify fonts-liberation fonts-noto-color-emoji \
  libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64 libxss1 xdg-utils

echo "==> caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "==> google chrome (the Desk browser)"
if ! command -v google-chrome >/dev/null; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/chrome.deb && rm /tmp/chrome.deb
fi

echo "==> node 22 + pnpm"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs
fi
corepack enable && corepack prepare pnpm@11.7.0 --activate

echo "==> hardening: fail2ban (ssh + Desk sign-in), unattended security upgrades"
apt-get install -y -qq fail2ban unattended-upgrades >/dev/null
cat > /etc/fail2ban/filter.d/desk-login.conf <<'F2B'
[Definition]
failregex = ^.*deskd.*login failed from <HOST>.*$
F2B
cat > /etc/fail2ban/jail.d/desk.conf <<'F2B'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
[desk-login]
enabled = true
filter = desk-login
backend = systemd
journalmatch = _SYSTEMD_UNIT=deskd.service
maxretry = 8
findtime = 10m
bantime = 30m
action = iptables-allports[name=desk-login]
F2B
systemctl enable --now fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "==> firewall"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

echo "==> desk user + dirs"
id desk >/dev/null 2>&1 || useradd -m -d $D -s /bin/bash desk
mkdir -p $D/home/profiles/desk $D/work $D/google $D/browser $D/home/browser-output
chown -R desk:desk $D

echo "==> harness ($DESK_HARNESS_REF)"
if [[ ! -d $D/harness/.git ]]; then
  sudo -u desk git clone --depth 1 --branch "$DESK_HARNESS_REF" "$DESK_HARNESS_REPO" $D/harness
else
  sudo -u desk git -C $D/harness fetch --depth 1 origin "$DESK_HARNESS_REF" && sudo -u desk git -C $D/harness checkout -q FETCH_HEAD
fi
cd $D/harness
sudo -u desk -H pnpm install --frozen-lockfile
sudo -u desk -H NODE_OPTIONS=--max-old-space-size=3072 pnpm run build

echo "==> desk profile"
cat > $D/home/profiles/desk/package.json <<JSON
{ "name": "dsh-profile-desk", "private": true,
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@webface/dsh-desk-models", "@webface/dsh-desk-app"] } } }
JSON
cat > $D/home/profiles/desk/cordis.patch.yml <<YML
# ${DESK_BUSINESS} — this Desk's own layer over @webface/dsh-desk-app.
- id: sandbox-policy
  config:
    mode: ${DESK_SANDBOX:-read-only}
- id: agent-presets
  config:
    default: ${DESK_DEFAULT_PRESET:-team}
YML
cat > $D/home/settings.yaml <<YML
# webfaCe Desk — ${DESK_BUSINESS}. Model routes come from @webface/dsh-desk-models.
ui-onboarding:
  welcomeNoticeVersion: 2026-08-27.desk
ui-theme:
  preference: dark
agent-presets:
  default: ${DESK_DEFAULT_PRESET:-team}
YML
printf 'OPENROUTER_API_KEY: %s\n' "$OPENROUTER_API_KEY" > $D/home/.credentials.yaml
chmod 600 $D/home/.credentials.yaml
if [[ ! -f $D/work/AGENTS.md ]]; then
cat > $D/work/AGENTS.md <<MD
# ${DESK_BUSINESS} — how this Desk works

## The business
(Not set yet. The owner fills this in from Desk → Business; until then, ask the owner to do that before answering anything about services, prices or hours.)

## House rules
- Nothing goes to a customer without the owner's approval. Draft, show, wait.
- Never invent prices or availability. If no price list is connected yet, say so and ask the owner (\`price-list.md\` in this folder is the price list once it exists).
- Speak as ${DESK_BUSINESS}: friendly, plain, no jargon. Customer-facing text never mentions "AI" or "generated".
- Connections (Gmail, Calendar) are set up by the owner from Desk's Connections page — never tell them to run commands.
MD
fi
chown -R desk:desk $D/home $D/work

echo "==> profile module farm (dsh builds it on first run) + @webface links"
cat > $D/desk.env <<ENV
DSH_HOME=$D/home
DSH_AGENTS_HOME=$D/home/agents
DESK_HARNESS_DIR=$D/harness
DESK_GOOGLE_HOME=$D/google
GOOGLE_MCP_HOME=$D/google
DESK_BROWSER_HOME=$D/browser
DESK_BROWSER_CDP=http://127.0.0.1:9222
DESK_NOTIFY_URL=http://127.0.0.1:8090/deskd/notify
DESK_PUSH_FILE=$D/push.json
DESK_ROUTINES_FILE=$D/routines.json
DESK_ROUTINES_ACTIONS=$D/routines-actions.json
DESK_HOST=$DESK_HOST
DESK_SLUG=$DESK_SLUG
DESK_API_URL=${DESK_API_URL:-}
DESK_BOX_TOKEN=${DESK_BOX_TOKEN:-}
DESK_BUSINESS=$DESK_BUSINESS
DESK_AUTH_FILE=$D/auth.json
DESK_WORK_DIR=$D/work
DESK_PROFILE_FILE=$D/profile.json
DESK_BILLING_FILE=$D/billing.json
DESK_PROFILE_PATCH=$D/home/profiles/desk/cordis.patch.yml
DESK_SIGNIN_CLIENT_ID=${DESK_SIGNIN_CLIENT_ID:-}
DESK_SIGNIN_CLIENT_SECRET=${DESK_SIGNIN_CLIENT_SECRET:-}
DISPLAY=:1
HOME=$D
PATH=/usr/local/bin:/usr/bin:/bin
ENV
chmod 600 $D/desk.env; chown desk:desk $D/desk.env
sudo -u desk -H env $(grep -v '^#' $D/desk.env | xargs) node --import tsx/esm apps/cli/src/bin.ts --profile desk --dump-config >/dev/null 2>&1 || true
mkdir -p $D/home/profiles/node_modules/@webface
ln -sfn $D/harness/packages/webface/desk-models $D/home/profiles/node_modules/@webface/dsh-desk-models
ln -sfn $D/harness/packages/webface/desk-app $D/home/profiles/node_modules/@webface/dsh-desk-app
ln -sfn $D/harness/packages/client/ui-team $D/home/profiles/node_modules/@webface/dsh-client-ui-team
ln -sfn $D/harness/packages/webface/desk-notify $D/home/profiles/node_modules/@webface/dsh-desk-notify
ln -sfn $D/harness/packages/webface/desk-routines $D/home/profiles/node_modules/@webface/dsh-desk-routines
chown -R desk:desk $D/home/profiles

echo "==> workspace (the Desk folder shows up in the sidebar on first sign-in)"
mkdir -p $D/home/storages
if ! grep -q '"$D/work"' $D/home/storages/workspace.json 2>/dev/null; then
WS_ID=$(cat /proc/sys/kernel/random/uuid); NOW=$(date -u +%FT%T.000Z)
cat > $D/home/storages/workspace.json <<JSON
{ "unit": { "name": "workspace", "version": 2 },
  "global": { "initialized": true, "workspaceIds": ["$WS_ID"], "archivedSessionIds": [] },
  "tables": { "workspaces": { "$WS_ID": { "path": "$D/work", "title": "Desk", "sessionIds": [], "createdAt": "$NOW", "updatedAt": "$NOW" } } } }
JSON
fi
chown -R desk:desk $D/home/storages

echo "==> desk may restart its own harness (Connections page)"
echo "desk ALL=(root) NOPASSWD: /usr/bin/systemctl restart desk-harness, /usr/bin/systemctl stop desk-harness, /usr/bin/systemctl start desk-harness" > /etc/sudoers.d/desk; chmod 440 /etc/sudoers.d/desk

echo "==> systemd"
cat > /etc/systemd/system/desk-xvfb.service <<UNIT
[Unit]
Description=Desk display (Xvfb :1)
[Service]
User=desk
ExecStart=/usr/bin/Xvfb :1 -screen 0 1440x900x24 -nolisten tcp
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/desk-vnc.service <<UNIT
[Unit]
Description=Desk browser view (x11vnc)
After=desk-xvfb.service
Requires=desk-xvfb.service
[Service]
User=desk
Environment=DISPLAY=:1
ExecStart=/usr/bin/x11vnc -display :1 -nopw -localhost -forever -shared -noxdamage -rfbport 5900
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/desk-novnc.service <<UNIT
[Unit]
Description=Desk browser view (noVNC)
After=desk-vnc.service
[Service]
User=desk
ExecStart=/usr/bin/websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/desk-chrome.service <<UNIT
[Unit]
Description=Desk browser (Chrome on :1, shared by the owner and Desk)
After=desk-xvfb.service
Requires=desk-xvfb.service
[Service]
User=desk
Environment=DISPLAY=:1
Environment=HOME=$D
ExecStart=/usr/bin/google-chrome --no-first-run --no-default-browser-check --disable-dev-shm-usage --remote-debugging-port=9222 --user-data-dir=$D/browser --window-size=1440,900 --window-position=0,0 --start-maximized --password-store=basic about:blank
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/desk-harness.service <<UNIT
[Unit]
Description=webfaCe Desk (harness)
After=network-online.target desk-xvfb.service
Wants=network-online.target
[Service]
User=desk
WorkingDirectory=$D/harness
EnvironmentFile=$D/desk.env
ExecStart=/usr/bin/node --import tsx/esm apps/cli/src/bin.ts --profile desk --host 127.0.0.1 --port 3080 --trusted-host $DESK_HOST
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/deskd.service <<UNIT
[Unit]
Description=webfaCe Desk box agent (deskd)
After=network-online.target
[Service]
User=desk
WorkingDirectory=$D/harness/apps/deskd
EnvironmentFile=$D/desk.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT

echo "==> owner account"
sudo -u desk -H env DESK_AUTH_FILE=$D/auth.json node $D/harness/apps/deskd/src/cli.js set "${DESK_OWNER_USER:-owner}" "${DESK_OWNER_EMAIL:-}" "$DESK_OWNER_PASSWORD" >/dev/null

echo "==> caddy front door"
cp $D/harness/infra/desk-box/Caddyfile /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/desk.conf <<UNIT
[Service]
Environment=DESK_HOST=$DESK_HOST
UNIT
systemctl daemon-reload
systemctl enable --now desk-xvfb desk-vnc desk-novnc desk-chrome desk-harness deskd
systemctl restart caddy
unset DESK_OWNER_PASSWORD OPENROUTER_API_KEY
for i in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:3080/ && break; sleep 2; done
touch $D/READY; chown desk:desk $D/READY
echo "==> READY https://$DESK_HOST  (owner / the password you were given)"
