# TARDIS Phase 2: Server Architecture Implementation Plan

**Phase:** 2 - Server Architecture & Remote Access  
**Duration:** 4-5 weeks  
**Status:** Planning  
**Version:** 1.0  
**Date:** February 2026

---

## Table of Contents

1. [Phase Overview](#1-phase-overview)
2. [Prerequisites](#2-prerequisites)
3. [Architecture Design](#3-architecture-design)
4. [Sprint Breakdown](#4-sprint-breakdown)
5. [Implementation Details](#5-implementation-details)
6. [Proxmox Deployment](#6-proxmox-deployment)
7. [Tailscale Configuration](#7-tailscale-configuration)
8. [Testing Plan](#8-testing-plan)
9. [Migration Strategy](#9-migration-strategy)
10. [Quality Gates](#10-quality-gates)
11. [Deliverables](#11-deliverables)

---

## 1. Phase Overview

### 1.1 Goals

**Primary Goal:** Transform TARDIS from a local-only CLI tool into a distributed system with a server component running 24/7 on Proxmox, enabling remote access and automation.

**Secondary Goals:**

- Enable remote control via Telegram bot
- Implement background daemon for time window monitoring
- Add auto-rescheduling for unfinished tasks
- Create notification system
- Build foundation for Phase 3 (plugin system)
- Maintain graceful offline mode in CLI

### 1.2 Success Criteria

- [ ] Server running 24/7 on Proxmox LXC container
- [ ] CLI communicates with server over Tailscale VPN
- [ ] Telegram bot responds to all commands
- [ ] Background scheduler monitors time windows
- [ ] Auto-reschedule creates new Todoist tasks
- [ ] Notifications sent via Telegram/Email
- [ ] CLI graceful degradation when offline
- [ ] API response time <100ms (local network)
- [ ] Server uptime >99% over 1 week
- [ ] Zero security vulnerabilities

### 1.3 In Scope

**Server Components:**

- REST API server (Hono.js)
- Authentication system (API Key → JWT)
- Session management service
- Todoist sync engine
- Background scheduler/daemon
- Notification service
- Telegram bot handler

**CLI Enhancements:**

- Server API client
- Offline mode with local fallback
- Server configuration
- Authentication flow

**Infrastructure:**

- Proxmox LXC container
- Tailscale VPN setup
- systemd service configuration
- Backup system

### 1.4 Out of Scope (Phase 3)

- Plugin system
- Web UI
- Multi-user support
- Advanced analytics
- Mobile native apps

### 1.5 Timeline

```
Week 1: Server Foundation + API
Week 2: CLI-Server Integration + Auth
Week 3: Telegram Bot + Notifications
Week 4: Scheduler + Auto-Reschedule
Week 5: Deployment + Testing
```

---

## 2. Prerequisites

### 2.1 Phase 1 Completion

**Required:**

- [ ] Phase 1 fully complete and tested
- [ ] CLI working locally with all commands
- [ ] Todoist integration functional
- [ ] Migration from Go tested
- [ ] Documentation complete

### 2.2 Infrastructure Requirements

**Proxmox Environment:**

- Proxmox VE 8.0+ installed and accessible
- At least 512MB RAM available
- 10GB disk space available
- Network connectivity

**Tailscale:**

- Tailscale account created
- Tailscale installed on Mac
- Understanding of Tailscale basics

**Development:**

- Phase 1 codebase available
- Bun 1.0+ installed
- Access to Proxmox web UI
- SSH access to Proxmox host

### 2.3 Account Requirements

- Telegram account (for bot creation)
- BotFather access (create Telegram bot)
- Todoist API token (from Phase 1)
- Optional: SMTP credentials for email

---

## 3. Architecture Design

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   TARDIS Ecosystem (Phase 2)                 │
└─────────────────────────────────────────────────────────────┘

External Services:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Todoist    │  │   Telegram   │  │   Email      │
│     API      │  │   Bot API    │  │   SMTP       │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                    ┌─────▼─────┐
                    │  Internet │
                    └─────┬─────┘
                          │
                 ┌────────▼────────┐
                 │   Tailscale     │
                 │   VPN Mesh      │
                 └────────┬────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼────────┐ ┌──────▼──────┐ ┌───────▼────────┐
│  TARDIS Server │ │ TARDIS CLI  │ │ Telegram Bot   │
│  (Proxmox LXC) │ │  (Mac)      │ │  (Your Phone)  │
└────────────────┘ └─────────────┘ └────────────────┘
```

### 3.2 Server Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TARDIS Server Process                     │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ HTTP Server (Hono.js) - Port 3000                      │ │
│  │  ├─ API Routes                                         │ │
│  │  ├─ Authentication Middleware                          │ │
│  │  ├─ Rate Limiting                                      │ │
│  │  └─ Error Handling                                     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │  Core       │  │  Todoist    │  │  Telegram       │    │
│  │  Services   │  │  Sync       │  │  Bot            │    │
│  │             │  │  Engine     │  │  Handler        │    │
│  │ • Sessions  │  │             │  │                 │    │
│  │ • Auth      │  │ • Polling   │  │ • Commands      │    │
│  │ • Storage   │  │ • Caching   │  │ • Keyboards     │    │
│  └─────────────┘  └─────────────┘  └─────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Background Scheduler (Cron-like)                     │   │
│  │  • Time Window Monitor (every 1 min)                 │   │
│  │  • Todoist Sync (every 5 min)                        │   │
│  │  • Auto-Reschedule (daily at 11:59 PM)               │   │
│  │  • Notification Queue Processor                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  Data: /var/lib/tardis/                                      │
│  ├── config.json                                             │
│  ├── users/default/                                          │
│  │   ├── active_sessions/                                   │
│  │   ├── sessions/                                          │
│  │   └── todoist_cache.json                                │
│  └── logs/                                                   │
└───────────────────────────────────────────────────────────────┘
```

### 3.3 Communication Flow

#### CLI → Server (REST API)

```
1. User: tardis start "Task"
2. CLI: POST http://100.x.x.x:3000/api/sessions/start
   Headers: { Authorization: Bearer <jwt> }
   Body: { taskName: "Task" }
3. Server: Creates session, returns response
4. CLI: Displays confirmation
```

#### Telegram Bot → Server

```
1. User: /start Task
2. Telegram → Webhook → Server: POST /api/webhooks/telegram
3. Server: Parses command, calls session manager
4. Server → Telegram API: Send confirmation message
```

#### Scheduler → Notification

```
1. Scheduler: Check time (every minute)
2. Scheduler: Find tasks entering time window
3. Notification Service: Prepare message
4. Telegram/Email: Send notification
```

### 3.4 Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   Initial Setup (One-time)                   │
└─────────────────────────────────────────────────────────────┘

1. User runs: tardis config --server-url http://100.x.x.x:3000
2. CLI stores server URL in local config

3. User runs: tardis setup (or first command)
4. Server generates API key
5. User copies API key to CLI config

┌─────────────────────────────────────────────────────────────┐
│                   Regular Authentication                     │
└─────────────────────────────────────────────────────────────┘

1. CLI sends request with API key
   POST /api/auth/init
   Body: { apiKey: "..." }

2. Server validates API key, generates JWT
   Response: { token: "...", expiresAt: "..." }

3. CLI stores JWT in memory + disk cache

4. CLI uses JWT for subsequent requests
   Headers: { Authorization: "Bearer <jwt>" }

5. JWT expires after 30 days
   CLI automatically refreshes: POST /api/auth/refresh
```

---

## 4. Sprint Breakdown

### Sprint 1: Server Foundation (Week 1)

**Goal:** Build core server infrastructure and REST API

**Tasks:**

1. Create `packages/server` package
2. Set up Hono.js web server
3. Implement authentication (API Key + JWT)
4. Create session management API routes
5. Add rate limiting middleware
6. Implement error handling
7. Write API tests

**Deliverables:**

- [ ] Server runs on development machine
- [ ] All session endpoints working
- [ ] Authentication functional
- [ ] API documentation (OpenAPI spec)
- [ ] 70%+ test coverage for API

**Estimated Time:** 5-7 days

---

### Sprint 2: CLI-Server Integration (Week 2)

**Goal:** Connect CLI to server with offline fallback

**Tasks:**

1. Create API client in CLI
2. Implement authentication flow
3. Add offline detection
4. Create graceful degradation
5. Update all CLI commands to use server
6. Add config commands for server URL
7. Test CLI-server communication

**Deliverables:**

- [ ] CLI connects to server
- [ ] All commands work via server
- [ ] Offline mode functional
- [ ] Server config commands working
- [ ] Integration tests passing

**Estimated Time:** 5-7 days

---

### Sprint 3: Telegram Bot (Week 3)

**Goal:** Implement Telegram bot for remote control

**Tasks:**

1. Set up Telegram bot with BotFather
2. Create bot handler in server
3. Implement all bot commands
4. Add interactive keyboards
5. Create rich message formatting
6. Add task disambiguation picker
7. Test all bot interactions

**Deliverables:**

- [ ] Telegram bot responds to all commands
- [ ] Interactive keyboards work
- [ ] Messages beautifully formatted
- [ ] Task picker functional
- [ ] Bot help command complete

**Estimated Time:** 5-7 days

---

### Sprint 4: Scheduler & Notifications (Week 4)

**Goal:** Background automation and notifications

**Tasks:**

1. Create scheduler daemon
2. Implement time window monitoring
3. Build notification service
4. Add Telegram notifications
5. Add email notifications
6. Implement auto-reschedule logic
7. Create notification queue system
8. Add notification testing

**Deliverables:**

- [ ] Time window notifications working
- [ ] Auto-reschedule functional
- [ ] Telegram notifications sent
- [ ] Email notifications sent (optional)
- [ ] Notification queue reliable

**Estimated Time:** 5-7 days

---

### Sprint 5: Deployment & Polish (Week 5)

**Goal:** Deploy to Proxmox and production testing

**Tasks:**

1. Create Proxmox LXC container
2. Set up Tailscale on container
3. Configure systemd service
4. Set up automated backups
5. Create deployment documentation
6. Performance testing
7. Security audit
8. End-to-end testing
9. Create rollback procedure

**Deliverables:**

- [ ] Server running on Proxmox
- [ ] Accessible via Tailscale
- [ ] Auto-starts on boot
- [ ] Backups configured
- [ ] Monitoring set up
- [ ] Documentation complete

**Estimated Time:** 5-7 days

---

## 5. Implementation Details

### 5.1 Package: `server`

**Directory Structure:**

```
packages/server/
├── src/
│   ├── index.ts                    # Entry point
│   ├── config.ts                   # Server configuration
│   │
│   ├── api/
│   │   ├── server.ts               # Hono server setup
│   │   ├── routes/
│   │   │   ├── index.ts
│   │   │   ├── auth.ts
│   │   │   ├── sessions.ts
│   │   │   ├── tasks.ts
│   │   │   ├── sync.ts
│   │   │   ├── config.ts
│   │   │   ├── webhooks.ts
│   │   │   └── health.ts
│   │   └── middleware/
│   │       ├── auth.ts
│   │       ├── ratelimit.ts
│   │       ├── error.ts
│   │       └── logger.ts
│   │
│   ├── core/
│   │   ├── session-manager.ts
│   │   ├── task-matcher.ts
│   │   ├── scheduler.ts
│   │   ├── time-parser.ts
│   │   └── rescheduler.ts
│   │
│   ├── integrations/
│   │   ├── todoist/
│   │   │   ├── client.ts
│   │   │   ├── sync.ts
│   │   │   └── parser.ts
│   │   ├── telegram/
│   │   │   ├── bot.ts
│   │   │   ├── commands.ts
│   │   │   ├── keyboards.ts
│   │   │   └── handlers.ts
│   │   └── notifications/
│   │       ├── service.ts
│   │       ├── telegram.ts
│   │       ├── email.ts
│   │       └── templates.ts
│   │
│   ├── storage/
│   │   ├── json-store.ts
│   │   ├── session-store.ts
│   │   ├── task-cache.ts
│   │   └── config-store.ts
│   │
│   └── utils/
│       ├── auth.ts
│       ├── crypto.ts
│       └── constants.ts
│
├── scripts/
│   ├── generate-api-key.ts
│   └── deploy.sh
│
├── Dockerfile
├── .env.example
├── ecosystem.config.js          # PM2 config
├── package.json
└── tsconfig.json
```

### 5.2 Core Server Implementation

#### `src/index.ts`

```typescript
import { serve } from 'bun';
import { createServer } from './api/server';
import { startScheduler } from './core/scheduler';
import { startTelegramBot } from './integrations/telegram/bot';
import { loadConfig } from './config';
import { logger } from '@tardis/shared/utils/logger';

async function main() {
  // Load configuration
  const config = await loadConfig();

  logger.info('Starting TARDIS Server v2.0.0');

  // Create HTTP server
  const app = createServer();

  // Start server
  const server = serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: config.server.host,
  });

  logger.info(`Server listening on ${config.server.host}:${config.server.port}`);

  // Start background scheduler
  if (config.scheduler.enabled) {
    logger.info('Starting background scheduler...');
    await startScheduler(config);
  }

  // Start Telegram bot
  if (config.notifications.channels.telegram?.enabled) {
    logger.info('Starting Telegram bot...');
    await startTelegramBot(config);
  }

  logger.info('TARDIS Server ready!');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down gracefully...');
    server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
```

#### `src/config.ts`

```typescript
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

const ServerConfigSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().int().positive().default(3000),
    dataDir: z.string().default('/var/lib/tardis'),
  }),
  auth: z.object({
    jwtSecret: z.string().min(32),
    jwtExpiry: z.string().default('30d'),
    apiKeyLength: z.number().int().default(32),
  }),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().int().default(60000), // 1 minute
    maxRequests: z.number().int().default(100),
  }),
  scheduler: z.object({
    enabled: z.boolean().default(true),
    todoistSyncInterval: z.number().int().default(300), // 5 minutes (seconds)
    timeWindowCheckInterval: z.number().int().default(60), // 1 minute (seconds)
  }),
  todoist: z.object({
    apiToken: z.string(),
  }),
  notifications: z.object({
    enabled: z.boolean().default(true),
    channels: z.object({
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          botToken: z.string(),
          chatId: z.string(),
        })
        .optional(),
      email: z
        .object({
          enabled: z.boolean().default(false),
          smtp: z.object({
            host: z.string(),
            port: z.number().int().positive(),
            secure: z.boolean(),
            auth: z.object({
              user: z.string(),
              pass: z.string(),
            }),
          }),
          from: z.string().email(),
          to: z.string().email(),
        })
        .optional(),
    }),
  }),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export async function loadConfig(): Promise<ServerConfig> {
  const configPath = process.env.TARDIS_CONFIG || '/var/lib/tardis/config.json';

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const configFile = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configFile);

  return ServerConfigSchema.parse(config);
}
```

#### `src/api/server.ts`

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/ratelimit';
import { errorMiddleware } from './middleware/error';

import authRoutes from './routes/auth';
import sessionRoutes from './routes/sessions';
import taskRoutes from './routes/tasks';
import syncRoutes from './routes/sync';
import configRoutes from './routes/config';
import webhookRoutes from './routes/webhooks';
import healthRoutes from './routes/health';

export function createServer() {
  const app = new Hono();

  // Global middleware
  app.use('*', honoLogger());
  app.use(
    '*',
    cors({
      origin: '*', // Only Tailscale IPs in production
      credentials: true,
    })
  );
  app.use('*', errorMiddleware);

  // Public routes (no auth required)
  app.route('/api/auth', authRoutes);
  app.route('/api/health', healthRoutes);
  app.route('/api/webhooks', webhookRoutes);

  // Protected routes (auth required)
  app.use('/api/*', authMiddleware);
  app.use('/api/*', rateLimitMiddleware);

  app.route('/api/sessions', sessionRoutes);
  app.route('/api/tasks', taskRoutes);
  app.route('/api/sync', syncRoutes);
  app.route('/api/config', configRoutes);

  return app;
}
```

#### `src/api/middleware/auth.ts`

```typescript
import { Context, Next } from 'hono';
import { verify } from 'jsonwebtoken';
import { loadConfig } from '../../config';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const config = await loadConfig();

  try {
    const decoded = verify(token, config.auth.jwtSecret);
    c.set('user', decoded);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid token' }, 401);
  }
}
```

#### `src/api/middleware/ratelimit.ts`

```typescript
import { Context, Next } from 'hono';

const requests = new Map<string, { count: number; resetAt: number }>();

export async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();

  const record = requests.get(ip);

  if (!record || now > record.resetAt) {
    // Reset window
    requests.set(ip, {
      count: 1,
      resetAt: now + 60000, // 1 minute
    });
    await next();
    return;
  }

  if (record.count >= 100) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  record.count++;
  await next();
}
```

#### `src/api/routes/auth.ts`

```typescript
import { Hono } from 'hono';
import { sign } from 'jsonwebtoken';
import { loadConfig } from '../../config';
import { validateApiKey } from '../../utils/auth';

const auth = new Hono();

auth.post('/init', async (c) => {
  const { apiKey } = await c.req.json();

  if (!apiKey) {
    return c.json({ error: 'API key required' }, 400);
  }

  const config = await loadConfig();

  // Validate API key
  const isValid = await validateApiKey(apiKey);
  if (!isValid) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  // Generate JWT
  const token = sign({ userId: 'default' }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiry,
  });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return c.json({
    token,
    expiresAt,
  });
});

auth.post('/refresh', async (c) => {
  const user = c.get('user');
  const config = await loadConfig();

  // Generate new token
  const token = sign({ userId: user.userId }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiry,
  });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return c.json({
    token,
    expiresAt,
  });
});

export default auth;
```

#### `src/api/routes/sessions.ts`

```typescript
import { Hono } from 'hono';
import { SessionManager } from '../../core/session-manager';
import { v4 as uuidv4 } from 'uuid';

const sessions = new Hono();
const manager = new SessionManager();

sessions.get('/active', async (c) => {
  const activeSessions = await manager.getActiveSessions();
  return c.json(activeSessions);
});

sessions.get('/status', async (c) => {
  const taskName = c.req.query('taskName');

  const session = taskName
    ? await manager.getSessionByTask(taskName)
    : await manager.getMostRecentSession();

  if (!session) {
    return c.json({ error: 'No active session found' }, 404);
  }

  return c.json(session);
});

sessions.post('/start', async (c) => {
  const { taskName, taskId } = await c.req.json();

  if (!taskName) {
    return c.json({ error: 'Task name required' }, 400);
  }

  // Check for duplicates
  const existing = await manager.getSessionByTask(taskName);
  if (existing) {
    return c.json(
      {
        error: `Task '${taskName}' already active`,
        session: existing,
      },
      409
    );
  }

  const session = await manager.startSession({
    id: uuidv4(),
    taskName,
    taskId,
  });

  return c.json(session, 201);
});

sessions.post('/stop', async (c) => {
  const { sessionId, taskName, noSync } = await c.req.json();

  const session = sessionId
    ? await manager.getSessionById(sessionId)
    : taskName
      ? await manager.getSessionByTask(taskName)
      : await manager.getMostRecentSession();

  if (!session) {
    return c.json({ error: 'No active session found' }, 404);
  }

  const stopped = await manager.stopSession(session.id, { sync: !noSync });

  return c.json(stopped);
});

sessions.post('/pause', async (c) => {
  const { sessionId, taskName } = await c.req.json();

  const session = sessionId
    ? await manager.getSessionById(sessionId)
    : taskName
      ? await manager.getSessionByTask(taskName)
      : await manager.getMostRecentSession();

  if (!session) {
    return c.json({ error: 'No active session found' }, 404);
  }

  const paused = await manager.pauseSession(session.id);

  return c.json(paused);
});

sessions.post('/resume', async (c) => {
  const { sessionId, taskName } = await c.req.json();

  const session = sessionId
    ? await manager.getSessionById(sessionId)
    : taskName
      ? await manager.getSessionByTask(taskName)
      : await manager.getMostRecentSession();

  if (!session) {
    return c.json({ error: 'No paused session found' }, 404);
  }

  const resumed = await manager.resumeSession(session.id);

  return c.json(resumed);
});

sessions.get('/history', async (c) => {
  const date = c.req.query('date');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  const history = await manager.getHistory({ date, limit, offset });

  return c.json(history);
});

sessions.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');

  await manager.deleteSession(sessionId);

  return c.json({ deleted: true });
});

sessions.delete('/', async (c) => {
  const { confirm } = await c.req.json();

  if (confirm !== 'yes') {
    return c.json({ error: 'Confirmation required' }, 400);
  }

  const count = await manager.wipeAllSessions();

  return c.json({ deleted: count });
});

export default sessions;
```

### 5.3 Telegram Bot Implementation

#### `src/integrations/telegram/bot.ts`

```typescript
import { Telegraf } from 'telegraf';
import { ServerConfig } from '../../config';
import { registerCommands } from './commands';
import { logger } from '@tardis/shared/utils/logger';

export async function startTelegramBot(config: ServerConfig) {
  const telegram = config.notifications.channels.telegram;

  if (!telegram?.enabled || !telegram.botToken) {
    logger.warn('Telegram bot not configured');
    return;
  }

  const bot = new Telegraf(telegram.botToken);

  // Register all commands
  registerCommands(bot, config);

  // Error handling
  bot.catch((err, ctx) => {
    logger.error('Telegram bot error:', err);
    ctx.reply('An error occurred. Please try again.');
  });

  // Start bot
  await bot.launch();
  logger.info('Telegram bot started');

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
```

#### `src/integrations/telegram/commands.ts`

```typescript
import { Telegraf, Context } from 'telegraf';
import { ServerConfig } from '../../config';
import { SessionManager } from '../../core/session-manager';
import { TaskMatcher } from '../../core/task-matcher';
import { formatDurationHuman } from '@tardis/shared/utils/time';
import { createTaskKeyboard } from './keyboards';

const manager = new SessionManager();
const matcher = new TaskMatcher();

export function registerCommands(bot: Telegraf, config: ServerConfig) {
  // /start command
  bot.command('start', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1).join(' ');

    if (!args) {
      return ctx.reply('Usage: /start <task name>');
    }

    try {
      // Check for duplicates
      const existing = await manager.getSessionByTask(args);
      if (existing) {
        return ctx.reply(
          `⚠️ Task '${existing.taskName}' is already active.\n` +
            `Started: ${new Date(existing.startTime).toLocaleString()}\n\n` +
            `Use /stop to end it first.`
        );
      }

      // Try to match with Todoist
      const matches = await matcher.matchTask(args);

      if (matches.length === 0) {
        // No match, start anyway
        const session = await manager.startSession({
          id: crypto.randomUUID(),
          taskName: args,
        });

        return ctx.reply(
          `✅ Started tracking: *${session.taskName}*\n` +
            `⏰ Started at: ${new Date(session.startTime).toLocaleTimeString()}\n` +
            `📊 Duration: 0h 0m`,
          { parse_mode: 'Markdown' }
        );
      }

      if (matches.length === 1) {
        // Single match
        const task = matches[0];
        const session = await manager.startSession({
          id: crypto.randomUUID(),
          taskName: task.content,
          taskId: task.id,
          timeWindow: task.timeWindow,
        });

        let reply = `✅ Started tracking: *${session.taskName}*\n`;
        reply += `⏰ Started at: ${new Date(session.startTime).toLocaleTimeString()}\n`;
        if (session.timeWindow) {
          reply += `📅 Time window: ${session.timeWindow.start} - ${session.timeWindow.end}\n`;
        }
        reply += `📊 Duration: 0h 0m`;

        return ctx.reply(reply, { parse_mode: 'Markdown' });
      }

      // Multiple matches - show keyboard
      return ctx.reply('Multiple tasks found. Select one:', createTaskKeyboard(matches));
    } catch (error) {
      logger.error('Error in /start command:', error);
      return ctx.reply('❌ Failed to start session. Please try again.');
    }
  });

  // /stop command
  bot.command('stop', async (ctx) => {
    try {
      const session = await manager.getMostRecentSession();

      if (!session) {
        return ctx.reply('❌ No active sessions found.');
      }

      const activeSessions = await manager.getActiveSessions();

      if (activeSessions.length > 1) {
        // Multiple active - show keyboard
        return ctx.reply(
          'Multiple active sessions. Select one to stop:',
          createTaskKeyboard(
            activeSessions.map((s) => ({
              id: s.id,
              content: s.taskName,
              description: `Started: ${new Date(s.startTime).toLocaleTimeString()}`,
            }))
          )
        );
      }

      // Stop the session
      const stopped = await manager.stopSession(session.id, { sync: true });

      let reply = `✅ Stopped tracking: *${stopped.taskName}*\n`;
      reply += `📊 Duration: ${formatDurationHuman(stopped.duration)}\n`;
      reply += `🕐 Ended at: ${new Date(stopped.endTime!).toLocaleTimeString()}`;

      if (stopped.todoistSynced) {
        reply += '\n✓ Marked complete in Todoist';
      }

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /stop command:', error);
      return ctx.reply('❌ Failed to stop session. Please try again.');
    }
  });

  // /status command
  bot.command('status', async (ctx) => {
    try {
      const session = await manager.getMostRecentSession();

      if (!session) {
        return ctx.reply('No active sessions.');
      }

      const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);

      let reply = `📊 *Status: ${session.status}*\n`;
      reply += `📝 Task: ${session.taskName}\n`;
      reply += `⏰ Started: ${new Date(session.startTime).toLocaleTimeString()}\n`;
      reply += `⌛ Duration: ${formatDurationHuman(duration)}`;

      if (session.timeWindow) {
        reply += `\n📅 Window: ${session.timeWindow.start} - ${session.timeWindow.end}`;
      }

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /status command:', error);
      return ctx.reply('❌ Failed to get status. Please try again.');
    }
  });

  // /list command
  bot.command('list', async (ctx) => {
    try {
      const sessions = await manager.getActiveSessions();

      if (sessions.length === 0) {
        return ctx.reply('No active sessions.');
      }

      let reply = `*Active Sessions (${sessions.length}):*\n\n`;

      for (const session of sessions) {
        const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
        reply += `📝 ${session.taskName}\n`;
        reply += `   Status: ${session.status}\n`;
        reply += `   Started: ${new Date(session.startTime).toLocaleTimeString()}\n`;
        reply += `   Duration: ${formatDurationHuman(duration)}\n\n`;
      }

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /list command:', error);
      return ctx.reply('❌ Failed to list sessions. Please try again.');
    }
  });

  // /pause command
  bot.command('pause', async (ctx) => {
    try {
      const session = await manager.getMostRecentSession();

      if (!session) {
        return ctx.reply('❌ No active sessions found.');
      }

      if (session.status !== 'ACTIVE') {
        return ctx.reply(`❌ Session '${session.taskName}' is not active.`);
      }

      const paused = await manager.pauseSession(session.id);

      return ctx.reply(
        `⏸️ Paused: *${paused.taskName}*\n` +
          `Duration before pause: ${formatDurationHuman(paused.duration)}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error in /pause command:', error);
      return ctx.reply('❌ Failed to pause session. Please try again.');
    }
  });

  // /resume command
  bot.command('resume', async (ctx) => {
    try {
      const sessions = await manager.getActiveSessions();
      const paused = sessions.filter((s) => s.status === 'PAUSED');

      if (paused.length === 0) {
        return ctx.reply('❌ No paused sessions found.');
      }

      const session = paused[0];
      const resumed = await manager.resumeSession(session.id);

      return ctx.reply(
        `▶️ Resumed: *${resumed.taskName}*\n` +
          `Current duration: ${formatDurationHuman(resumed.duration)}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error in /resume command:', error);
      return ctx.reply('❌ Failed to resume session. Please try again.');
    }
  });

  // /tasks command
  bot.command('tasks', async (ctx) => {
    try {
      const tasks = await matcher.getTodaysTasks();

      if (tasks.length === 0) {
        return ctx.reply('No tasks for today.');
      }

      let reply = `*Today's Tasks (${tasks.length}):*\n\n`;

      for (const task of tasks) {
        reply += `📝 ${task.content}\n`;
        if (task.timeWindow) {
          reply += `   ⏰ ${task.timeWindow.start} - ${task.timeWindow.end}\n`;
        }
        if (task.priority > 1) {
          reply += `   🔥 Priority: ${task.priority}\n`;
        }
        reply += '\n';
      }

      return ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error in /tasks command:', error);
      return ctx.reply('❌ Failed to fetch tasks. Please try again.');
    }
  });

  // /help command
  bot.help((ctx) => {
    return ctx.reply(
      '*TARDIS Bot Commands:*\n\n' +
        '/start <task> - Start tracking a task\n' +
        '/stop - Stop current task\n' +
        '/pause - Pause current task\n' +
        '/resume - Resume paused task\n' +
        '/status - Show current status\n' +
        '/list - List all active sessions\n' +
        "/tasks - Show today's tasks from Todoist\n" +
        '/help - Show this help message',
      { parse_mode: 'Markdown' }
    );
  });
}
```

#### `src/integrations/telegram/keyboards.ts`

```typescript
import { Markup } from 'telegraf';

