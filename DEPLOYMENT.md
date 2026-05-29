# Dots Game — Deployment

Deploys to the same Compute Engine VM as kmhome over SSH. The Rust server runs
as a systemd service behind nginx, which also serves the static frontend and
proxies WebSocket connections.

## Architecture on the VM

```
/var/www/dots-game/
├── releases/
│   └── <git-sha>/
│       ├── server/
│       │   └── dots-game-server   ← compiled Rust binary
│       └── frontend/
│           └── index.html
├── shared/
│   └── data/
│       └── dots_game.db           ← SQLite DB (persists across deploys)
└── current -> releases/<git-sha>  ← symlink, updated atomically on each deploy
```

nginx serves:
- `https://dots.yourdomain.com/`     → `current/frontend/index.html`
- `https://dots.yourdomain.com/ws/*` → proxied to the Rust server on `127.0.0.1:3001`

## GitHub Actions Secrets & Variables

Set these in the `production` environment of the dots-game repo
(`Settings → Environments → production`). They match kmhome's naming so the
same deploy SSH key and VM host work across both repos.

| Name                | Kind     | Value                              |
|---------------------|----------|------------------------------------|
| `VM_HOST`           | variable | VM public IP                       |
| `VM_PATH`           | variable | `/var/www/dots-game`               |
| `VM_USER`           | variable | `deploy` (or whatever kmhome uses) |
| `VM_SSH_PRIVATE_KEY`| secret   | Contents of `deploy_vm_ed25519`    |

Run the setup script to configure these automatically (requires `gh` CLI):

```bash
VM_IP=<vm-public-ip> \
SSH_KEY_PATH=/path/to/kmhome/infra/keys/deploy_vm_ed25519 \
./infra/scripts/configure-github-actions.sh
```

## One-Time VM Setup

Run once on the VM (as root) after the machine is provisioned:

```bash
sudo bash infra/scripts/setup-vm.sh dots.yourdomain.com /var/www/dots-game deploy 3001
```

This:
1. Creates the directory structure
2. Installs and enables the nginx site for the subdomain
3. Installs and enables the `dots-game-server` systemd service
4. Adds `sudo` rules so the deploy user can restart the service and reload nginx

Then add a Cloudflare DNS **A record**: `dots.yourdomain.com → <VM public IP>` with
proxy enabled (Full Strict SSL via the existing Cloudflare Origin CA cert).

## Deploy Flow (CI/CD)

On every push to `main`:

1. **test** — `cargo check` on the server crate
2. **deploy** (only on `main`, not PRs):
   - Builds the Rust binary with `cargo build --release`
   - Creates a tarball: binary + `index.html`
   - Uploads via `scp` to `/tmp/dots-game-release.tgz`
   - SSH into VM:
     - Extracts to `releases/<git-sha>/`
     - Atomically flips the `current` symlink
     - `systemctl restart dots-game-server`
     - `systemctl reload nginx`

The SQLite database at `shared/data/dots_game.db` survives every deploy.

## Infra Files

| File                                    | Purpose                              |
|-----------------------------------------|--------------------------------------|
| `.github/workflows/ci.yml`             | CI/CD workflow                       |
| `infra/nginx/dots-game.conf`           | nginx vhost template                 |
| `infra/systemd/dots-game-server.service`| systemd unit template               |
| `infra/scripts/setup-vm.sh`           | One-time VM setup                    |
| `infra/scripts/configure-github-actions.sh` | GitHub Actions env setup        |
