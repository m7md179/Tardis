# Plugins

TARDIS supports plugins that extend time tracking with custom behavior — session hooks, commands, notifications, and external integrations.

Plugins live on the **server** (the machine running the TARDIS server process). The server loads them from `/var/lib/tardis/plugins/` on startup.

## Where Plugins Run

Plugins are loaded and executed by the TARDIS server, not the CLI. All plugin management happens on the server:

- The server discovers plugins in its `plugins/` directory (default: `/var/lib/tardis/plugins/`)
- Plugin commands are executed server-side via the CLI or Telegram
- Plugin storage is persisted on the server filesystem

## Installing Plugins

### Option 1: Deploy with the repo (recommended)

The included plugins live in the `plugins/` directory of the TARDIS repo. The deploy script automatically syncs them to the server:

```bash
./scripts/deploy.sh
```

This pushes your code, copies all plugins from `plugins/` to `/var/lib/tardis/plugins/` on the server, installs their dependencies, and restarts the service. Plugin storage data is preserved across deploys.

To add a new plugin this way, just place it in `plugins/<name>/` in the repo and deploy.

### Option 2: Install from git on the server

SSH into the server and use the CLI:

```bash
tardis plugin install <git-url>
```

Clones the repo into the plugins directory, validates the manifest, and installs dependencies with `bun install`. Requires a server restart.

### Option 3: Manual copy on the server

```bash
cp -r /path/to/my-plugin /var/lib/tardis/plugins/my-plugin
```

## Managing Plugins

### List installed plugins

```bash
tardis plugin list
```

Shows all plugins with their status (enabled/disabled), commands, and hooks.

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

Pulls latest from git and reinstalls dependencies. Only works for git-installed plugins.

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

Scaffolds a new plugin with a starter `plugin.json` and `index.ts`. If you want it deployed with the repo, create it in `plugins/` instead of `~/.tardis/plugins/`.

---

## Included Plugins

TARDIS ships with these ready-to-use plugins. They're deployed automatically when you run `./scripts/deploy.sh`.

### Skill Engine

Self-evolving skill tracking with adaptive training, XP, leveling, weak area detection, and Todoist integration.

Full documentation: [skill-engine.md](./skill-engine.md)

**Commands:** `add-skill`, `remove-skill`, `skills`, `train`, `complete-training`, `progress`, `weak-areas`, `stats`, `calibrate`, `config`

**Quick start:**

```
plugin skill-engine add-skill typescript tech
plugin skill-engine train typescript
plugin skill-engine complete-training 85
plugin skill-engine progress typescript
```

Or via Gemini natural language: _"I want to learn Python"_, _"Let's practice TypeScript"_, _"I scored 80%"_

---

### Gemini Assistant

AI-powered natural language interface. Turns plain text messages into TARDIS actions through Google Gemini's function calling API.

**Setup:**

```
plugin gemini-assistant config apiKey YOUR_GEMINI_KEY
```

**How it works:** Any unrecognized message in Telegram is routed to Gemini. It chains up to 8 function calls to accomplish complex requests in one go — time tracking, task management, plugin commands, reminders, and skill training.

**Commands:** `ask`, `config`, `clear`

---

### Pomodoro Timer

Sends break reminders after a configurable work interval when you start a session.

#### Setup

No setup needed — the plugin activates automatically after deploy. Verify with:

```bash
tardis plugin list
```

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

| Setting         | Default | Description                              |
| --------------- | ------- | ---------------------------------------- |
| `workDuration`  | 25      | Minutes before break notification        |
| `breakDuration` | 5       | Break duration shown in the notification |
| `autoNotify`    | true    | Auto-schedule timer on session start     |

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

The plugin files are deployed automatically, but you need to configure Google OAuth credentials.

**1. Create Google OAuth credentials:**

1. Go to [Google Cloud Console — Credentials](https://console.cloud.google.com/apis/credentials)
2. Create a project (or select an existing one)
3. Enable the **Google Calendar API** under APIs & Services
4. Create an **OAuth 2.0 Client ID** with application type **Desktop**
5. Copy the Client ID and Client Secret

**2. Configure credentials:**

After deploying, run via CLI or Telegram:

```bash
tardis plugin run google-calendar-sync setup <client_id> <client_secret>
```

```
plugin google-calendar-sync setup <client_id> <client_secret>
```

This stores the credentials and gives you an authorization URL.

**3. Complete the OAuth flow:**

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

| Setting      | Default   | Description                       |
| ------------ | --------- | --------------------------------- |
| `autoSync`   | true      | Sync sessions to calendar on stop |
| `calendarId` | "primary" | Google Calendar ID to sync to     |

To sync to a specific calendar instead of your primary one, find the calendar ID in Google Calendar settings and update the plugin config.
