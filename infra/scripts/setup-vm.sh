#!/usr/bin/env bash
# One-time VM setup for the dots-game server.
# Run as root on the GCP VM after it is provisioned.
#
# Usage:
#   sudo bash infra/scripts/setup-vm.sh <subdomain> [app_path] [deploy_user] [server_port]
#
# Example:
#   sudo bash infra/scripts/setup-vm.sh dots.example.com /var/www/dots-game deploy 3001

set -euo pipefail

SUBDOMAIN="${1:?Usage: $0 <subdomain> [app_path] [deploy_user] [server_port]}"
APP_PATH="${2:-/var/www/dots-game}"
DEPLOY_USER="${3:-deploy}"
SERVER_PORT="${4:-3001}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Creating directory structure at ${APP_PATH}"
mkdir -p "${APP_PATH}/releases"
mkdir -p "${APP_PATH}/shared/data"
chown -R "${DEPLOY_USER}:www-data" "${APP_PATH}"
chmod -R 775 "${APP_PATH}/shared"

echo "==> Installing nginx config for ${SUBDOMAIN}"
sed \
  -e "s|DOTS_SUBDOMAIN|${SUBDOMAIN}|g" \
  -e "s|DOTS_APP_PATH|${APP_PATH}|g" \
  -e "s|DOTS_SERVER_PORT|${SERVER_PORT}|g" \
  "${INFRA_DIR}/nginx/dots-game.conf" \
  > /etc/nginx/sites-available/dots-game
ln -sfn /etc/nginx/sites-available/dots-game /etc/nginx/sites-enabled/dots-game
nginx -t
systemctl reload nginx
echo "    nginx config installed and reloaded."

echo "==> Installing systemd service"
sed \
  -e "s|DOTS_APP_PATH|${APP_PATH}|g" \
  -e "s|DOTS_DEPLOY_USER|${DEPLOY_USER}|g" \
  -e "s|DOTS_SERVER_PORT|${SERVER_PORT}|g" \
  "${INFRA_DIR}/systemd/dots-game-server.service" \
  > /etc/systemd/system/dots-game-server.service
touch /var/log/dots-game-server.log
chown "${DEPLOY_USER}:www-data" /var/log/dots-game-server.log
chmod 664 /var/log/dots-game-server.log
systemctl daemon-reload
systemctl enable dots-game-server
echo "    systemd service installed and enabled."

echo "==> Adding sudo rules for ${DEPLOY_USER}"
cat > /etc/sudoers.d/dots-game-deploy <<EOF
${DEPLOY_USER} ALL=NOPASSWD: \
  /usr/bin/systemctl start   dots-game-server, \
  /usr/bin/systemctl stop    dots-game-server, \
  /usr/bin/systemctl restart dots-game-server, \
  /usr/bin/systemctl reload  nginx, \
  /usr/bin/systemctl start   nginx
EOF
chmod 440 /etc/sudoers.d/dots-game-deploy
visudo -cf /etc/sudoers.d/dots-game-deploy
echo "    sudo rules written to /etc/sudoers.d/dots-game-deploy"

echo ""
echo "Setup complete."
echo ""
echo "Remaining steps:"
echo "  1. Add a Cloudflare DNS A record:  ${SUBDOMAIN}  →  <VM public IP>"
echo "  2. Run infra/scripts/configure-github-actions.sh to set repo secrets."
echo "  3. Push to main (or trigger workflow_dispatch) to deploy."
echo ""
echo "The service will start automatically after the first successful deploy."
