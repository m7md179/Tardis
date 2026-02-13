#!/usr/bin/env bash
set -euo pipefail

# TARDIS Deploy Script
# Deploys latest changes to the Proxmox LXC container (PCT 106)

PROXMOX_HOST="root@192.168.100.9"
PCT_ID="106"
REMOTE_DIR="/opt/Tardis"
SERVICE="tardis"

echo "==> Deploying TARDIS to PCT ${PCT_ID} via ${PROXMOX_HOST}..."

# Push local changes to git first
echo "==> Pushing local changes..."
cd "$(dirname "$0")/.."
git push origin main

# SSH into Proxmox host, then exec into the LXC container
echo "==> Updating server inside container PCT ${PCT_ID}..."
ssh "${PROXMOX_HOST}" bash -s <<REMOTE
set -euo pipefail

pct exec ${PCT_ID} -- bash -c '
set -euo pipefail

cd ${REMOTE_DIR}

echo "  -> Pulling latest code..."
git pull origin main

echo "  -> Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install

echo "  -> Restarting service..."
systemctl restart ${SERVICE}

echo "  -> Checking service status..."
sleep 2
systemctl status ${SERVICE} --no-pager -l

echo ""
echo "  -> Recent logs:"
journalctl -u ${SERVICE} -n 20 --no-pager

echo ""
echo "==> Deploy complete!"
'
REMOTE