export function createTaskKeyboard(tasks: any[]) {
  const buttons = tasks.map((task, index) => {
    let label = `${index + 1}. ${task.content}`;
    if (task.timeWindow) {
      label += ` [${task.timeWindow.start}-${task.timeWindow.end}]`;
    }
    return [Markup.button.callback(label, `select_task_${task.id}`)];
  });

  return Markup.inlineKeyboard(buttons);
}
```

### 5.4 Scheduler Implementation

#### `src/core/scheduler.ts`

```typescript
import { ServerConfig } from '../config';
import { TodoistSync } from '../integrations/todoist/sync';
import { TimeWindowMonitor } from './time-window-monitor';
import { AutoRescheduler } from './rescheduler';
import { logger } from '@tardis/shared/utils/logger';

export async function startScheduler(config: ServerConfig) {
  const todoistSync = new TodoistSync(config);
  const timeWindowMonitor = new TimeWindowMonitor(config);
  const autoRescheduler = new AutoRescheduler(config);

  // Todoist sync (every 5 minutes)
  const syncInterval = setInterval(async () => {
    try {
      await todoistSync.sync();
      logger.info('Todoist sync completed');
    } catch (error) {
      logger.error('Todoist sync failed:', error);
    }
  }, config.scheduler.todoistSyncInterval * 1000);

  // Time window monitoring (every 1 minute)
  const monitorInterval = setInterval(async () => {
    try {
      await timeWindowMonitor.check();
    } catch (error) {
      logger.error('Time window check failed:', error);
    }
  }, config.scheduler.timeWindowCheckInterval * 1000);

  // Auto-reschedule (daily at 11:59 PM)
  const scheduleDaily = () => {
    const now = new Date();
    const tonight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0, 0);

    if (tonight < now) {
      // If it's already past 11:59 PM, schedule for tomorrow
      tonight.setDate(tonight.getDate() + 1);
    }

    const timeUntil = tonight.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        await autoRescheduler.rescheduleUnfinished();
        logger.info('Auto-reschedule completed');
      } catch (error) {
        logger.error('Auto-reschedule failed:', error);
      }

      // Schedule next day
      scheduleDaily();
    }, timeUntil);
  };

  scheduleDaily();

  logger.info('Scheduler started');

  // Cleanup on shutdown
  process.on('SIGTERM', () => {
    clearInterval(syncInterval);
    clearInterval(monitorInterval);
  });
}
```

#### `src/core/time-window-monitor.ts`

```typescript
import { ServerConfig } from '../config';
import { TaskCache } from '../storage/task-cache';
import { SessionManager } from './session-manager';
import { NotificationService } from '../integrations/notifications/service';
import { logger } from '@tardis/shared/utils/logger';
import { format, parseISO, differenceInMinutes } from 'date-fns';

