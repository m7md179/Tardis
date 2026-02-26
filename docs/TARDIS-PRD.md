# TARDIS - Product Reference Document

## Overview

**TARDIS** (Time And Resource Documentation & Insight System) is a modular time-tracking and task management system built for personal productivity. It integrates with Todoist for task management and provides an AI-powered natural language interface through a Telegram bot, backed by Google's Gemini API.

TARDIS is built for a developer workflow: track what you're actively working on, manage your task backlog, get notified about upcoming time windows, and interact with everything through natural conversation in Telegram.

**Version:** 2.0.0
**Runtime:** Bun / TypeScript
**Storage:** JSON files (no database)
**Deployment:** Proxmox LXC container via systemd

---

## Problem

- Time tracking tools are disconnected from task management
- Switching between apps to start/stop timers breaks flow
- Todoist doesn't have built-in time tracking
- Managing tasks through structured commands is tedious when you just want to say "I'm working on the standup"

## Solution

A single system accessible from Telegram that combines:

- **Active time tracking** (stopwatch for what you're doing right now)
- **Todoist task management** (planning, scheduling, completing)
- **AI assistant** (understands natural language, chains multiple actions, acts on your behalf)
- **Automated notifications** (time window alerts, overdue warnings, daily reschedules)

---

## Interfaces

TARDIS exposes three interfaces. Telegram is the primary daily-use interface.

### Telegram Bot

The main way to interact with TARDIS. Supports both `/command` and plain text (no prefix needed). Unknown messages fall through to the Gemini AI assistant.

| Command  | Args                            | Description                                          |
| -------- | ------------------------------- | ---------------------------------------------------- |
| `start`  | `<task>`                        | Start tracking a task (fuzzy-matches Todoist tasks)  |
| `stop`   |                                 | Stop current session (picker if multiple active)     |
| `pause`  |                                 | Pause current session                                |
| `resume` |                                 | Resume paused session                                |
| `status` |                                 | Show what's currently being tracked                  |
| `list`   |                                 | List all active/paused sessions                      |
| `tasks`  |                                 | List all Todoist tasks with due dates and priorities |
| `add`    | `<task> [time] [due:X] [p:1-4]` | Create a Todoist task                                |
| `config` | `todoist <token>`               | Set Todoist API token at runtime                     |
| `plugin` | `<name> <command> [args]`       | Run a plugin command                                 |
| `help`   |                                 | Show all commands                                    |

**Smart routing:**

- `add` with natural language dates (e.g. "add meeting tomorrow 2pm") routes to Gemini for parsing
- Any unrecognized text routes to Gemini as a natural language query
- Gemini handles it and responds through the same chat

**Autocomplete:** Commands are registered with Telegram's bot menu for `/` autocomplete.

### CLI

Full-featured command-line interface using Commander.js. Operates in local mode (JSON files) or server mode (REST API).

**Session commands:** `start`, `stop`, `pause`, `resume`, `status`, `list`, `log`, `delete`, `wipe`
**Task commands:** `tasks`, `sync`, `complete`, `add`
**Config:** `setup` (wizard), `config` (flags: `--todoist-token`, `--server-url`, `--api-key`, `--show`)
**Plugin management:** `plugin list|install|uninstall|enable|disable|update|run|create`

### REST API

Hono-based HTTP server with JWT authentication and rate limiting.

**Endpoints:**

- `GET /api/health` - Health check
- `POST /api/auth/*` - Authentication
- `GET /api/sessions/active` - Active sessions
- `POST /api/sessions/start|stop|pause|resume` - Session lifecycle
- `GET /api/sessions/history` - Archived sessions
- `GET /api/plugins` - List plugins
- `POST /api/plugins/:name/run` - Execute plugin command

---

## Core Features

### Session Tracking

Sessions represent active work. They have three states: **ACTIVE**, **PAUSED**, **COMPLETED**.

- Start a session by task name (fuzzy-matched against Todoist)
- Pause/resume tracks actual active time (paused duration excluded)
- Stop archives the session and optionally completes the Todoist task
- Sessions are stored as individual JSON files, archived by date
- Multiple sessions can run simultaneously

**Duration calculation:** Accumulates only active time across multiple pause/resume cycles.

### Todoist Integration

TARDIS uses Todoist as the source of truth for tasks. The integration is two-way:

- **Read:** Fetch tasks, fuzzy-match by name when starting sessions
- **Create:** Add tasks with due dates, time windows, and priorities
- **Update:** Rename, reschedule, change priority
- **Complete:** Mark done (automatically when stopping a linked session)
- **Delete:** Remove tasks

**Time windows** are stored in task descriptions as `[HH:MM-HH:MM]` (e.g. `[14:00-15:00]`). These drive the notification system.

**Token management:** The Todoist API token can be set from Telegram (`config todoist <token>`), persisted to the server config file, and updated at runtime without restart.

### Notifications

Automated notifications sent via Telegram (or email):

| Event              | Trigger                               | Message                                  |
| ------------------ | ------------------------------------- | ---------------------------------------- |
| Window starting    | 5 min before time window              | "Time to start: {task}"                  |
| Window ending      | 5 min before window end               | "Time window ending: {task}"             |
| Task overdue       | Past window end, session still active | "Still working on: {task}"               |
| Reschedule summary | Daily at 11:59 PM                     | Lists unfinished tasks moved to tomorrow |

**Time Window Monitor** runs every 60 seconds, checks tasks due today with time windows, prevents duplicate notifications.

**Auto-Rescheduler** runs daily at 11:59 PM, finds unfinished tasks, creates new tasks for tomorrow, completes originals, sends summary.

---

## Plugin System

TARDIS is extensible through plugins. Each plugin lives in its own directory with a `plugin.json` manifest and an `index.ts` entry file.

### Plugin Capabilities

| Capability        | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| **Commands**      | Custom commands invocable from CLI, Telegram, or API       |
| **Session hooks** | React to session start/stop/pause/resume events            |
| **Task hooks**    | React to task sync events                                  |
| **Storage**       | Isolated key-value store (persisted to JSON)               |
| **HTTP**          | Make external API calls                                    |
| **Notifications** | Send messages through configured channels                  |
| **Config**        | User-settable configuration with persistence               |
| **Routes**        | Custom HTTP endpoints mounted under `/api/plugins/<name>/` |
| **Inter-plugin**  | Invoke other plugins' commands                             |

### Permissions

Plugins declare required permissions in their manifest. Access is enforced at runtime.

| Permission           | Grants Access To                       |
| -------------------- | -------------------------------------- |
| `sessions:read`      | Read active/paused sessions            |
| `sessions:write`     | Start, stop, pause, resume sessions    |
| `tasks:read`         | List and read Todoist tasks            |
| `tasks:write`        | Create, update, complete, delete tasks |
| `storage:read`       | Read plugin storage                    |
| `storage:write`      | Write plugin storage                   |
| `http:external`      | Make HTTP requests to external APIs    |
| `notifications:send` | Send notifications via Telegram/email  |

### Built-in Help

Every plugin gets an automatic `help` command that displays all commands (with args), hooks, and config keys from the manifest. No implementation needed.

```
plugin gemini-assistant help
```

### Plugin Lifecycle

1. **Discovery** - Scan plugins directory for `plugin.json` manifests
2. **Loading** - Import module, create storage + API, load saved config
3. **Activation** - Call `onActivate()`, register event hooks
4. **Running** - Handle commands and events
5. **Deactivation** - Call `onDeactivate()`, clean up

Plugin storage is preserved across deployments (the deploy script backs up and restores each plugin's `storage/` directory).

---

## Gemini Assistant Plugin

The Gemini Assistant is the AI brain of TARDIS. It turns natural language into actions by calling TARDIS functions through Google Gemini's function calling API.

### How It Works

1. User sends a message in Telegram (either directly or via fallback routing)
2. Plugin builds context: current time, active sessions, Todoist tasks, available plugins
3. Message + context + conversation history sent to Gemini API with function declarations
4. Gemini decides: respond with text OR call a function
5. If function call: execute it, feed result back to Gemini, loop (up to 8 turns)
6. Final text response sent back to user via Telegram

### Configuration

| Key      | Default            | Description           |
| -------- | ------------------ | --------------------- |
| `apiKey` | `""`               | Google Gemini API key |
| `model`  | `gemini-2.0-flash` | Gemini model to use   |

Set via: `plugin gemini-assistant config apiKey YOUR_KEY`

### Available Functions (13)

**Time Tracking:**

| Function          | Args        | When Used                                  |
| ----------------- | ----------- | ------------------------------------------ |
| `start_tracking`  | `task_name` | "I'm working on X", "starting the standup" |
| `stop_tracking`   |             | "done", "finished", "stopping"             |
| `pause_tracking`  |             | "taking a break", "brb"                    |
| `resume_tracking` |             | "back", "resuming"                         |
| `get_status`      |             | "what am I working on?", "status"          |

**Task Management:**

| Function          | Args                                                                            | When Used                                |
| ----------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| `add_task`        | `name`, `due_date?`, `time_window?`, `priority?`                                | "add meeting tomorrow 2pm", "schedule X" |
| `update_task`     | `task_query`, `new_name?`, `new_due_date?`, `new_description?`, `new_priority?` | "rename X to Y", "change priority"       |
| `reschedule_task` | `task_query`, `new_due_date`, `new_time_window?`                                | "move meeting to Friday"                 |
| `complete_task`   | `task_query`                                                                    | "done with X", "mark X complete"         |
| `delete_task`     | `task_query`                                                                    | "delete X", "remove X"                   |
| `list_tasks`      |                                                                                 | "what's on my list?", "show tasks"       |

**Utilities:**

| Function             | Args                              | When Used                            |
| -------------------- | --------------------------------- | ------------------------------------ |
| `set_reminder`       | `message`, `delay_minutes`        | "remind me in 30 minutes to stretch" |
| `run_plugin_command` | `plugin_name`, `command`, `args?` | "start a pomodoro", "check calendar" |

### Multi-Step Chaining

The assistant chains multiple function calls automatically in a single interaction:

| User Says                              | Functions Called                                                |
| -------------------------------------- | --------------------------------------------------------------- |
| "start working on standup"             | `get_status` -> `stop_tracking` (if active) -> `start_tracking` |
| "add today's standup and start it"     | `add_task` -> `start_tracking`                                  |
| "reschedule meeting and add prep task" | `reschedule_task` -> `add_task`                                 |
| "I'm done with X, mark it complete"    | `stop_tracking` -> `complete_task`                              |

Up to **8 function calls** per message for complex multi-step operations.

### Fuzzy Task Matching

When a function needs to find a task by name, it uses 4-level matching:

1. **Exact** - Normalized name matches exactly
2. **Prefix** - Task name starts with query
3. **Contains** - Query is a substring of task name
4. **Word overlap** - 50%+ of query words found in task (supports partial word matches like "standup" matching "stand")

If multiple matches with no clear winner, the assistant asks the user to clarify. If no matches, it shows available tasks.

### Personality

The assistant acts as a sharp, helpful colleague:

- Casual, concise, direct - no fluff
- Bias toward action (acts immediately when it has enough info)
- Encourages task starts, acknowledges completions
- Suggests breaks after 3+ hours of continuous work
- Error recovery: retries with alternatives before giving up
- Short responses: 1-2 sentences for confirmations

### Conversation History

Maintains the last 12 conversation entries (user messages, function calls, responses) for multi-turn context. Each request includes:

- Current time and day (Riyadh timezone)
- Active sessions with durations
- Top 15 Todoist tasks with priorities and due dates
- Available plugins and their commands

History is persisted to plugin storage and survives server restarts.

---

## Architecture

### Monorepo Structure

```
tardis/
├── packages/
│   ├── shared/          # Types (Zod schemas), utilities (time, format)
│   ├── cli/             # Commander.js CLI with local + server modes
│   └── server/          # Hono HTTP server, Telegram bot, plugins, scheduler
├── plugins/
│   └── gemini-assistant/  # AI natural language interface
├── scripts/
│   └── deploy.sh        # Production deployment
└── docs/
```

### Data Storage

All data is stored as JSON files. No database.

```
/var/lib/tardis/
├── config.json                    # Server configuration
├── sessions/
│   ├── active/                    # Currently running sessions
│   │   └── <uuid>.json
│   └── 2026-02-17/                # Archived by date
│       └── <uuid>.json
└── plugins/
    └── gemini-assistant/
        ├── plugin.json
        ├── index.ts
        └── storage/               # Plugin data (conversation history, config)
```

### Deployment

Hosted in a **Proxmox LXC container** (PCT 106). Deployed via `scripts/deploy.sh`:

1. `git push origin main`
2. SSH into Proxmox host, exec into container
3. `git fetch && git reset --hard origin/main`
4. `bun install`
5. Sync plugins (preserve storage directories)
6. `systemctl restart tardis`

### Tech Stack

| Layer         | Technology                                     |
| ------------- | ---------------------------------------------- |
| Runtime       | Bun 1.3+                                       |
| Language      | TypeScript 5.7                                 |
| HTTP Server   | Hono                                           |
| Telegram      | Telegraf                                       |
| AI            | Google Gemini 2.0 Flash (function calling API) |
| Task Backend  | Todoist REST API v1                            |
| Validation    | Zod                                            |
| CLI Framework | Commander.js                                   |
| Build         | Turbo (monorepo)                               |
| Deployment    | Proxmox LXC + systemd                          |
