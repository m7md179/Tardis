# Plugins

TARDIS supports plugins that extend time tracking with custom behavior — session hooks, commands, notifications, and external integrations.

Plugins are installed to `~/.tardis/plugins/` and auto-discovered by the server on startup.

## Managing Plugins

### List installed plugins

```bash
tardis plugin list
```

Shows all plugins with their status (enabled/disabled), commands, and hooks.

### Install a plugin from git

```bash
tardis plugin install <git-url>
```

Clones the repo into `~/.tardis/plugins/`, validates the manifest, and installs any npm dependencies with `bun install`. Restart the server after installing.

### Uninstall a plugin

```bash
tardis plugin uninstall <name>
```

### Enable / Disable

```bash
tardis plugin enable <name>
tardis plugin disable <name>
```

Toggling requires a server restart to take effect.

### Update plugins

```bash
tardis plugin update <name>       # Update a single plugin
tardis plugin update --all        # Update all plugins
```

Pulls latest from git and reinstalls dependencies.

### Run a plugin command

Plugin commands require the TARDIS server to be running. You can run them through:

**CLI:**
```bash
tardis plugin run <name> <command> [args...]
```

**Telegram:**
```
plugin <name> <command> [args...]
```

### Create a new plugin

```bash
tardis plugin create <name>
```

Scaffolds a new plugin in `~/.tardis/plugins/<name>/` with a starter `plugin.json` and `index.ts`.

---

## Included Plugins

TARDIS ships with two ready-to-use plugins in the `plugins/` directory of the repo. Copy them to `~/.tardis/plugins/` to use them.

### Pomodoro Timer

Sends break reminders after a configurable work interval when you start a session.

#### Setup

```bash
# Copy to plugins directory
cp -r plugins/pomodoro-timer ~/.tardis/plugins/

# Verify it's detected
tardis plugin list
```

Restart the TARDIS server. The plugin activates automatically.

#### How it works

- When a session starts, a timer is set for the configured work duration (default: 25 minutes)
- When the timer fires, you get a notification to take a break
- If you stop the session before the timer fires, it's cancelled
- Completed pomodoros are tracked in storage (daily + all-time)

#### Commands

**Start a pomodoro session:**
```bash
tardis plugin run pomodoro-timer start <task name>
```
```
plugin pomodoro-timer start Write documentation
```
Starts a TARDIS session and schedules the pomodoro notification.

**View or update settings:**
```bash
tardis plugin run pomodoro-timer config
tardis plugin run pomodoro-timer config workDuration 30
tardis plugin run pomodoro-timer config breakDuration 10
tardis plugin run pomodoro-timer config autoNotify false
```
```
plugin pomodoro-timer config
plugin pomodoro-timer config workDuration 30
```

| Setting | Default | Description |
|---|---|---|
| `workDuration` | 25 | Minutes before break notification |
| `breakDuration` | 5 | Break duration shown in the notification |
| `autoNotify` | true | Auto-schedule timer on session start |

**View stats:**
```bash
tardis plugin run pomodoro-timer stats
```
```
plugin pomodoro-timer stats
```
Shows today's and all-time pomodoro completion count.

---

### Google Calendar Sync

Automatically creates Google Calendar events for completed TARDIS sessions.

#### Setup

**1. Create Google OAuth credentials:**

1. Go to [Google Cloud Console — Credentials](https://console.cloud.google.com/apis/credentials)
2. Create a project (or select an existing one)
3. Enable the **Google Calendar API** under APIs & Services
4. Create an **OAuth 2.0 Client ID** with application type **Desktop**
5. Copy the Client ID and Client Secret

**2. Install the plugin:**

```bash
# Copy to plugins directory
cp -r plugins/google-calendar-sync ~/.tardis/plugins/

# Install dependencies
cd ~/.tardis/plugins/google-calendar-sync
bun install
```

Restart the TARDIS server.

**3. Configure credentials:**

```bash
tardis plugin run google-calendar-sync setup <client_id> <client_secret>
```
Or via Telegram:
```
plugin google-calendar-sync setup <client_id> <client_secret>
```

This stores the credentials and gives you an authorization URL.

**4. Complete the OAuth flow:**

1. Open the authorization URL from the previous step in your browser
2. Sign in and grant calendar access
3. Copy the authorization code
4. Run:

```bash
tardis plugin run google-calendar-sync setup-token <auth_code>
```
```
plugin google-calendar-sync setup-token <auth_code>
```

Setup is complete. Sessions will now sync automatically when stopped.

#### Commands

**Check status:**
```bash
tardis plugin run google-calendar-sync status
```
```
plugin google-calendar-sync status
```
Shows whether credentials are configured, auto-sync state, calendar ID, total synced count, and last sync time.

**Manually sync sessions:**
```bash
tardis plugin run google-calendar-sync sync-all
```
```
plugin google-calendar-sync sync-all
```
Syncs all recent completed sessions to Google Calendar.

#### Configuration

| Setting | Default | Description |
|---|---|---|
| `autoSync` | true | Sync sessions to calendar on stop |
| `calendarId` | "primary" | Google Calendar ID to sync to |

To sync to a specific calendar instead of your primary one, find the calendar ID in Google Calendar settings and update the plugin config.