export class TimeWindowMonitor {
  private taskCache: TaskCache;
  private sessionManager: SessionManager;
  private notificationService: NotificationService;
  private notifiedTasks: Set<string> = new Set();

  constructor(private config: ServerConfig) {
    this.taskCache = new TaskCache();
    this.sessionManager = new SessionManager();
    this.notificationService = new NotificationService(config);
  }

  async check() {
    const now = new Date();
    const currentTime = format(now, 'HH:mm');
    const currentDate = format(now, 'yyyy-MM-dd');

    // Get tasks with time windows for today
    const tasks = await this.taskCache.getTasksForDate(currentDate);

    for (const task of tasks) {
      if (!task.timeWindow) continue;

      const { start, end } = task.timeWindow;

      // Check if time window is starting soon (5 minutes)
      const startTime = parseISO(`${currentDate}T${start}:00`);
      const minutesUntilStart = differenceInMinutes(startTime, now);

      if (minutesUntilStart === 5 && !this.notifiedTasks.has(`start_${task.id}`)) {
        // Check if task is already active
        const activeSession = await this.sessionManager.getSessionByTask(task.content);

        if (!activeSession) {
          await this.notificationService.sendTimeWindowStarting(task);
          this.notifiedTasks.add(`start_${task.id}`);
          logger.info(`Sent time window starting notification for: ${task.content}`);
        }
      }

      // Check if time window is ending soon (5 minutes)
      const endTime = parseISO(`${currentDate}T${end}:00`);
      const minutesUntilEnd = differenceInMinutes(endTime, now);

      if (minutesUntilEnd === 5 && !this.notifiedTasks.has(`end_${task.id}`)) {
        const activeSession = await this.sessionManager.getSessionByTask(task.content);

        if (activeSession && activeSession.status === 'ACTIVE') {
          await this.notificationService.sendTimeWindowEnding(task);
          this.notifiedTasks.add(`end_${task.id}`);
          logger.info(`Sent time window ending notification for: ${task.content}`);
        }
      }

      // Check if working past time window
      if (currentTime > end && !this.notifiedTasks.has(`overdue_${task.id}`)) {
        const activeSession = await this.sessionManager.getSessionByTask(task.content);

        if (activeSession && activeSession.status === 'ACTIVE') {
          const overage = differenceInMinutes(now, endTime);
          await this.notificationService.sendTaskOverdue(task, overage);
          this.notifiedTasks.add(`overdue_${task.id}`);
          logger.info(`Sent task overdue notification for: ${task.content}`);
        }
      }
    }

    // Clean up old notifications (older than today)
    this.cleanupNotifications(currentDate);
  }

