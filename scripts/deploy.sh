#!/usr/bin/env bash
set -euo pipefail

# TARDIS Deploy Script
# Deploys latest changes to the Proxmox server

SERVER="root@192.168.100.9"
REMOTE_DIR="/opt/tardis"
SERVICE="tardis"

echo "==> Deploying TARDIS to ${SERVER}..."

# Push local changes to git first
echo "==> Pushing local changes..."
cd "$(dirname "$0")/.."
git push origin main

# SSH into server and update
echo "==> Updating server..."
ssh "${SERVER}" bash -s <<'REMOTE'
set -euo pipefail

cd /opt/tardis

echo "  -> Pulling latest code..."
git pull origin main

echo "  -> Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install

echo "  -> Restarting service..."
systemctl restart tardis

echo "  -> Checking service status..."
sleep 2
systemctl status tardis --no-pager -l

echo ""
echo "  -> Recent logs:"
journalctl -u tardis -n 20 --no-pager

echo ""
echo "==> Deploy complete!"
REMOTE
