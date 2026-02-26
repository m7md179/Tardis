# TARDIS — Technical Documentation

**Time And Resource Documentation & Insight System**

A time-tracking and task management system built with TypeScript and Bun. Integrates Todoist for tasks, Telegram for interaction, and runs a local AI assistant via Ollama for natural language control.

---

## Tech Stack

| Component    | Technology               | Why                                                   |
| ------------ | ------------------------ | ----------------------------------------------------- |
| Runtime      | **Bun 1.3.8+**           | Fast startup, native TS, built-in SQLite              |
| Language     | **TypeScript 5.7+**      | Type safety across the monorepo                       |
| HTTP Server  | **Hono**                 | Lightweight, Bun-optimized web framework              |
| Telegram Bot | **Telegraf**             | Mature Telegram Bot API wrapper                       |
| Validation   | **Zod**                  | Runtime schema validation for configs, API, manifests |
| Database     | **Drizzle ORM + SQLite** | Type-safe queries for the skill engine                |
| CLI          | **Commander + Inquirer** | Argument parsing + interactive prompts                |
| Build        | **Turborepo**            | Monorepo task orchestration with caching              |
| AI           | **Ollama (Qwen3)**       | Local LLM for natural language interface              |

---

## Project Structure

```
tardis/
├── packages/
│   ├── server/          # REST API, scheduler, Telegram bot, plugin runtime
│   ├── cli/             # Standalone CLI (works without server)
│   ├── shared/          # Types, schemas, utilities shared across packages
│   └── db/              # Drizzle ORM schema & migrations (SQLite)
├── plugins/
│   ├── tardis-assistant/ # AI assistant (Ollama + Qwen3)
│   ├── pomodoro-timer/   # Break reminders after work intervals
│   ├── google-calendar-sync/ # Sync sessions to Google Calendar
│   └── skill-engine/    # Adaptive skill tracking & training
├── scripts/
│   └── deploy.sh        # Push → SSH → deploy → restart
├── docs/                # Documentation
├── turbo.json           # Build pipeline config
└── package.json         # Workspace root
```

---

## Core System

### Server Startup

```
index.ts
  → loadConfig()
  → SessionManager        (time tracking engine)
  → TodoistClient         (task API)
  → NotificationService   (Telegram/email alerts)
  → PluginManager.loadAll()  (discover & activate plugins)
  → createServer()        (Hono HTTP app)
  → startScheduler()      (background jobs)
  → startTelegramBot()    (Telegram interface)
```

The server runs as a **systemd service** inside a Proxmox LXC container, listening on port 3000.

### Session Lifecycle

Sessions are the core unit — a timed record of work on a task.

```
         start()          pause()         resume()         stop()
  IDLE ────────→ ACTIVE ────────→ PAUSED ────────→ ACTIVE ────────→ COMPLETED
                   │                                                    │
                   └── duration accumulates while ACTIVE ──────────────→
```

**Storage:** Active sessions live in `~/.tardis/active_sessions/`. On stop, they're archived to `~/.tardis/sessions/YYYY-MM-DD/`.

**Key Operations:**

- `start({ taskName, timeWindow? })` — Creates a session, emits `session:start` to plugins
- `stop(sessionId)` — Calculates final duration, archives, optionally syncs to Todoist
- `pause/resume` — Tracks accumulated time across pause/resume cycles
- Duration is always in seconds, formatted as `2h 15m` for display

### Time Windows

Tasks can have scheduled time slots like `[14:00-15:30]` stored in Todoist task descriptions. TARDIS parses these and monitors them:

- Supports 12hr (`2pm-3pm`) and 24hr (`14:00-15:30`) formats
- Normalized to `[HH:MM-HH:MM]` internally
- Scheduler checks every minute and sends notifications at window start/end

### REST API

Built with Hono, JWT-authenticated:

| Method | Endpoint                      | Description          |
| ------ | ----------------------------- | -------------------- |
| GET    | `/api/health`                 | Health check         |
| POST   | `/api/auth/login`             | Get JWT token        |
| GET    | `/api/sessions/active`        | List active sessions |
| POST   | `/api/sessions/start`         | Start tracking       |
| POST   | `/api/sessions/stop`          | Stop tracking        |
| POST   | `/api/sessions/pause`         | Pause session        |
| POST   | `/api/sessions/resume`        | Resume session       |
| GET    | `/api/sessions/history`       | Archived sessions    |
| GET    | `/api/plugins`                | List plugins         |
| POST   | `/api/plugins/:name/:command` | Run plugin command   |

