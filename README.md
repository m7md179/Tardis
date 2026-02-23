# TARDIS v2

**T**ime **A**nd **R**esource **D**ocumentation & **I**nsight **S**ystem

A self-hosted, open-source AI assistant framework. The AI is the brain — plugins are its hands. Users interact via Telegram, CLI, or Web UI. The assistant can only act through installed plugins.

## What's different from v1?

v1 was a time tracker with an AI bolted on. v2 is an **AI assistant** where time tracking is just one plugin.

## Architecture

```
User (Telegram / CLI / Web UI)
         │
         ▼
    Skill Router  ← reads plugin summaries, picks relevant plugins
         │
         ▼
    Agent Loop   ← Reason → Act → Observe (with only selected tools)
         │
         ▼
   Plugin Router ← dispatches tool calls to plugins
         │
    ┌────┴─────────────────────────┐
  time-tracker  notes  reminders  todoist  google-calendar  ...
```

## Monorepo Structure

```
tardis/
├── packages/
│   ├── core/       # AI engine, plugin system, memory, events
│   ├── server/     # HTTP server, Telegram bot, Web UI API
│   ├── cli/        # CLI interface
│   ├── shared/     # Types, schemas, utilities
│   └── db/         # Drizzle ORM schema & migrations
├── plugins/        # Plugin directory
│   ├── time-tracker/
│   ├── notes/
│   ├── reminders/
│   ├── todoist/
│   └── google-calendar/
└── templates/
    └── plugin-template/
```

## Getting Started

> Work in progress — see `.claude/tasks/` for current build status.

**Requirements:**
- Bun 1.3.8+
- Ollama (for local LLM) or an OpenAI-compatible API key

```bash
bun install
bun run build
```

## Plugins

Plugins are self-contained TypeScript packages in `plugins/`. Each has:
- `manifest.json` — metadata, permissions, tool definitions, skill summary
- `index.ts` — entry point with `onActivate`, `onDeactivate`, `executeTool`

See `templates/plugin-template/` for a scaffold.

## Tech Stack

- **Runtime:** Bun 1.3.8+
- **Language:** TypeScript 5.7+ (strict)
- **Monorepo:** Turborepo
- **Database:** SQLite via Drizzle ORM
- **HTTP:** Hono
- **Telegram:** Telegraf
- **Validation:** Zod
