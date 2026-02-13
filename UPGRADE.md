# TARDIS Server Upgrade Guide

This guide explains how to upgrade TARDIS on your Proxmox server with minimal downtime.

## Quick Start (Recommended)

From your local machine:

```bash
./scripts/deploy.sh
```

This automates the entire upgrade process:
1. Pushes your local changes to git
2. SSHs into the server
3. Pulls the latest code
4. Installs/updates dependencies
5. Restarts the service
6. Shows service status and logs

**Time:** ~30 seconds
**Downtime:** ~2-3 seconds (service restart)

## Manual Upgrade Steps

If you prefer to upgrade manually, follow these steps:

### 1. SSH into the Proxmox Server

```bash
ssh root@192.168.100.9
```

### 2. Navigate to TARDIS Directory

```bash
cd /opt/tardis
```

### 3. Pull Latest Code

```bash
git pull origin main
```

If you have uncommitted changes, either commit them or stash them:

```bash
git stash                 # Discard local changes
# or
git add . && git commit   # Commit local changes
```

### 4. Install Dependencies

```bash
bun install
```

Or use frozen lockfile for reproducible installs:

```bash
bun install --frozen-lockfile
```

### 5. Restart the Service

```bash
systemctl restart tardis
```

### 6. Verify the Upgrade

Check service status:

```bash
systemctl status tardis --no-pager
```

View recent logs:

```bash
journalctl -u tardis -n 50 --no-pager
```

Monitor logs in real-time:

```bash
journalctl -u tardis -f
```

## Checking for Available Updates

### From Your Local Machine

```bash
cd /path/to/tardis
git log --oneline -10
git fetch origin main
git log --oneline origin/main -10
```

### On the Server

```bash
cd /opt/tardis
git fetch origin main
git diff main origin/main  # Show changes
```

## Rollback to Previous Version

If something goes wrong, you can rollback to the previous version:

### 1. SSH into the Server

```bash
ssh root@192.168.100.9
```

### 2. Check Git History

```bash
cd /opt/tardis
git log --oneline -10
```

### 3. Rollback to Previous Commit

```bash
# Reset to a specific commit
git reset --hard <commit-hash>

# Or go back one version
git reset --hard HEAD~1
```

### 4. Reinstall and Restart

```bash
bun install
systemctl restart tardis
```

### 5. Verify

```bash
systemctl status tardis
journalctl -u tardis -n 20 --no-pager
```

## Scheduled Maintenance

For planned upgrades during off-hours:

### 1. Announce Maintenance

Send a message to users that TARDIS will be temporarily unavailable.

### 2. Stop the Service (Optional)

If you want to make changes before restarting:

```bash
systemctl stop tardis
```

### 3. Perform Upgrade

```bash
cd /opt/tardis
git pull origin main
bun install
```

### 4. Restart

```bash
systemctl start tardis
```

### 5. Monitor Startup

```bash
journalctl -u tardis -f
```

Watch the logs until you see "TARDIS Server ready!" — typically 5-10 seconds.

## Troubleshooting

### Service Won't Start

Check the logs:

```bash
journalctl -u tardis -n 100 --no-pager
```

Common issues:
- **Config file missing**: Check `/var/lib/tardis/config.json` exists
- **Port conflict**: Verify port 3000 is not in use: `ss -tlnp | grep 3000`
- **Permission issues**: TARDIS runs as root; verify `/opt/tardis` and `/var/lib/tardis` are readable

### Dependency Issues

If `bun install` fails:

```bash
rm -rf node_modules bun.lockb
bun install
```

Or use a clean install with frozen lockfile (after pulling new bun.lockb):

```bash
git checkout bun.lockb
bun install --frozen-lockfile
```

### Rollback Broke Things

If rollback didn't work:

```bash
cd /opt/tardis
git reset --hard origin/main  # Go back to remote main
git clean -fd                 # Remove untracked files
bun install
systemctl restart tardis
```

## Monitoring After Upgrade

After upgrading, monitor for issues:

### Watch Logs (5 minutes)

```bash
journalctl -u tardis -f --since "5 min ago"
```

### Check Telegram Bot

Send a message to your TARDIS Telegram bot:
- `help` — Should show updated commands
- `tasks` — Should list Todoist tasks
- `add Test task` — Should create a task

### Check API Health

```bash
curl http://192.168.100.9:3000/api/health
```

Response should be `{"status":"ok"}` (or similar success response).

## Upgrade Checklist

- [ ] Backup current config: `cp /var/lib/tardis/config.json /var/lib/tardis/config.json.backup`
- [ ] Review changes: `git diff main origin/main`
- [ ] Run deploy: `./scripts/deploy.sh` (or manual steps)
- [ ] Verify service status: `systemctl status tardis`
- [ ] Check logs: `journalctl -u tardis -n 20`
- [ ] Test Telegram bot commands
- [ ] Test API endpoint
- [ ] Monitor for 5 minutes

## Continuous Deployment (Optional)

For automated upgrades on every push to `main`:

1. Set up a webhook on the server (using a tool like `webhook` or custom script)
2. GitHub calls the webhook when code is pushed
3. Webhook runs `/opt/tardis/scripts/deploy.sh`

This requires additional setup — ask if you'd like to implement this.

## Service Management

### View Service Status

```bash
systemctl status tardis
```

### Start/Stop/Restart Service

```bash
systemctl start tardis    # Start
systemctl stop tardis     # Stop
systemctl restart tardis  # Restart
```

### Enable Auto-Start on Boot

```bash
systemctl enable tardis
```

### View Service Logs

```bash
journalctl -u tardis -n 100          # Last 100 lines
journalctl -u tardis -f              # Follow (real-time)
journalctl -u tardis --since "1 hour ago"  # Last hour
```

## File Locations

| Path | Purpose |
|------|---------|
| `/opt/tardis` | TARDIS source code and app |
| `/var/lib/tardis` | Data, config, sessions |
| `/var/lib/tardis/config.json` | Server configuration |
| `/var/lib/tardis/sessions/` | Session data |
| `/etc/systemd/system/tardis.service` | Systemd service file |

## Backup Before Upgrade

Always backup your config and data:

```bash
cp /var/lib/tardis/config.json /var/lib/tardis/config.json.backup.$(date +%Y%m%d)
tar -czf /var/lib/tardis/backup.$(date +%Y%m%d).tar.gz /var/lib/tardis/sessions/
```

## Questions?

Check the main [DEPLOYMENT.md](packages/server/DEPLOYMENT.md) for detailed deployment info.

---

**Last Updated:** 2026-02-13
**TARDIS Version:** 2.0.0+
