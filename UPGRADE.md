# TARDIS Server Upgrade Guide

This guide explains how to upgrade TARDIS on your Proxmox LXC container.

## Infrastructure

- **Proxmox host**: `root@192.168.100.9`
- **LXC container**: PCT 106 (`tardis-server`)
- **App path**: `/opt/Tardis`
- **Data path**: `/var/lib/tardis`

To run commands inside the container from the Proxmox host:

```bash
pct exec 106 -- bash -c '<command>'
```

## Quick Start (Recommended)

From your local machine:

```bash
./scripts/deploy.sh
```

This automates the entire upgrade process:
1. Pushes your local changes to git
2. SSHs into the Proxmox host
3. Exec into PCT 106 (LXC container)
4. Pulls the latest code
5. Installs/updates dependencies
6. Restarts the service
7. Shows service status and logs

**Time:** ~30 seconds
**Downtime:** ~2-3 seconds (service restart)

## Manual Upgrade Steps

### 1. SSH into the Proxmox Host

```bash
ssh root@192.168.100.9
```

### 2. Enter the LXC Container

```bash
pct exec 106 -- bash
```

### 3. Navigate to TARDIS Directory

```bash
cd /opt/Tardis
```

### 4. Pull Latest Code

```bash
git pull origin main
```

### 5. Install Dependencies

```bash
bun install
```

### 6. Restart the Service

```bash
systemctl restart tardis
```

### 7. Verify the Upgrade

```bash
systemctl status tardis --no-pager
journalctl -u tardis -n 50 --no-pager
```

## One-Liner (From Proxmox Host)

```bash
pct exec 106 -- bash -c 'cd /opt/Tardis && git pull origin main && bun install && systemctl restart tardis && sleep 2 && systemctl status tardis --no-pager'
```

## Rollback

### From Inside the Container

```bash
cd /opt/Tardis
git log --oneline -10          # Find the commit to rollback to
git reset --hard <commit-hash> # Or: git reset --hard HEAD~1
bun install
systemctl restart tardis
```

### From Proxmox Host

```bash
pct exec 106 -- bash -c 'cd /opt/Tardis && git reset --hard HEAD~1 && bun install && systemctl restart tardis'
```

## Troubleshooting

### Service Won't Start

```bash
pct exec 106 -- journalctl -u tardis -n 100 --no-pager
```

Common issues:
- **Config file missing**: Check `/var/lib/tardis/config.json` exists
- **Port conflict**: `pct exec 106 -- ss -tlnp | grep 3000`
- **Permission issues**: Verify `/opt/Tardis` and `/var/lib/tardis` are readable

### Dependency Issues

```bash
pct exec 106 -- bash -c 'cd /opt/Tardis && rm -rf node_modules bun.lockb && bun install'
```

### Nuclear Reset

```bash
pct exec 106 -- bash -c 'cd /opt/Tardis && git reset --hard origin/main && git clean -fd && bun install && systemctl restart tardis'
```

## Monitoring After Upgrade

```bash
# Watch logs in real-time
pct exec 106 -- journalctl -u tardis -f

# Check API health
pct exec 106 -- curl -s http://localhost:3000/api/health
```

Test Telegram bot: send `help`, `tasks`, `add Test task`

## Service Management (From Proxmox Host)

```bash
pct exec 106 -- systemctl status tardis     # Status
pct exec 106 -- systemctl restart tardis    # Restart
pct exec 106 -- systemctl stop tardis       # Stop
pct exec 106 -- systemctl start tardis      # Start
pct exec 106 -- journalctl -u tardis -n 50  # Logs
```

## File Locations (Inside Container)

| Path | Purpose |
|------|---------|
| `/opt/Tardis` | Source code (git repo) |
| `/var/lib/tardis` | Data, config, sessions |
| `/var/lib/tardis/config.json` | Server configuration |
| `/etc/systemd/system/tardis.service` | Systemd service file |

## Backup Before Upgrade

```bash
pct exec 106 -- bash -c 'cp /var/lib/tardis/config.json /var/lib/tardis/config.json.backup.$(date +%Y%m%d)'
```