  private cleanupNotifications(currentDate: string) {
    const toRemove: string[] = [];

    for (const key of this.notifiedTasks) {
      // Notifications are valid only for today
      // Reset at midnight
      if (!key.includes(currentDate)) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.notifiedTasks.delete(key);
    }
  }
}
```

#### `src/core/rescheduler.ts`

```typescript
import { ServerConfig } from '../config';
import { SessionManager } from './session-manager';
import { TaskCache } from '../storage/task-cache';
import { TodoistClient } from '../integrations/todoist/client';
import { NotificationService } from '../integrations/notifications/service';
import { logger } from '@tardis/shared/utils/logger';
import { format, addDays } from 'date-fns';

export class AutoRescheduler {
  private sessionManager: SessionManager;
  private taskCache: TaskCache;
  private todoistClient: TodoistClient;
  private notificationService: NotificationService;

  constructor(private config: ServerConfig) {
    this.sessionManager = new SessionManager();
    this.taskCache = new TaskCache();
    this.todoistClient = new TodoistClient(config);
    this.notificationService = new NotificationService(config);
  }

  async rescheduleUnfinished() {
    const today = format(new Date(), 'yyyy-MM-dd');
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

    // Get tasks with time windows for today
    const todaysTasks = await this.taskCache.getTasksForDate(today);

    const unfinished: any[] = [];

    for (const task of todaysTasks) {
      if (!task.timeWindow) continue;

      // Check if task was completed
      const sessions = await this.sessionManager.getSessionsByTaskId(task.id);
      const completed = sessions.some((s) => s.status === 'COMPLETED');

      if (!completed) {
        unfinished.push(task);
      }
    }

    logger.info(`Found ${unfinished.length} unfinished tasks to reschedule`);

    // Reschedule each unfinished task
    for (const task of unfinished) {
      try {
        // Create new task in Todoist for tomorrow
        const description = `${task.description}\n\n[${task.timeWindow.start}-${task.timeWindow.end}]\n(Rescheduled from ${today})`;

        await this.todoistClient.createTask(task.content, description);

        // Mark original as complete
        await this.todoistClient.completeTask(task.id);

        logger.info(`Rescheduled: ${task.content} to ${tomorrow}`);
      } catch (error) {
        logger.error(`Failed to reschedule task ${task.content}:`, error);
      }
    }

    // Send summary notification
    if (unfinished.length > 0) {
      await this.notificationService.sendRescheduleSummary(unfinished, tomorrow);
    }
  }
}
```

### 5.5 Notification Service

#### `src/integrations/notifications/service.ts`

```typescript
import { ServerConfig } from '../../config';
import { TelegramNotifier } from './telegram';
import { EmailNotifier } from './email';
import { logger } from '@tardis/shared/utils/logger';

