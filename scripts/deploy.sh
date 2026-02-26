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

# Copy local config to the proxmox host
echo "==> Copying local config to server..."
scp "$HOME/.tardis/config.json" "${PROXMOX_HOST}:/tmp/tardis_config.json"

# SSH into Proxmox host, then exec into the LXC container
echo "==> Updating server inside container PCT ${PCT_ID}..."
ssh "${PROXMOX_HOST}" bash -s <<REMOTE
set -euo pipefail

# Push config file to the container
pct exec ${PCT_ID} -- mkdir -p /root/.tardis
pct push ${PCT_ID} /tmp/tardis_config.json /root/.tardis/config.json
rm -f /tmp/tardis_config.json

pct exec ${PCT_ID} -- bash -c '
set -euo pipefail

export PATH="/root/.bun/bin:/usr/local/bin:\$PATH"

cd ${REMOTE_DIR}
git config --global --add safe.directory ${REMOTE_DIR} 2>/dev/null || true

echo "  -> Pulling branch ${BRANCH}..."
git fetch origin ${BRANCH}
git checkout ${BRANCH} 2>/dev/null || git checkout -b ${BRANCH} origin/${BRANCH}
git reset --hard origin/${BRANCH}

echo "  -> Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install

echo "  -> Building web UI..."
(cd packages/web-ui && bun run build)

echo "  -> Syncing plugins..."
PDIR="/root/.tardis/plugins"
mkdir -p \$PDIR
if [ -d ${REMOTE_DIR}/plugins ]; then
  for pdir in ${REMOTE_DIR}/plugins/*/; do
    pname=\$(basename "\$pdir")
    
    # Save existing storage to the repo directory if we are replacing a non-symlink
    if [ -d "\$PDIR/\$pname/storage" ] && [ ! -L "\$PDIR/\$pname" ]; then
      cp -r "\$PDIR/\$pname/storage" "\$pdir/storage"
    fi
    
    # Symlink the entire plugin folder so Bun evaluates the workspace realpath properly
    rm -rf "\$PDIR/\$pname"
    ln -s "\$pdir" "\$PDIR/\$pname"
    
    echo "    Synced plugin: \$pname"
  done
fi

echo "  -> Restarting service..."
systemctl restart ${SERVICE}

echo "  -> Checking service status..."
sleep 3
systemctl status ${SERVICE} --no-pager -l || true

echo ""
echo "  -> Recent logs:"
journalctl -u ${SERVICE} -n 30 --no-pager

echo ""
if systemctl is-active --quiet ${SERVICE}; then
  echo "==> Deploy complete!"
else
  echo "==> WARNING: Service is not running! Check logs above."
  exit 1
fi
'
REMOTE
