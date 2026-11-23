#!/usr/bin/env bash
# One-time (and repeatable) infrastructure setup, run from your machine. Mirrors kmhome's bootstrap.
#
#   export CLOUDFLARE_API_TOKEN=...          # Zone:DNS:Edit + Zone:SSL and Certificates:Edit
#   PROJECT_ID=my-project \
#   APP_DOMAIN=dots.example.com \
#   CF_ZONE_ID=0123... \
#   ./infra/scripts/bootstrap-gcp.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${ROOT_DIR}/infra/terraform"
KEY_DIR="${ROOT_DIR}/infra/keys"
KEY_PATH="${KEY_DIR}/deploy_vm_ed25519"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

require_command gcloud
require_command terraform
require_command ssh-keygen

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${APP_DOMAIN:?Set APP_DOMAIN, e.g. dots.example.com}"
: "${CF_ZONE_ID:?Set CF_ZONE_ID (Cloudflare zone ID of the parent domain)}"
: "${CLOUDFLARE_API_TOKEN:?Export CLOUDFLARE_API_TOKEN}"

REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
NAME_PREFIX="${NAME_PREFIX:-dots}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-micro}"
TF_STATE_BUCKET="${TF_STATE_BUCKET:-${PROJECT_ID}-${NAME_PREFIX}-tfstate}"

mkdir -p "${KEY_DIR}"
if [[ ! -f "${KEY_PATH}" ]]; then
    ssh-keygen -t ed25519 -N "" -C "dots-deploy" -f "${KEY_PATH}"
fi

# Terraform uses Application Default Credentials, or GOOGLE_OAUTH_ACCESS_TOKEN if set
# (e.g. GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token --account you@example.com)").
if [[ -z "${GOOGLE_OAUTH_ACCESS_TOKEN:-}" ]] && ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "No Google credentials for Terraform. Run: gcloud auth application-default login" >&2
    exit 1
fi

gcloud services enable compute.googleapis.com iam.googleapis.com secretmanager.googleapis.com storage.googleapis.com --project "${PROJECT_ID}"

if ! gcloud storage buckets describe "gs://${TF_STATE_BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud storage buckets create "gs://${TF_STATE_BUCKET}" \
        --project "${PROJECT_ID}" \
        --location "${REGION}" \
        --uniform-bucket-level-access \
        --public-access-prevention
fi
gcloud storage buckets update "gs://${TF_STATE_BUCKET}" --versioning

cat > "${TF_DIR}/backend.hcl" <<EOF
bucket = "${TF_STATE_BUCKET}"
prefix = "${NAME_PREFIX}"
EOF

PUBKEY="$(tr -d '\r\n' < "${KEY_PATH}.pub")"
cat > "${TF_DIR}/terraform.auto.tfvars.json" <<EOF
{
  "project_id": "${PROJECT_ID}",
  "region": "${REGION}",
  "zone": "${ZONE}",
  "name_prefix": "${NAME_PREFIX}",
  "machine_type": "${MACHINE_TYPE}",
  "app_domain": "${APP_DOMAIN}",
  "cloudflare_zone_id": "${CF_ZONE_ID}",
  "deploy_public_key": "${PUBKEY}"
}
EOF

terraform -chdir="${TF_DIR}" init -backend-config=backend.hcl
terraform -chdir="${TF_DIR}" validate
if [[ "${SKIP_APPLY:-0}" == "1" ]]; then
    echo "SKIP_APPLY=1: stopping before apply. Run: terraform -chdir=infra/terraform apply"
    exit 0
fi
terraform -chdir="${TF_DIR}" apply

echo
echo "Infrastructure ready."
echo "VM IP:   $(terraform -chdir="${TF_DIR}" output -raw vm_public_ip)"
echo "App URL: $(terraform -chdir="${TF_DIR}" output -raw app_url)"
echo
echo "Next: GH_REPO=kyrylokulyhin/dots-game ./infra/scripts/configure-github-actions.sh"
echo "Then push to main (or re-run the workflow) to deploy the app."