export class NotificationService {
  private telegram?: TelegramNotifier;
  private email?: EmailNotifier;

  constructor(private config: ServerConfig) {
    if (config.notifications.channels.telegram?.enabled) {
      this.telegram = new TelegramNotifier(config);
    }

    if (config.notifications.channels.email?.enabled) {
      this.email = new EmailNotifier(config);
    }
  }

  async sendTimeWindowStarting(task: any) {
    const message = this.formatTimeWindowStarting(task);
    await this.send(message);
  }

  async sendTimeWindowEnding(task: any) {
    const message = this.formatTimeWindowEnding(task);
    await this.send(message);
  }

  async sendTaskOverdue(task: any, minutesOver: number) {
    const message = this.formatTaskOverdue(task, minutesOver);
    await this.send(message);
  }

  async sendRescheduleSummary(tasks: any[], date: string) {
    const message = this.formatRescheduleSummary(tasks, date);
    await this.send(message);
  }

  private async send(message: string) {
    const promises: Promise<void>[] = [];

    if (this.telegram) {
      promises.push(this.telegram.send(message));
    }

    if (this.email) {
      promises.push(this.email.send('TARDIS Notification', message));
    }

    try {
      await Promise.all(promises);
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  private formatTimeWindowStarting(task: any): string {
    const { start, end } = task.timeWindow;
    const duration = this.calculateDuration(start, end);

    return (
      `🕐 Time to start: "${task.content}"\n` +
      `⏰ Scheduled: ${start} - ${end} (${duration})\n\n` +
      `Start tracking: tardis start "${task.content}"`
    );
  }

  private formatTimeWindowEnding(task: any): string {
    const { end } = task.timeWindow;

    return (
      `⏰ Time window ending: "${task.content}"\n` +
      `📊 Scheduled end: ${end}\n\n` +
      `Don't forget to stop: tardis stop`
    );
  }

  private formatTaskOverdue(task: any, minutesOver: number): string {
    const { end } = task.timeWindow;

    return (
      `⚠️ Still working on: "${task.content}"\n` +
      `⏰ Scheduled end was: ${end} (${minutesOver} minutes ago)\n` +
      `📍 Consider wrapping up soon.`
    );
  }

  private formatRescheduleSummary(tasks: any[], date: string): string {
    let message = `📅 Rescheduled ${tasks.length} task(s) to ${date}:\n\n`;

    for (const task of tasks) {
      message += `• ${task.content}`;
      if (task.timeWindow) {
        message += ` [${task.timeWindow.start}-${task.timeWindow.end}]`;
      }
      message += '\n';
    }

    return message;
  }

  private calculateDuration(start: string, end: string): string {
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${minutes}m`;
    }
  }
}
```

#### `src/integrations/notifications/telegram.ts`

```typescript
import { ServerConfig } from '../../config';
import { logger } from '@tardis/shared/utils/logger';

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;

  constructor(config: ServerConfig) {
    const telegram = config.notifications.channels.telegram;

    if (!telegram?.botToken || !telegram.chatId) {
      throw new Error('Telegram credentials not configured');
    }

    this.botToken = telegram.botToken;
    this.chatId = telegram.chatId;
  }

  async send(message: string) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.statusText}`);
      }

      logger.info('Telegram notification sent');
    } catch (error) {
      logger.error('Failed to send Telegram notification:', error);
      throw error;
    }
  }
}
```

### 5.6 CLI Server Integration

#### `packages/cli/src/api/client.ts`

```typescript
import { ConfigStore } from '../storage/config-store';
import { Session } from '@tardis/shared/types/session';

