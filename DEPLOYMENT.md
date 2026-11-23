# Dots — Deployment (Google Cloud + Cloudflare, Terraform, GitHub Actions)

This works the same way as kmhome:
- Terraform is applied from your machine, with its state stored in a GCS bucket.
- GitHub Actions tests every push and deploys `main` to the VM over SSH.
- GitHub never holds Google Cloud credentials.

```
Players ──HTTPS──▶ Cloudflare (dots.<your-domain>, proxied, Full strict)
                        │ HTTPS with a Cloudflare Origin CA certificate
                        ▼
           GCP e2-micro VM (Debian 12)            GitHub Actions
           nginx :443 ──▶ node :3000 (localhost)   ──ssh/scp──▶ deploy user
                              │                                 sudo dots-deploy
                 /var/lib/dots (separate disk: SQLite, daily snapshots)
```

**Terraform creates** (in `infra/terraform`):
- **Google Cloud:**
  - an e2-micro VM, the smallest size and free-tier eligible
  - a static IP
  - a 10 GB data disk with daily snapshots, protected by `prevent_destroy`
  - Secret Manager secrets for the origin certificate
  - the VM's service account
  - firewall rules: port 443 only from Cloudflare's IP ranges, and port 22 (key-only SSH) for deploys
- **Cloudflare:**
  - a proxied `A` record
  - an Origin CA certificate

The VM installs Node 24 and nginx on first boot and creates:
- the `deploy` user, holding the key whose private half GitHub stores
- `/usr/local/bin/dots-deploy`, the only command `deploy` may run as root
- the `dots` service, which runs as an unprivileged user

## One-time setup

You need these installed: `gcloud`, `terraform`, `gh` (GitHub CLI), and bash. On Windows, use Git Bash.

```bash
gcloud auth login
gcloud auth application-default login
gh auth login

export CLOUDFLARE_API_TOKEN=...   # Zone:DNS:Edit + Zone:SSL and Certificates:Edit on the zone

PROJECT_ID=your-project-id \
APP_DOMAIN=dots.your-domain.com \
CF_ZONE_ID=your-cloudflare-zone-id \
./infra/scripts/bootstrap-gcp.sh
```

The bootstrap script:
1. generates the deploy key in `infra/keys/`
2. enables the needed APIs
3. creates the Terraform state bucket `<project>-dots-tfstate`
4. writes `backend.hcl` and `terraform.auto.tfvars.json`
5. runs `terraform apply`

Then wire up GitHub:

```bash
GH_REPO=kyrylokulyhin/dots-game ./infra/scripts/configure-github-actions.sh
```

This creates the `production` environment with the variables `VM_HOST`, `VM_PATH`, `VM_USER` and `APP_URL`, and the secret `VM_SSH_PRIVATE_KEY`.

Finally, re-run the latest workflow on `main` from the Actions tab, or push a commit. That deploys the app.

## Every deploy (automatic)

`.github/workflows/ci.yml` runs on each push:
1. **test**: `npm ci && npm test`, which runs the game-rule tests and the server/API tests.
2. **terraform**: `fmt -check` and `validate`.
3. **deploy**, on `main` only:
   - packs `server.js db.js package*.json public/`
   - uploads the archive with `scp`
   - runs `sudo dots-deploy <archive> <sha>` on the VM. That command unpacks the release into `releases/<sha>`, runs `npm ci --omit=dev`, switches the `current` symlink, restarts the service, checks `/healthz`, and **rolls back automatically** if the check fails.
   - finally, a smoke test checks `https://dots.<domain>/healthz` through Cloudflare.

Infrastructure changes (anything under `infra/terraform`) are applied by hand:

```bash
terraform -chdir=infra/terraform plan
terraform -chdir=infra/terraform apply
```

## Operating it

| Task | How |
| --- | --- |
| SSH in | `terraform -chdir=infra/terraform output -raw ssh` (through IAP) |
| App logs | `sudo journalctl -u dots -f` |
| First-boot log | `sudo cat /var/log/dots-startup.log` |
| Releases | `/var/www/dots-game/releases/<sha>`, with `current` pointing at the live one; the last 5 are kept |
| Database | `/var/lib/dots/dots.db` on the data disk, snapshotted daily at 04:00 and kept 7 days |

## Cost

- The e2-micro VM, 20 GB of standard disk and 1 GB of outbound traffic per month are in the Google Cloud free tier, in us-central1, us-west1 or us-east1.
- The external IPv4 address costs about $3–4 per month.
- Snapshots, Secret Manager and the state bucket cost a few cents per month.

## Notes

- **SSL mode:** kmhome's Terraform already sets the zone to SSL *Full (strict)* and *Always Use HTTPS*. If this game lives in another zone that isn't strict, set `manage_ssl_rule = true`.
- **kmhome's country allowlist:** kmhome's Cloudflare rule only applies to kmhome's own hostname, so the game is reachable from anywhere.
- **Restarts end online games:** online rooms live in memory, so a deploy ends games in progress. Accounts and history are kept.
- **Secrets:** `infra/keys/`, `backend.hcl`, `terraform.auto.tfvars.json` and any local state hold secrets. They are git-ignored.
