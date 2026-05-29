#!/usr/bin/env bash
# Configure the GitHub Actions 'production' environment for kyrylokulyhin/dots-game.
#
# Reuses the same VM, deploy user, and SSH key as kmhome — only VM_PATH differs.
# Run this locally after the VM is provisioned.
#
# Prerequisites:
#   - gh CLI installed and authenticated  (gh auth login)
#   - SSH deploy key exists (use kmhome's infra/keys/deploy_vm_ed25519)
#
# Usage:
#   VM_IP=1.2.3.4 \
#   SSH_KEY_PATH=/path/to/kmhome/infra/keys/deploy_vm_ed25519 \
#   ./infra/scripts/configure-github-actions.sh
#
# Optional overrides (defaults shown):
#   VM_USER=deploy
#   VM_PATH=/var/www/dots-game
#   GH_REPO=kyrylokulyhin/dots-game
#   GITHUB_ENVIRONMENT=production

set -euo pipefail

REPO="${GH_REPO:-kyrylokulyhin/dots-game}"
ENVIRONMENT="${GITHUB_ENVIRONMENT:-production}"
VM_HOST="${VM_IP:?Set VM_IP to the VM public IP address}"
VM_PATH="${VM_PATH:-/var/www/dots-game}"
VM_USER="${VM_USER:-deploy}"
SSH_KEY_PATH="${SSH_KEY_PATH:?Set SSH_KEY_PATH to the deploy private key file}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install from https://cli.github.com/" >&2
  exit 1
fi

if [[ ! -f "${SSH_KEY_PATH}" ]]; then
  echo "SSH key not found at ${SSH_KEY_PATH}" >&2
  exit 1
fi

echo "Configuring GitHub Actions environment '${ENVIRONMENT}' for ${REPO}..."

gh api --method PUT "repos/${REPO}/environments/${ENVIRONMENT}" >/dev/null

gh variable set VM_HOST --env "${ENVIRONMENT}" --repo "${REPO}" --body "${VM_HOST}"
gh variable set VM_PATH --env "${ENVIRONMENT}" --repo "${REPO}" --body "${VM_PATH}"
gh variable set VM_USER --env "${ENVIRONMENT}" --repo "${REPO}" --body "${VM_USER}"
gh secret  set VM_SSH_PRIVATE_KEY --env "${ENVIRONMENT}" --repo "${REPO}" < "${SSH_KEY_PATH}"

echo ""
echo "Done. GitHub Actions environment '${ENVIRONMENT}' configured for ${REPO}."
echo ""
echo "Variables set:"
echo "  VM_HOST = ${VM_HOST}"
echo "  VM_PATH = ${VM_PATH}"
echo "  VM_USER = ${VM_USER}"
echo "  VM_SSH_PRIVATE_KEY = (secret, from ${SSH_KEY_PATH})"
