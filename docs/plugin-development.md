# TARDIS Plugin Development Guide

## Overview

The TARDIS plugin system lets you extend time tracking with custom behavior. Plugins can:

- React to session lifecycle events (start, stop, pause, resume)
- Add custom commands (via CLI and Telegram)
- Store persistent data
- Send notifications
- Make HTTP requests to external services
- Expose custom API routes

## Quick Start

### 1. Scaffold a Plugin

```bash
tardis plugin create my-plugin
```

This creates `~/.tardis/plugins/my-plugin/` with:

```
my-plugin/
├── plugin.json    # Manifest (metadata, permissions, hooks, commands)
└── index.ts       # Plugin code
```

### 2. Edit the Plugin

```ts
// index.ts
import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';

const plugin: TardisPlugin = {
  name: 'my-plugin',
  version: '1.0.0',

  async onActivate(api: PluginAPI) {
    api.logger.info('Plugin activated!');
  },

  async onSessionStop(session: Session, api: PluginAPI) {
    await api.notifications.send(`Finished: ${session.taskName}`);
  },

  commands: {
    async hello(args: string[], api: PluginAPI) {
      api.logger.info(`Hello! Args: ${args.join(' ')}`);
    },
  },
};

export default plugin;
```

### 3. Update the Manifest

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "description": "A custom TARDIS plugin",
  "tardisVersion": ">=2.0.0",
  "main": "index.ts",
  "permissions": ["sessions:read", "notifications:send"],
  "hooks": ["session:stop"],
  "commands": [
    { "name": "hello", "description": "Say hello" }
  ],
  "config": {
    "enabled": true
  }
}
```

### 4. Restart the Server

```bash
# The server auto-discovers plugins in ~/.tardis/plugins/
tardis plugin list   # Verify it appears
```

---

## Plugin Manifest Reference (`plugin.json`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique plugin identifier (kebab-case) |
| `version` | string | Yes | Semver version string |
| `displayName` | string | Yes | Human-readable name |
| `description` | string | No | Short description |
| `author` | string | No | Author name/email |
| `license` | string | No | License identifier |
| `tardisVersion` | string | Yes | Required TARDIS version (semver range) |
| `main` | string | Yes | Entry point file (relative to plugin dir) |
| `permissions` | string[] | Yes | Required permissions (see below) |
| `hooks` | string[] | Yes | Events to subscribe to |
| `commands` | object[] | Yes | CLI/Telegram commands |
| `config` | object | No | Default configuration values |
| `dependencies` | object | No | npm dependencies (installed via `bun install`) |

### Permissions

| Permission | Description |
|-----------|-------------|
| `sessions:read` | Read session data (list, get by ID) |
| `sessions:write` | Create and modify sessions |
| `storage:read` | Read from plugin storage |
| `storage:write` | Write to plugin storage |
| `http:external` | Make HTTP requests to external services |
| `notifications:send` | Send notifications via Telegram |
| `tasks:read` | Read Todoist tasks |
| `tasks:write` | Create/complete Todoist tasks |

### Hooks

| Hook | Lifecycle Method | Description |
|------|-----------------|-------------|
| `session:start` | `onSessionStart(session, api)` | Fired when a session starts |
| `session:stop` | `onSessionStop(session, api)` | Fired when a session stops |
| `session:pause` | `onSessionPause(session, api)` | Fired when a session is paused |
| `session:resume` | `onSessionResume(session, api)` | Fired when a session resumes |

---

## Plugin API Reference

The `PluginAPI` object is passed to all lifecycle hooks and commands.

### `api.sessions`

Requires `sessions:read` or `sessions:write` permission.

```ts
api.sessions.getActive(): Promise<Session[]>
api.sessions.getById(id: string): Promise<Session | null>
api.sessions.start(options: { taskName: string }): Promise<Session>
api.sessions.stop(id: string): Promise<Session>
```

### `api.tasks`

Requires `tasks:read` or `tasks:write` permission.

```ts
api.tasks.getAll(): Promise<Task[]>
api.tasks.complete(taskId: string): Promise<void>
api.tasks.create(options: { content: string; description?: string }): Promise<Task>
```

### `api.storage`

Requires `storage:read` or `storage:write` permission. Per-plugin isolated storage.

```ts
api.storage.get<T>(key: string): Promise<T | null>
api.storage.set(key: string, value: unknown): Promise<void>
api.storage.delete(key: string): Promise<void>
api.storage.clear(): Promise<void>
```

### `api.http`

Requires `http:external` permission.

```ts
api.http.get(url: string, options?: RequestInit): Promise<Response>
api.http.post(url: string, body: unknown, options?: RequestInit): Promise<Response>
api.http.put(url: string, body: unknown, options?: RequestInit): Promise<Response>
api.http.delete(url: string, options?: RequestInit): Promise<Response>
```

### `api.notifications`

Requires `notifications:send` permission.

```ts
api.notifications.send(message: string): Promise<void>
```

### `api.config`

No permission required. Reads from manifest `config` with persistent overrides.

```ts
api.config.get(key: string): unknown
api.config.getAll(): Record<string, unknown>
api.config.set(key: string, value: unknown): Promise<void>
```

### `api.logger`

No permission required. Messages are prefixed with `[plugin:<name>]`.

```ts
api.logger.info(message: string, ...args: unknown[]): void
api.logger.warn(message: string, ...args: unknown[]): void
api.logger.error(message: string, ...args: unknown[]): void
api.logger.debug(message: string, ...args: unknown[]): void
```

### `api.events`

No permission required. Scoped to the plugin.

```ts
api.events.on(event: string, handler: (data: unknown) => void | Promise<void>): void
api.events.emit(event: string, data: unknown): Promise<void>
```

---

## CLI Commands

```bash
tardis plugin list                          # List installed plugins
tardis plugin install <git-url>             # Install from git
tardis plugin uninstall <name>              # Remove a plugin
tardis plugin enable <name>                 # Enable a plugin
tardis plugin disable <name>                # Disable a plugin
tardis plugin update <name>                 # Update via git pull
tardis plugin update --all                  # Update all plugins
tardis plugin run <name> <command> [args]   # Run a plugin command
tardis plugin create <name>                 # Scaffold a new plugin
```

## Telegram Commands

```
plugin list                          # List plugins
plugin <name>                        # Show plugin details
plugin <name> <command> [args]       # Run a plugin command
```

---

## Example Plugins

### Pomodoro Timer

Located in `plugins/pomodoro-timer/`. Sends break notifications after a configurable work interval.

- **Hooks:** `session:start` (schedules timer), `session:stop` (cancels timer)
- **Commands:** `start` (begin pomodoro), `config` (set durations), `stats` (view completions)
- **Permissions:** sessions, storage, notifications

### Google Calendar Sync

Located in `plugins/google-calendar-sync/`. Syncs completed sessions to Google Calendar.

- **Hooks:** `session:stop` (auto-sync)
- **Commands:** `setup` (OAuth config), `sync-all` (manual sync), `status` (view state)
- **Permissions:** sessions, storage, http, notifications

---

## Security

- Plugins run in the same process — only install plugins you trust
- Permissions are checked at runtime; undeclared permissions throw errors
- Plugin storage is isolated per-plugin (separate files on disk)
- Plugin errors are caught and logged without crashing the server
- HTTP access requires explicit `http:external` permission

## Debugging

- Plugin logs are prefixed with `[plugin:<name>]` for easy filtering
- Use `api.logger.debug()` for verbose output
- Check `~/.tardis/plugins/<name>/storage/data.json` for stored data
- If a plugin fails to load, the server logs a warning and continues
- Run `tardis plugin list` to check if a plugin is enabled/disabled