export class ServerClient {
  private baseUrl: string;
  private token?: string;

  constructor() {
    const configStore = new ConfigStore();
    const config = configStore.load();

    if (!config.server?.url) {
      throw new Error('Server URL not configured. Run: tardis config --server-url <url>');
    }

    this.baseUrl = config.server.url;
    this.token = config.server.token;
  }

  async authenticate(apiKey: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!response.ok) {
      throw new Error('Authentication failed');
    }

    const data = await response.json();
    this.token = data.token;

    // Save token to config
    const configStore = new ConfigStore();
    const config = configStore.load();
    config.server = config.server || {};
    config.server.token = data.token;
    configStore.save(config);

    return data.token;
  }

  async startSession(taskName: string, taskId?: string): Promise<Session> {
    return this.request('POST', '/api/sessions/start', { taskName, taskId });
  }

  async stopSession(sessionId?: string, taskName?: string, noSync?: boolean): Promise<Session> {
    return this.request('POST', '/api/sessions/stop', { sessionId, taskName, noSync });
  }

  async pauseSession(sessionId?: string, taskName?: string): Promise<Session> {
    return this.request('POST', '/api/sessions/pause', { sessionId, taskName });
  }

  async resumeSession(sessionId?: string, taskName?: string): Promise<Session> {
    return this.request('POST', '/api/sessions/resume', { sessionId, taskName });
  }

  async getActiveSessions(): Promise<Session[]> {
    return this.request('GET', '/api/sessions/active');
  }

  async getStatus(taskName?: string): Promise<Session> {
    const query = taskName ? `?taskName=${encodeURIComponent(taskName)}` : '';
    return this.request('GET', `/api/sessions/status${query}`);
  }

  async matchTask(query: string): Promise<any[]> {
    return this.request('GET', `/api/tasks/match?query=${encodeURIComponent(query)}`);
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    if (!this.token) {
      throw new Error('Not authenticated. Run: tardis setup');
    }

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication expired. Run: tardis setup');
      }

      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  async isOnline(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

#### Update CLI commands to use server:

```typescript
// packages/cli/src/commands/start.ts
import { ServerClient } from '../api/client';
import { SessionStore } from '../storage/session-store'; // Fallback
import { success, error } from '@tardis/shared/utils/format';

export async function startCommand(taskQuery: string): Promise<void> {
  const client = new ServerClient();

  // Try server first
  const isOnline = await client.isOnline();

  if (isOnline) {
    try {
      const session = await client.startSession(taskQuery);

      console.log('\n' + success('Session started!'));
      console.log(`Task: ${session.taskName}`);
      console.log(`Started at: ${new Date(session.startTime).toLocaleString()}`);
      if (session.timeWindow) {
        console.log(`Time window: ${session.timeWindow.start} - ${session.timeWindow.end}`);
      }
      return;
    } catch (err) {
      console.log(error('Server request failed, falling back to offline mode...'));
    }
  }

  // Fallback to offline mode
  const store = new SessionStore();
  // ... existing offline implementation from Phase 1
}
```

---

## 6. Proxmox Deployment

### 6.1 LXC Container Creation

**Step 1: Create Ubuntu 22.04 LXC Container**

Via Proxmox Web UI:

1. Click "Create CT"
2. General:
   - Node: [your node]
   - CT ID: 200 (or next available)
   - Hostname: tardis-server
   - Unprivileged container: ✓
   - Password: [strong password]
3. Template:
   - Storage: local
   - Template: ubuntu-22.04-standard
4. Disks:
   - Storage: local-lvm
   - Disk size: 10GB
5. CPU:
   - Cores: 1
6. Memory:
   - Memory: 512MB
   - Swap: 512MB
7. Network:
   - Bridge: vmbr0
   - IPv4: DHCP (or static)
8. DNS:
   - Use host settings: ✓
9. Confirm and Create

**Step 2: Start Container and Access**

```bash
# Start container
pct start 200

# Enter container
pct enter 200
```

### 6.2 Container Setup

```bash
# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y curl git

# Install Bun
curl -fsSL https://bun.sh/install | bash
source /root/.bashrc

# Verify installation
bun --version

# Create TARDIS directory
mkdir -p /var/lib/tardis
cd /var/lib/tardis

# Create config directory
mkdir -p /var/lib/tardis/users/default/active_sessions
mkdir -p /var/lib/tardis/users/default/sessions
mkdir -p /var/lib/tardis/logs
```

### 6.3 Deploy Server Code

**Option A: From Git Repository**

```bash
cd /opt
git clone https://github.com/yourusername/tardis.git
cd tardis
bun install
bun run build

# Copy server binary to system location
cp packages/server/dist/server /usr/local/bin/tardis-server
```

**Option B: Upload Binary**

```bash
# From your Mac:
scp tardis-server root@[container-ip]:/usr/local/bin/

# In container:
chmod +x /usr/local/bin/tardis-server
```

### 6.4 Configuration

Create `/var/lib/tardis/config.json`:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "dataDir": "/var/lib/tardis"
  },
  "auth": {
    "jwtSecret": "GENERATE_RANDOM_32_CHAR_STRING_HERE",
    "jwtExpiry": "30d",
    "apiKeyLength": 32
  },
  "rateLimit": {
    "enabled": true,
    "windowMs": 60000,
    "maxRequests": 100
  },
  "scheduler": {
    "enabled": true,
    "todoistSyncInterval": 300,
    "timeWindowCheckInterval": 60
  },
  "todoist": {
    "apiToken": "YOUR_TODOIST_TOKEN"
  },
  "notifications": {
    "enabled": true,
    "channels": {
      "telegram": {
        "enabled": true,
        "botToken": "YOUR_BOT_TOKEN",
        "chatId": "YOUR_CHAT_ID"
      }
    }
  }
}
```

Generate JWT secret:

```bash
bun run -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