Rate limited (100 req/min per IP).

### Background Scheduler

Two recurring jobs:

1. **Time Window Monitor** (every 1m) — checks if current time falls within any task's window, sends notifications
2. **Auto-Rescheduler** (daily at 11:59 PM) — moves incomplete sessions to tomorrow

---

## Integrations

### Todoist

Full CRUD access to Todoist tasks via their REST API:

```typescript
tasks.getAll()          // Paginated fetch (cursor-based)
tasks.create(content, description?, dueString?)
tasks.update(taskId, { content?, due_string?, priority? })
tasks.complete(taskId)
tasks.delete(taskId)
```

**Fuzzy Task Matching:** When a user says "mark dentist as done", the system matches against all tasks using:

1. Exact match → 2. Prefix match → 3. Contains match → 4. Word overlap (>50%)

### Telegram Bot

The primary user interface. Handles both structured commands and natural language:

**Structured Commands:**

- `/start <task>` — Start tracking (with fuzzy task matching)
- `/stop` — Stop active session
- `/pause` / `/resume` — Session control
- `/status` — Current session info
- `/tasks` — List Todoist tasks
- `/add <task>` — Create task (supports `due:`, `[time]`, `p:` flags)
- `/plugin <name> <command>` — Run any plugin command

**Smart Routing:**

- Commands with structured flags → direct handler
- Plain natural language → routed to TARDIS AI assistant
- Unknown commands → assistant fallback

### Notifications

Sends alerts via Telegram (primary) or email (optional):

- Time window start/end
- Task overdue warnings
- Plugin-triggered notifications (reminders, break suggestions)

---

## Plugin System

### How Plugins Work

Plugins are self-contained directories in `plugins/` with a manifest (`plugin.json`) and entry point (`index.ts`).

**Lifecycle:**

```
Discovery → Validate manifest → Import index.ts → onActivate(api) → Ready
                                                                      ↓
                                              Shutdown → onDeactivate()
```

### Plugin Manifest (`plugin.json`)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "description": "What it does",
  "main": "index.ts",
  "tardisVersion": ">=2.0.0",
  "permissions": [
    "sessions:read",
    "sessions:write",
    "tasks:read",
    "tasks:write",
    "storage:read",
    "storage:write",
    "notifications:send",
    "http:external",
    "db:read",
    "db:write"
  ],
  "hooks": ["session:start", "session:stop"],
  "commands": [{ "name": "do-thing", "args": "<required> [optional]", "description": "..." }],
  "config": { "enabled": true, "customKey": "value" }
}
```

### Plugin API

Every plugin receives a `PluginAPI` object with sandboxed, permission-gated access:

```typescript
api.sessions.start({ taskName })    // Start/stop/pause/resume sessions
api.sessions.getActive()

api.tasks.getAll()                  // Full Todoist CRUD
api.tasks.create(name, desc, due)
api.tasks.complete(id)
api.tasks.delete(id)

api.storage.get<T>(key)             // Plugin-isolated key-value store
api.storage.set(key, value)

api.notifications.send(message)     // Send via Telegram/email

api.config.get<T>(key)              // Plugin config (from plugin.json + overrides)
api.config.set(key, value)

api.logger.info/warn/error/debug()  // Namespaced logging

api.events.emit(name, data)         // Custom events
api.events.on(name, handler)

api.plugins.list()                  // Discover other plugins
api.plugins.runWithResult(plugin, cmd, args)  // Cross-plugin calls

api.db.query<T>(sql, params)        // Shared SQLite database
api.db.drizzle()                    // Drizzle ORM instance

api.http.get/post/put/delete()      // HTTP client for external APIs
```

Permissions are enforced at runtime — calling `api.tasks.create()` without `tasks:write` permission throws an error.

### Event Bus

Plugins subscribe to lifecycle events via the `hooks` array in their manifest:

```
SessionManager.stop()
  → EventBus.emit('session:stop', session)
    → pomodoro-timer.onSessionStop(session, api)
    → google-calendar-sync.onSessionStop(session, api)
```

---

## Plugins

### 1. TARDIS Assistant (`tardis-assistant`)

The AI brain. Natural language interface powered by a local Ollama LLM (Qwen3).

**How it works:**

```
User message (Telegram)
  → Telegram bot routes to assistant
  → Build system prompt (personality + rules)
  → Build context (current time, active sessions, tasks)
  → Load conversation history (last 8 messages)
  → Send to Ollama (/v1/chat/completions) with tool definitions
  → Model responds:
      Tool call? → Execute function → Feed result back → Loop (max 8 turns)
      Text?      → Return to user
      "Done."?   → Intent detection fallback → Execute action → Summarize
