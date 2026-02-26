#!/usr/bin/env bash
set -euo pipefail

# TARDIS Deploy Script
# Deploys latest changes to the Proxmox LXC container (PCT 106)

PROXMOX_HOST="root@192.168.100.9"
PCT_ID="106"
REMOTE_DIR="/opt/Tardis"
SERVICE="tardis"

cd "$(dirname "$0")/.."

BRANCH=$(git branch --show-current)

echo "==> Deploying TARDIS to PCT ${PCT_ID} via ${PROXMOX_HOST}..."
echo "    Branch: ${BRANCH}"

# Build web UI locally first
echo "==> Building web UI..."
(cd packages/web-ui && bun run build)

# Push current branch to git
echo "==> Pushing ${BRANCH}..."
git push origin "${BRANCH}"

# SSH into Proxmox host, then exec into the LXC container
echo "==> Updating server inside container PCT ${PCT_ID}..."
ssh "${PROXMOX_HOST}" bash -s <<REMOTE
set -euo pipefail

pct exec ${PCT_ID} -- bash -c '
set -euo pipefail

export PATH="/root/.bun/bin:/usr/local/bin:\$PATH"

cd ${REMOTE_DIR}

echo "  -> Pulling branch ${BRANCH}..."
git fetch origin ${BRANCH}
git checkout ${BRANCH} 2>/dev/null || git checkout -b ${BRANCH} origin/${BRANCH}
git reset --hard origin/${BRANCH}

echo "  -> Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install

echo "  -> Building web UI..."
(cd packages/web-ui && bun run build)

echo "  -> Syncing plugins..."
PDIR="/var/lib/tardis/plugins"
mkdir -p \$PDIR
if [ -d ${REMOTE_DIR}/plugins ]; then
  for pdir in ${REMOTE_DIR}/plugins/*/; do
    pname=\$(basename "\$pdir")
    if [ -d "\$PDIR/\$pname/storage" ]; then
      cp -r "\$PDIR/\$pname/storage" "/tmp/tardis-pstor-\$pname"
    fi
    rm -rf "\$PDIR/\$pname"
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
