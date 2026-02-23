# TARDIS Server Deployment Guide

## Proxmox LXC Container Setup

### 1. Create LXC Container

1. In Proxmox Web UI, click **Create CT**
2. Configure:
   - **Hostname**: tardis-server
   - **Template**: Ubuntu 22.04
   - **Disk**: 10GB
   - **CPU**: 1 core
   - **Memory**: 512MB
   - **Network**: Bridge (vmbr0), DHCP or static IP

### 2. Install Dependencies

```bash
# Start and enter container
pct start 200
pct enter 200

# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y curl git unzip

# Install Bun
curl -fsSL https://bun.sh/install | bash
source /root/.bashrc

# Verify
bun --version
```

### 3. Install Tailscale

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale (opens URL for auth)
tailscale up

# Get Tailscale IP
tailscale ip -4
# Save this IP (e.g., 100.64.0.5)
```

### 4. Deploy TARDIS Server

#### Option A: From Git Repository

```bash
# Clone repository
cd /opt
git clone https://github.com/yourusername/tardis.git
cd tardis

# Install dependencies
bun install

# Build (optional)
cd packages/server
bun run build
```

#### Option B: Upload Files

```bash
# From your Mac
scp -r /path/to/tardis root@<container-ip>:/opt/

# In container
cd /opt/tardis
bun install
```

### 5. Configure TARDIS

```bash
# Create data directory
mkdir -p /var/lib/tardis/users/default/{active_sessions,sessions}
mkdir -p /var/lib/tardis/logs

# Copy example config
cp /opt/tardis/packages/server/config.example.json /var/lib/tardis/config.json

# Generate JWT secret
bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copy output and update config.json

# Generate API key
cd /opt/tardis/packages/server
bun scripts/generate-api-key.ts
# Save the API key for CLI configuration

# Edit config
nano /var/lib/tardis/config.json
# Update:
#  - jwtSecret (from above)
#  - todoist.apiToken (your Todoist API token)
#  - telegram.botToken (if using Telegram bot)
#  - telegram.chatId (your Telegram chat ID)
```

### 6. Install systemd Service

```bash
# Copy service file
cp /opt/tardis/packages/server/tardis.service /etc/systemd/system/

# Reload systemd
systemctl daemon-reload

# Enable service
systemctl enable tardis

# Start service
systemctl start tardis

# Check status
systemctl status tardis

# View logs
journalctl -u tardis -f
```

### 7. Test Server

```bash
# From container
curl http://localhost:3000/api/health

# From Mac (via Tailscale)
curl http://100.64.0.5:3000/api/health

# Expected output:
# {"status":"ok","uptime":123,"version":"2.0.0","timestamp":"..."}
```

## Telegram Bot Setup

### 1. Create Bot with BotFather

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow prompts to name your bot
4. Save the **bot token** (looks like `123456:ABC-DEF...`)

### 2. Get Your Chat ID

```bash
# Send a message to your bot in Telegram
# Then run:
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates

# Find "chat":{"id":123456789} in the response
# That number is your chat ID
```

### 3. Update Configuration

```bash
nano /var/lib/tardis/config.json
```

Update the telegram section:

```json
{
  "notifications": {
    "enabled": true,
    "channels": {
      "telegram": {
        "enabled": true,
        "botToken": "123456:ABC-DEF...",
        "chatId": "123456789"
      }
    }
  }
}
```

```bash
# Restart server
systemctl restart tardis

# Check logs
journalctl -u tardis -f
# Should see "Telegram bot started successfully"
```

## CLI Configuration (On Your Mac)

### 1. Install/Update CLI

```bash
cd /path/to/tardis
bun install

# Make CLI available globally (optional)
bun link
```

### 2. Configure Server Connection

```bash
# Set server URL (use Tailscale IP)
tardis config --server-url http://100.64.0.5:3000

# Set API key (from generate-api-key.ts output)
tardis config --api-key YOUR_API_KEY_HERE

# Test connection
tardis status
```

## Monitoring & Maintenance

### View Logs

```bash
# Real-time logs
journalctl -u tardis -f

# Last 100 lines
journalctl -u tardis -n 100

# Errors only
journalctl -u tardis -p err
```

### Restart Server

```bash
systemctl restart tardis
```

### Update Server

```bash
cd /opt/tardis
git pull
bun install
systemctl restart tardis
```

### Backup Data

```bash
# Create backup script
cat > /usr/local/bin/tardis-backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/tardis"
DATE=$(date +%Y-%m-%d)
mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/tardis-$DATE.tar.gz /var/lib/tardis
# Keep last 7 days
find $BACKUP_DIR -name "tardis-*.tar.gz" -mtime +7 -delete
EOF

chmod +x /usr/local/bin/tardis-backup.sh

# Add to cron (daily at 2am)
echo "0 2 * * * /usr/local/bin/tardis-backup.sh" | crontab -
```

### Restore from Backup

```bash
# Stop server
systemctl stop tardis

# Restore
tar -xzf /var/backups/tardis/tardis-YYYY-MM-DD.tar.gz -C /

# Start server
systemctl start tardis
```

## Troubleshooting

### Server Won't Start

```bash
# Check logs
journalctl -u tardis -n 50

# Common issues:
# 1. Config file not found
ls -la /var/lib/tardis/config.json

# 2. Permission issues
chown -R root:root /var/lib/tardis
chmod 644 /var/lib/tardis/config.json

# 3. Port already in use
netstat -tulpn | grep 3000
```

### Telegram Bot Not Responding

```bash
# Check if bot is running
journalctl -u tardis | grep "Telegram bot"

# Test bot token
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe

# Restart server
systemctl restart tardis
```

### Can't Connect from CLI

```bash
# Test Tailscale connection
ping 100.64.0.5

# Test server endpoint
curl http://100.64.0.5:3000/api/health

# Check CLI config
cat ~/.tardis/config.json
```

## Security Notes

- Change default JWT secret immediately
- Rotate API keys periodically
- Keep Tailscale VPN active for secure communication
- Don't expose port 3000 to public internet
- Regular backups of `/var/lib/tardis`
- Monitor logs for suspicious activity

## Performance Tuning

### Increase Container Resources (if needed)

```bash
# On Proxmox host
pct set 200 -memory 1024
pct set 200 -cores 2

# Restart container
pct restart 200
```

### Disable Scheduler (if not needed)

Edit `/var/lib/tardis/config.json`:

```json
{
  "scheduler": {
    "enabled": false
  }
}
```

## Next Steps

1. Test all CLI commands with server
2. Test Telegram bot commands
3. Set up monitoring/alerting (optional)
4. Configure backup automation
5. Document your specific workflow
