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

export PATH="/root/.bun/bin:/usr/local/bin:$PATH"

cd ${REMOTE_DIR}

echo "  -> Resetting local changes..."
git fetch origin main
git reset --hard origin/main

echo "  -> Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install

echo "  -> Syncing plugins..."
PDIR="/var/lib/tardis/plugins"
mkdir -p \$PDIR
if [ -d ${REMOTE_DIR}/plugins ]; then
  for pdir in ${REMOTE_DIR}/plugins/*/; do
    pname=\$(basename "\$pdir")
    if [ -d "\$PDIR/\$pname/storage" ]; then
      cp -r "\$PDIR/\$pname/storage" "/tmp/tardis-pstor-\$pname"
    fi
    cp -r "\$pdir" "\$PDIR/\$pname"
    if [ -d "/tmp/tardis-pstor-\$pname" ]; then
      cp -r "/tmp/tardis-pstor-\$pname" "\$PDIR/\$pname/storage"
      rm -rf "/tmp/tardis-pstor-\$pname"
    fi
    if [ -f "\$PDIR/\$pname/package.json" ]; then
      (cd "\$PDIR/\$pname" && bun install --frozen-lockfile 2>/dev/null || bun install)
    fi
    echo "    Synced plugin: \$pname"
  done
fi

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
