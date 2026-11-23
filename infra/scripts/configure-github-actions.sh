#!/usr/bin/env bash
# Sets the GitHub "production" environment for the deploy workflow from Terraform outputs.
# Same variable/secret names as kmhome.
#
#   GH_REPO=kyrylokulyhin/dots-game ./infra/scripts/configure-github-actions.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${ROOT_DIR}/infra/terraform"
KEY_PATH="${ROOT_DIR}/infra/keys/deploy_vm_ed25519"
ENVIRONMENT="${GITHUB_ENVIRONMENT:-production}"
REPO="${GH_REPO:-kyrylokulyhin/dots-game}"

for cmd in gh terraform; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 1; }
done

if [[ ! -f "${KEY_PATH}" ]]; then
    echo "Missing SSH private key at ${KEY_PATH}. Run ./infra/scripts/bootstrap-gcp.sh first." >&2
    exit 1
fi

VM_HOST="$(terraform -chdir="${TF_DIR}" output -raw vm_public_ip)"
VM_PATH="$(terraform -chdir="${TF_DIR}" output -raw app_path)"
VM_USER="$(terraform -chdir="${TF_DIR}" output -raw deploy_user)"
APP_URL="$(terraform -chdir="${TF_DIR}" output -raw app_url)"

gh api --method PUT "repos/${REPO}/environments/${ENVIRONMENT}" >/dev/null

gh variable set VM_HOST --env "${ENVIRONMENT}" --repo "${REPO}" --body "${VM_HOST}"
# MSYS_NO_PATHCONV: stop Git Bash on Windows from rewriting /var/www/... into a Windows path
MSYS_NO_PATHCONV=1 gh variable set VM_PATH --env "${ENVIRONMENT}" --repo "${REPO}" --body "${VM_PATH}"
gh variable set VM_USER --env "${ENVIRONMENT}" --repo "${REPO}" --body "${VM_USER}"
gh variable set APP_URL --env "${ENVIRONMENT}" --repo "${REPO}" --body "${APP_URL}"
gh secret set VM_SSH_PRIVATE_KEY --env "${ENVIRONMENT}" --repo "${REPO}" < "${KEY_PATH}"

echo "GitHub Actions environment '${ENVIRONMENT}' configured for ${REPO}."