### 6.5 Systemd Service

Create `/etc/systemd/system/tardis.service`:

```ini
[Unit]
Description=TARDIS Time Tracking Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/lib/tardis
Environment=TARDIS_CONFIG=/var/lib/tardis/config.json
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/tardis-server
Restart=always
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tardis

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable tardis
systemctl start tardis
systemctl status tardis
```

View logs:

```bash
journalctl -u tardis -f
```

### 6.6 Firewall Configuration

```bash
# Allow port 3000 (only needed for debugging, Tailscale bypasses this)
ufw allow 3000/tcp
ufw enable
```

---

## 7. Tailscale Configuration

### 7.1 Install Tailscale on Container

```bash
# In LXC container
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale
tailscale up

# Copy the authentication URL and open in browser
# Authenticate with your Tailscale account
```

### 7.2 Get Tailscale IP

```bash
tailscale ip -4
# Example output: 100.64.0.5
```

### 7.3 Configure on Mac (Development Machine)

```bash
# Install Tailscale (if not already installed)
brew install tailscale

# Start Tailscale
sudo tailscale up

# Verify connection
tailscale status
ping 100.64.0.5
```

### 7.4 Test Server Access

```bash
# From Mac
curl http://100.64.0.5:3000/api/health

# Expected response:
# {"status":"ok","uptime":123,"version":"2.0.0"}
```