```

**Three-Layer Fallback System:**

Small models (Qwen3 1.7B/4B) don't always call tools reliably. The assistant handles this with:

1. **Native tool calling** — If the model returns a proper `tool_calls` response, execute it directly
2. **Intent detection** — If the model describes an action in text instead of calling tools, regex-based intent detection parses the user's input and executes the matching function programmatically
3. **Retry without tools** — If the model says "Done." with no action detected, retry the request without tool definitions (which clears ~1000 tokens of overhead and lets small models respond naturally)

**Available Tools (13):**

| Tool                 | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `start_tracking`     | Start a timer for a task                                     |
| `stop_tracking`      | Stop the active timer                                        |
| `pause_tracking`     | Pause the active timer                                       |
| `resume_tracking`    | Resume a paused timer                                        |
| `get_status`         | Check active/paused sessions                                 |
| `add_task`           | Create a Todoist task (with due date, time window, priority) |
| `update_task`        | Update a task (rename, reschedule, change priority)          |
| `reschedule_task`    | Move a task to a new date/time                               |
| `complete_task`      | Mark a single task as done                                   |
| `complete_all_tasks` | Mark ALL tasks as done (batch)                               |
| `delete_task`        | Delete a single task                                         |
| `delete_all_tasks`   | Delete ALL tasks (batch)                                     |
| `list_tasks`         | List all Todoist tasks                                       |
| `set_reminder`       | Set a timed notification                                     |
| `run_plugin_command` | Execute commands from other plugins                          |

**Personality:**

- Witty British butler style ("like JARVIS but for productivity")
- Calls the user "Mohammad" or "boss"
- Dry humor, 1-3 sentences, no emojis (stripped in code)
- Never asks for confirmation — just acts

**Config:**

```
model: qwen3:1.7b     (default, runs at 100 t/s on GTX 1650 Super)
ollamaUrl: http://localhost:11434
```

**Commands:**

- `ask <message>` — Process natural language
- `config [key] [value]` — View/change settings
- `new` — Start fresh conversation
- `clear` — Clear conversation history

### 2. Pomodoro Timer (`pomodoro-timer`)

Automatic break reminders based on the Pomodoro technique.

**How it works:**

- Hooks into `session:start` and `session:stop`
- After `workDuration` minutes of active tracking, sends a break notification
- Tracks daily completion stats

**Config:**

```
workDuration: 25      (minutes)
breakDuration: 5      (minutes)
autoNotify: true
```

**Commands:**

- `start <task>` — Start a Pomodoro session
- `stats` — Show completion statistics
- `config` — Update settings

### 3. Google Calendar Sync (`google-calendar-sync`)

Pushes completed TARDIS sessions to Google Calendar as events.

**How it works:**

- Hooks into `session:stop`
- On session completion, creates a Google Calendar event with task name, duration, and time
- Uses OAuth2 with refresh token for authentication

**Commands:**

- `setup <client-id> <client-secret>` — Configure OAuth credentials
- `sync-all` — Manually sync recent sessions
- `status` — Show connection status

### 4. Skill Engine (`skill-engine`)

An adaptive training system that tracks skill progression with XP, levels, and difficulty calibration.

**Architecture:**

- **SkillRegistry** — CRUD for skills with category/level/XP tracking
- **TrainingManager** — Training session lifecycle (practice, quiz, challenge, review)
- **DifficultyEngine** — Adjusts difficulty based on target success rate (default 85%)
- **AnalyticsEngine** — Progress reports, weak area detection, daily/weekly snapshots

**Database (SQLite via Drizzle):**

- `skills` — name, category, level, xp
- `trainingSessions` — skill, type, difficulty, score
- `weakAreas` — skill, topic, severity
- `skillSnapshots` — periodic progress records

**Commands:**

- `add-skill <name> [category]` / `remove-skill <name>`
- `skills` — List all tracked skills
- `train <skill> [type]` — Start training session
- `complete-training <score>` — Record result
- `progress [skill]` — Progress report
- `weak-areas` — Show detected weaknesses
- `stats [period]` — Analytics
- `calibrate [target]` — Adjust difficulty target

---

## CLI

The CLI works both standalone (JSON file storage) and connected to a server.

### Session Commands

```bash
tardis start <task> [--time-window "14:00-15:30"]
tardis stop [task] [--no-sync]
tardis pause [task]
tardis resume [task]
tardis status
tardis list
tardis log [date|all]
tardis delete <task>
tardis wipe
```

### Task Commands

```bash
tardis tasks [--tomorrow|--week]
tardis sync
tardis complete [task]
tardis add <content> [--due <date>] [--priority <1-4>]
```

### Plugin Commands

```bash
tardis plugin list
tardis plugin <name> <command> [args...]
tardis plugin install <git-url>
tardis plugin create <name>
```

### Configuration

```bash
tardis setup                           # Interactive wizard
tardis config --show
tardis config --todoist-token <token>
```

---

## Shared Types (`packages/shared`)

Defines all schemas and utilities used across packages:

- **Session** — id, taskName, status (ACTIVE/PAUSED/COMPLETED), startTime, endTime, duration, timeWindow
- **TimeWindow** — start/end times in HH:MM format
- **TodoistTask** — content, due, priority, description, id
- **PluginManifest** — name, version, permissions, hooks, commands, config
- **PluginAPI** — full interface for plugin sandbox
- **Config schemas** — server, auth, todoist, telegram, notifications, storage

**Utilities:**

- `parseTimeWindow()` — parses "2pm-3pm" or "14:00-15:30" into TimeWindow
- `formatDuration()` — seconds to "2h 15m"
- `isTimeWindowActive()` — checks if current time is within a window
- Validators for email, URL, task names

---

## Deployment

### Infrastructure

- **Host:** Proxmox 8.x hypervisor
- **Container:** LXC (CT 106) with GPU passthrough (GTX 1650 Super for Ollama)
- **Service:** systemd (`tardis.service`)
- **Data dir:** `/var/lib/tardis/`

### Deploy Script (`scripts/deploy.sh`)

```
1. git push origin main
2. SSH into Proxmox → pct exec into container
3. git fetch && git reset to origin/main
4. bun install
5. Copy plugins/ (preserving storage/ data)
6. Install per-plugin dependencies
7. systemctl restart tardis
8. Tail logs to verify
```

### Server Config (`/var/lib/tardis/config.json`)

```json
{
  "server": { "host": "0.0.0.0", "port": 3000, "dataDir": "/var/lib/tardis" },
  "auth": { "jwtSecret": "...", "jwtExpiry": "30d" },
  "todoist": { "apiToken": "..." },
  "notifications": {
    "channels": {
      "telegram": { "botToken": "...", "chatId": "..." }
    }
  },
  "scheduler": {
    "todoistSyncInterval": 300,
    "timeWindowCheckInterval": 60
  }
}
```

### Ollama Setup

Ollama runs inside the same LXC container with GPU passthrough:

```bash
# Host: mount NVIDIA devices into container
# Container: install matching NVIDIA drivers
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the model
ollama pull qwen3:1.7b

