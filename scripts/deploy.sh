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
PLUGINS_DIR="/var/lib/tardis/plugins"
mkdir -p ${PLUGINS_DIR}
if [ -d ${REMOTE_DIR}/plugins ]; then
  for plugin_dir in ${REMOTE_DIR}/plugins/*/; do
    plugin_name=$(basename "$plugin_dir")
    # Preserve plugin storage data during sync
    if [ -d "${PLUGINS_DIR}/${plugin_name}/storage" ]; then
      cp -r "${PLUGINS_DIR}/${plugin_name}/storage" "/tmp/tardis-plugin-storage-${plugin_name}"
    fi
    cp -r "$plugin_dir" "${PLUGINS_DIR}/${plugin_name}"
    if [ -d "/tmp/tardis-plugin-storage-${plugin_name}" ]; then
      cp -r "/tmp/tardis-plugin-storage-${plugin_name}" "${PLUGINS_DIR}/${plugin_name}/storage"
      rm -rf "/tmp/tardis-plugin-storage-${plugin_name}"
    fi
    # Install plugin dependencies if needed
    if [ -f "${PLUGINS_DIR}/${plugin_name}/package.json" ]; then
      (cd "${PLUGINS_DIR}/${plugin_name}" && bun install --frozen-lockfile 2>/dev/null || bun install)
    fi
    echo "    Synced plugin: ${plugin_name}"
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