### 7.5 Configure CLI

```bash
# On Mac
tardis config --server-url http://100.64.0.5:3000

# Run setup to authenticate
tardis setup
```

---

## 8. Testing Plan

### 8.1 Unit Tests

**Server Components:**

- Authentication middleware
- Rate limiting
- Session manager
- Scheduler logic
- Notification formatting

**Example:**

```typescript
import { describe, it, expect } from 'bun:test';
import { validateApiKey } from './auth';

describe('Authentication', () => {
  it('validates correct API key', async () => {
    const result = await validateApiKey('valid-key-here');
    expect(result).toBe(true);
  });

  it('rejects invalid API key', async () => {
    const result = await validateApiKey('invalid');
    expect(result).toBe(false);
  });
});
```

### 8.2 Integration Tests

**API Endpoints:**

- Complete session lifecycle via API
- Authentication flow
- Todoist sync
- Telegram webhook handling

**Example:**

```typescript
import { describe, it, expect, beforeAll } from 'bun:test';
import { createServer } from './api/server';

describe('Session API', () => {
  let app;
  let token;

  beforeAll(async () => {
    app = createServer();
    // Authenticate and get token
    const auth = await app.request('/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'test-key' }),
    });
    const data = await auth.json();
    token = data.token;
  });

  it('creates a session', async () => {
    const response = await app.request('/api/sessions/start', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskName: 'Test Task' }),
    });

    expect(response.status).toBe(201);
    const session = await response.json();
    expect(session.taskName).toBe('Test Task');
  });
});
```

### 8.3 End-to-End Tests

**Full Workflows:**

1. CLI → Server → Todoist
2. Telegram → Server → Response
3. Scheduler → Notification
4. Auto-reschedule flow

**Example:**

```typescript
import { describe, it, expect } from 'bun:test';
import { $ } from 'bun';

describe('E2E: CLI to Server', () => {
  it('completes full workflow', async () => {
    // Start session via CLI
    const start = await $`tardis start "E2E Test"`.text();
    expect(start).toContain('Session started');

    // Verify on server
    const status = await fetch('http://100.64.0.5:3000/api/sessions/active', {
      headers: { Authorization: 'Bearer ...' },
    });
    const sessions = await status.json();
    expect(sessions).toHaveLength(1);

    // Stop session
    const stop = await $`tardis stop`.text();
    expect(stop).toContain('Session stopped');
  });
});
```

### 8.4 Manual Testing Checklist

**Server:**

- [ ] Server starts successfully
- [ ] Health endpoint responds
- [ ] Authentication works
- [ ] Rate limiting triggers correctly
- [ ] Sessions persist across restarts

**CLI-Server Integration:**

- [ ] CLI connects to server
- [ ] All commands work via server
- [ ] Offline mode works when server down
- [ ] Authentication flow smooth

**Telegram Bot:**

- [ ] All commands respond
- [ ] Interactive keyboards work
- [ ] Messages formatted correctly
- [ ] Task disambiguation works

**Scheduler:**

- [ ] Time window notifications sent
- [ ] Todoist sync runs on schedule
- [ ] Auto-reschedule creates new tasks
- [ ] Notifications delivered

**Deployment:**

- [ ] Container auto-starts on boot
- [ ] Service restarts on failure
- [ ] Logs accessible via journalctl
- [ ] Tailscale connection stable

---

## 9. Migration Strategy

### 9.1 From Phase 1 to Phase 2

**Preparation:**

1. Ensure Phase 1 is complete and stable
2. Back up all user data
3. Test server deployment in development
4. Prepare rollback plan

**Migration Steps:**

**Week 1: Soft Launch (Server Only)**

```bash
# Deploy server to Proxmox
# Don't update CLI yet
# Server runs but CLI still works locally
```

**Week 2: CLI Update (Optional Server)**

```bash
# Release new CLI version with server support
# Server URL is optional
# CLI works without server (backward compatible)
```

**Week 3: Full Transition**

```bash
# Encourage users to connect to server
# Enable scheduler and notifications
# Monitor for issues
```

### 9.2 Rollback Plan

**If server fails:**

```bash
# Stop server
systemctl stop tardis

# CLI automatically falls back to offline mode
# No data loss
```

**If CLI breaks:**

```bash
# Users can roll back to Phase 1 CLI
# Server remains functional for Telegram bot
```

---

## 10. Quality Gates

### 10.1 Before Merging to Main

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] API documentation complete
- [ ] No TypeScript errors
- [ ] No linting errors
- [ ] Security audit clean
- [ ] Performance benchmarks met

### 10.2 Before Deployment

- [ ] Server tested in development
- [ ] Tailscale connection verified
- [ ] Systemd service configured
- [ ] Backup system tested
- [ ] Monitoring configured
- [ ] Documentation complete

### 10.3 Before Public Release

- [ ] Server running 99%+ uptime for 1 week
- [ ] All manual tests passed
- [ ] At least 1 external tester
- [ ] Telegram bot fully functional
- [ ] Auto-reschedule tested end-to-end

---

## 11. Deliverables

### 11.1 Code Deliverables

- [ ] `packages/server` - Complete server package
- [ ] Updated `packages/cli` - Server integration
- [ ] Telegram bot implementation
- [ ] Scheduler and daemon
- [ ] Notification system
- [ ] 70%+ test coverage

### 11.2 Infrastructure Deliverables

- [ ] Proxmox LXC container
- [ ] Systemd service configuration
- [ ] Tailscale VPN setup
- [ ] Backup scripts
- [ ] Deployment documentation

### 11.3 Documentation Deliverables

- [ ] API documentation (OpenAPI spec)
- [ ] Deployment guide (Proxmox)
- [ ] Tailscale setup guide
- [ ] Telegram bot setup guide
- [ ] Troubleshooting guide
- [ ] Architecture diagrams

---

**END OF PHASE 2 IMPLEMENTATION PLAN**