# Verify GPU acceleration
ollama run qwen3:1.7b "hello"  # Should show GPU in nvidia-smi
```

---

## Data Flow

```
User (Telegram)
  │
  ├─ /start, /stop, etc.  ──→  Telegram Bot  ──→  SessionManager  ──→  Storage (JSON)
  │                                   │                    │
  │                                   │                    └──→  EventBus
  │                                   │                           ├─→ pomodoro-timer
  │                                   │                           ├─→ google-calendar-sync
  │                                   │                           └─→ skill-engine
  │
  ├─ Natural language  ────→  Telegram Bot  ──→  TARDIS Assistant
  │                                                    │
  │                                                    ├─→ Ollama (Qwen3)
  │                                                    ├─→ Intent Detection
  │                                                    ├─→ Tool Execution
  │                                                    │      ├─→ SessionManager
  │                                                    │      ├─→ TodoistClient
  │                                                    │      └─→ Other Plugins
  │                                                    └─→ Response → Telegram
  │
  └─ REST API  ────────────→  Hono Server  ──→  JWT Auth  ──→  Handlers
```

---

## Design Principles

1. **Plugin-first** — New features are plugins, not core changes. The core stays small.
2. **Permission-gated** — Plugins declare what they need. The runtime enforces it.
3. **Event-driven** — Plugins react to session events without coupling to each other.
4. **Local-first** — AI runs locally (Ollama), data stored locally (JSON/SQLite). No cloud dependency except Todoist and Telegram.
5. **Type-safe** — Zod schemas validate at runtime what TypeScript checks at compile time.
6. **Graceful degradation** — If Ollama is down, structured commands still work. If Todoist is down, local tracking continues.
