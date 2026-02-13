# TARDIS Phase 3: Plugin System & Extensibility Implementation Plan

**Phase:** 3 - Plugin System & Future Extensibility  
**Duration:** 3-4 weeks  
**Status:** Planning  
**Version:** 1.0  
**Date:** February 2026

---

## Table of Contents

1. [Phase Overview](#1-phase-overview)
2. [Prerequisites](#2-prerequisites)
3. [Plugin System Design](#3-plugin-system-design)
4. [Sprint Breakdown](#4-sprint-breakdown)
5. [Implementation Details](#5-implementation-details)
6. [Example Plugins](#6-example-plugins)
7. [Plugin Marketplace](#7-plugin-marketplace)
8. [Testing Plan](#8-testing-plan)
9. [Documentation](#9-documentation)
10. [Quality Gates](#10-quality-gates)
11. [Deliverables](#11-deliverables)

---

## 1. Phase Overview

### 1.1 Goals

**Primary Goal:** Create a robust, secure, and developer-friendly plugin system that allows TARDIS to be extended with custom functionality while maintaining the core open-source vision.

**Secondary Goals:**
- Enable community contributions through plugins
- Build foundation for "Jarvis-like" extensibility
- Provide clear plugin development guidelines
- Create example plugins demonstrating all capabilities
- Establish plugin marketplace/registry
- Maintain security and stability of core system

### 1.2 Success Criteria

- [ ] Plugin API stable and well-documented
- [ ] Example plugins demonstrate all hooks and capabilities
- [ ] Plugin development guide complete with tutorials
- [ ] At least 3 working example plugins
- [ ] Plugin loader works reliably
- [ ] Sandboxing prevents plugins from breaking core
- [ ] Plugin marketplace/registry functional
- [ ] Community creates at least 1 plugin independently
- [ ] Zero security vulnerabilities in plugin system

### 1.3 In Scope

**Core Plugin System:**
- Plugin API definition
- Plugin loader and lifecycle management
- Sandboxing and isolation
- Event hooks system
- Custom command registration
- Configuration management per plugin
- Plugin dependency resolution

**Developer Experience:**
- Plugin development SDK
- TypeScript types for plugin API
- CLI scaffolding tool for new plugins
- Development mode with hot reload
- Debugging support
- Comprehensive documentation

**Example Plugins:**
- Google Calendar sync
- GitHub activity tracker
- Pomodoro timer
- Custom webhooks
- Slack notifications

**Plugin Distribution:**
- Plugin registry/marketplace (simple)
- Plugin installation via CLI
- Plugin versioning
- Update mechanism

### 1.4 Out of Scope (Future)

- Web UI for plugin management
- Plugin monetization
- Advanced plugin store with ratings/reviews
- Automated plugin security scanning
- Plugin conflict resolution (manual for now)

### 1.5 Timeline

```
Week 1: Plugin System Architecture + Core Loader
Week 2: Plugin API + Hooks System
Week 3: Example Plugins + SDK
Week 4: Documentation + Marketplace
```

---

## 2. Prerequisites

### 2.1 Phase 1 & 2 Completion

**Required:**
- [ ] Phase 1 fully complete (CLI working)
- [ ] Phase 2 fully complete (Server + Telegram bot)
- [ ] System stable and tested
- [ ] No major bugs or security issues
- [ ] Documentation up to date

### 2.2 Technical Requirements

**Development:**
- TypeScript 5.0+ knowledge
- Understanding of plugin architectures
- Event-driven programming experience
- Security best practices knowledge

**Infrastructure:**
- Server running on Proxmox
- Tailscale VPN configured
- Git repository accessible
- npm/Bun package management

### 2.3 Design Decisions

Before starting Phase 3, confirm:
- Plugin isolation strategy (process vs. VM vs. sandboxing)
- Plugin distribution method (npm vs. custom registry)
- Plugin versioning approach
- Security model for untrusted plugins

---

## 3. Plugin System Design

### 3.1 Plugin Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TARDIS Core System                        │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Plugin Manager                                         │ │
│  │  • Discovery                                           │ │
│  │  • Loading                                             │ │
│  │  • Lifecycle Management                                │ │
│  │  • Dependency Resolution                               │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Plugin Sandbox                                         │ │
│  │  • Isolated Execution                                  │ │
│  │  • Resource Limits                                     │ │
│  │  • API Access Control                                  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Event Bus                                              │ │
│  │  • session:start                                       │ │
│  │  • session:stop                                        │ │
│  │  • session:pause                                       │ │
│  │  • task:sync                                           │ │
│  │  • notification:send                                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Plugin API                                             │ │
│  │  • Core API (sessions, tasks, config)                 │ │
│  │  • Storage API (plugin-specific data)                 │ │
│  │  • HTTP Client (external API calls)                   │ │
│  │  • Notification API                                   │ │
│  │  • Command Registration                               │ │
│  └────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                          │
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼────────┐ ┌──────▼──────┐ ┌───────▼────────┐
│  Plugin 1      │ │  Plugin 2   │ │  Plugin 3      │
│  (Calendar)    │ │  (GitHub)   │ │  (Webhooks)    │
│                │ │             │ │                │
│  • Hooks       │ │  • Hooks    │ │  • Hooks       │
│  • Commands    │ │  • Commands │ │  • Commands    │
│  • Config      │ │  • Config   │ │  • Config      │
└────────────────┘ └─────────────┘ └────────────────┘
```

### 3.2 Plugin Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Plugin Lifecycle                          │
└─────────────────────────────────────────────────────────────┘

1. DISCOVERY
   └─ Plugin Manager scans: ~/.tardis/plugins/
   └─ Reads plugin.json manifest
   └─ Validates structure and dependencies

2. VALIDATION
   └─ Check TARDIS version compatibility
   └─ Verify required dependencies
   └─ Validate plugin signature (future)

3. LOADING
   └─ Import plugin module
   └─ Create isolated context
   └─ Initialize plugin with API

4. ACTIVATION
   └─ Call plugin.onActivate()
   └─ Register event hooks
   └─ Register custom commands
   └─ Load plugin configuration

5. RUNNING
   └─ Respond to events
   └─ Execute custom commands
   └─ Access TARDIS API
   └─ Store plugin data

6. DEACTIVATION
   └─ Call plugin.onDeactivate()
   └─ Unregister hooks and commands
   └─ Clean up resources
   └─ Save plugin state

7. ERROR HANDLING
   └─ Catch plugin errors
   └─ Prevent core system crash
   └─ Log error details
   └─ Disable problematic plugin
```

### 3.3 Plugin Structure

```
~/.tardis/plugins/
├── google-calendar-sync/
│   ├── plugin.json           # Manifest
│   ├── index.ts              # Main entry point
│   ├── config.json           # Plugin config (user-editable)
│   ├── .env                  # Secrets (not committed)
│   ├── README.md             # Documentation
│   └── package.json          # Dependencies
│
├── github-activity/
│   ├── plugin.json
│   ├── index.ts
│   └── ...
│
└── pomodoro-timer/
    ├── plugin.json
    ├── index.ts
    └── ...
```

### 3.4 Plugin Manifest (`plugin.json`)

```json
{
  "name": "google-calendar-sync",
  "version": "1.0.0",
  "displayName": "Google Calendar Sync",
  "description": "Sync TARDIS sessions to Google Calendar",
  "author": "Mohammad <mohammad@weborbit.dev>",
  "license": "MIT",
  "repository": "https://github.com/yourusername/tardis-plugin-gcal",
  
  "tardisVersion": ">=2.0.0",
  
  "main": "index.ts",
  
  "dependencies": {
    "googleapis": "^128.0.0"
  },
  
  "permissions": [
    "sessions:read",
    "sessions:write",
    "storage:read",
    "storage:write",
    "http:external"
  ],
  
  "hooks": [
    "session:start",
    "session:stop",
    "session:pause",
    "session:resume"
  ],
  
  "commands": [
    {
      "name": "sync-calendar",
      "description": "Manually sync sessions to Google Calendar"
    }
  ],
  
  "config": {
    "enabled": true,
    "autoSync": true,
    "calendarId": "primary"
  }
}
```

### 3.5 Plugin API Interface

```typescript
// packages/shared/src/types/plugin.ts

export interface TardisPlugin {
  /**
   * Plugin metadata
   */
  readonly name: string;
  readonly version: string;
  
  /**
   * Lifecycle hooks
   */
  onActivate?(api: PluginAPI): Promise<void>;
  onDeactivate?(): Promise<void>;
  
  /**
   * Event hooks
   */
  onSessionStart?(session: Session, api: PluginAPI): Promise<void>;
  onSessionStop?(session: Session, api: PluginAPI): Promise<void>;
  onSessionPause?(session: Session, api: PluginAPI): Promise<void>;
  onSessionResume?(session: Session, api: PluginAPI): Promise<void>;
  onTaskSync?(tasks: Task[], api: PluginAPI): Promise<void>;
  onNotification?(notification: Notification, api: PluginAPI): Promise<void>;
  
  /**
   * Custom commands
   */
  commands?: {
    [commandName: string]: (args: string[], api: PluginAPI) => Promise<void>;
  };
  
  /**
   * API routes (for server plugins)
   */
  routes?: {
    [path: string]: (req: Request, api: PluginAPI) => Promise<Response>;
  };
}

export interface PluginAPI {
  /**
   * Core API - Access to TARDIS functionality
   */
  sessions: {
    getActive(): Promise<Session[]>;
    getById(id: string): Promise<Session | null>;
    create(data: Partial<Session>): Promise<Session>;
    update(id: string, data: Partial<Session>): Promise<Session>;
  };
  
  tasks: {
    getAll(): Promise<Task[]>;
    getById(id: string): Promise<Task | null>;
    sync(): Promise<void>;
  };
  
  /**
   * Storage API - Plugin-specific persistent storage
   */
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  
  /**
   * HTTP Client - Make external API calls
   */
  http: {
    get(url: string, options?: RequestInit): Promise<Response>;
    post(url: string, body: any, options?: RequestInit): Promise<Response>;
    put(url: string, body: any, options?: RequestInit): Promise<Response>;
    delete(url: string, options?: RequestInit): Promise<Response>;
  };
  
  /**
   * Notification API - Send notifications
   */
  notifications: {
    send(message: string, channel?: 'telegram' | 'email'): Promise<void>;
  };
  
  /**
   * Config API - Access plugin configuration
   */
  config: {
    get(key: string): any;
    set(key: string, value: any): Promise<void>;
    getAll(): Record<string, any>;
  };
  
  /**
   * Logger - Plugin-specific logging
   */
  logger: {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
  };
  
  /**
   * Events - Emit custom events
   */
  events: {
    emit(eventName: string, data: any): void;
    on(eventName: string, handler: (data: any) => void): void;
  };
}
```

---

## 4. Sprint Breakdown

### Sprint 1: Plugin System Foundation (Week 1)

**Goal:** Build core plugin infrastructure

**Tasks:**
1. Design plugin API interface
2. Create plugin manager
3. Implement plugin discovery
4. Build plugin loader
5. Add lifecycle management
6. Create event bus
7. Implement basic sandboxing
8. Write plugin API types

**Deliverables:**
- [ ] Plugin manager working
- [ ] Can load and activate plugins
- [ ] Event system functional
- [ ] Plugin API types defined
- [ ] Basic example plugin loads

**Estimated Time:** 5-7 days

---

### Sprint 2: Plugin API & Hooks (Week 2)

**Goal:** Implement complete plugin API

**Tasks:**
1. Implement sessions API
2. Implement tasks API
3. Create plugin storage system
4. Add HTTP client wrapper
5. Build notification API
6. Create config management
7. Add plugin logger
8. Implement all event hooks
9. Add command registration

**Deliverables:**
- [ ] Full plugin API implemented
- [ ] All hooks working
- [ ] Plugin storage functional
- [ ] Custom commands registrable
- [ ] 70%+ test coverage

**Estimated Time:** 5-7 days

---

### Sprint 3: Example Plugins & SDK (Week 3)

**Goal:** Create example plugins and development tools

**Tasks:**
1. Build Google Calendar sync plugin
2. Create GitHub activity tracker plugin
3. Build Pomodoro timer plugin
4. Create webhook plugin
5. Develop plugin scaffolding CLI
6. Add plugin development mode
7. Create plugin testing utilities
8. Build plugin debugging tools

**Deliverables:**
- [ ] 3+ working example plugins
- [ ] Plugin scaffolding tool (`tardis plugin create`)
- [ ] Development mode with hot reload
- [ ] Plugin testing framework

**Estimated Time:** 5-7 days

---

### Sprint 4: Documentation & Marketplace (Week 4)

**Goal:** Complete documentation and plugin distribution

**Tasks:**
1. Write plugin development guide
2. Create API reference documentation
3. Build plugin marketplace (simple registry)
4. Add plugin installation CLI (`tardis plugin install`)
5. Create plugin update mechanism
6. Write security best practices
7. Create tutorial videos/walkthroughs
8. Set up community contribution process

**Deliverables:**
- [ ] Complete plugin developer docs
- [ ] API reference published
- [ ] Plugin marketplace functional
- [ ] Installation/update working
- [ ] Tutorial content available

**Estimated Time:** 5-7 days

---

## 5. Implementation Details

### 5.1 Plugin Manager

**File:** `packages/server/src/plugins/manager.ts`

```typescript
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { TardisPlugin, PluginManifest } from '@tardis/shared/types/plugin';
import { PluginAPI } from './api';
import { EventBus } from './event-bus';
import { logger } from '@tardis/shared/utils/logger';

export class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private eventBus: EventBus;
  private pluginsDir: string;
  
  constructor(pluginsDir: string = '~/.tardis/plugins') {
    this.pluginsDir = pluginsDir;
    this.eventBus = new EventBus();
  }
  
  /**
   * Discover all plugins in plugins directory
   */
  async discover(): Promise<PluginManifest[]> {
    if (!existsSync(this.pluginsDir)) {
      logger.warn(`Plugins directory not found: ${this.pluginsDir}`);
      return [];
    }
    
    const pluginDirs = readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    const manifests: PluginManifest[] = [];
    
    for (const dir of pluginDirs) {
      const manifestPath = join(this.pluginsDir, dir, 'plugin.json');
      
      if (!existsSync(manifestPath)) {
        logger.warn(`Plugin manifest not found: ${manifestPath}`);
        continue;
      }
      
      try {
        const manifestContent = readFileSync(manifestPath, 'utf-8');
        const manifest: PluginManifest = JSON.parse(manifestContent);
        
        // Validate manifest
        if (!this.validateManifest(manifest)) {
          logger.error(`Invalid plugin manifest: ${dir}`);
          continue;
        }
        
        manifests.push(manifest);
      } catch (error) {
        logger.error(`Failed to load plugin manifest: ${dir}`, error);
      }
    }
    
    return manifests;
  }
  
  /**
   * Load and activate a plugin
   */
  async loadPlugin(name: string): Promise<void> {
    const pluginPath = join(this.pluginsDir, name);
    const manifestPath = join(pluginPath, 'plugin.json');
    
    // Read manifest
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(manifestContent);
    
    // Check TARDIS version compatibility
    if (!this.isCompatible(manifest.tardisVersion)) {
      throw new Error(`Plugin ${name} requires TARDIS ${manifest.tardisVersion}`);
    }
    
    // Import plugin module
    const mainPath = join(pluginPath, manifest.main);
    const pluginModule = await import(mainPath);
    const plugin: TardisPlugin = pluginModule.default;
    
    // Create plugin API instance
    const api = new PluginAPI(name, manifest, this.eventBus);
    
    // Activate plugin
    try {
      if (plugin.onActivate) {
        await plugin.onActivate(api);
      }
      
      // Register event hooks
      this.registerHooks(plugin, api, manifest);
      
      // Register custom commands
      this.registerCommands(plugin, api, manifest);
      
      // Store loaded plugin
      this.plugins.set(name, {
        manifest,
        instance: plugin,
        api,
      });
      
      logger.info(`Plugin loaded: ${manifest.displayName} v${manifest.version}`);
    } catch (error) {
      logger.error(`Failed to activate plugin: ${name}`, error);
      throw error;
    }
  }
  
  /**
   * Unload and deactivate a plugin
   */
  async unloadPlugin(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    
    if (!loaded) {
      throw new Error(`Plugin not loaded: ${name}`);
    }
    
    try {
      if (loaded.instance.onDeactivate) {
        await loaded.instance.onDeactivate();
      }
      
      // Unregister hooks and commands
      this.eventBus.removeAllListeners(name);
      
      this.plugins.delete(name);
      
      logger.info(`Plugin unloaded: ${name}`);
    } catch (error) {
      logger.error(`Failed to deactivate plugin: ${name}`, error);
      throw error;
    }
  }
  
  /**
   * Load all discovered plugins
   */
  async loadAll(): Promise<void> {
    const manifests = await this.discover();
    
    logger.info(`Discovered ${manifests.length} plugins`);
    
    for (const manifest of manifests) {
      if (!manifest.config?.enabled) {
        logger.info(`Plugin disabled: ${manifest.name}`);
        continue;
      }
      
      try {
        await this.loadPlugin(manifest.name);
      } catch (error) {
        logger.error(`Failed to load plugin: ${manifest.name}`, error);
      }
    }
  }
  
  /**
   * Get loaded plugin
   */
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }
  
  /**
   * Get all loaded plugins
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }
  
  /**
   * Emit event to all plugins
   */
  async emitEvent(eventName: string, data: any): Promise<void> {
    await this.eventBus.emit(eventName, data);
  }
  
  private validateManifest(manifest: PluginManifest): boolean {
    return !!(
      manifest.name &&
      manifest.version &&
      manifest.main &&
      manifest.tardisVersion
    );
  }
  
  private isCompatible(requiredVersion: string): boolean {
    // Simple version check (can be improved with semver)
    const currentVersion = '2.0.0';
    return currentVersion >= requiredVersion.replace('>=', '');
  }
  
  private registerHooks(plugin: TardisPlugin, api: PluginAPI, manifest: PluginManifest): void {
    if (!manifest.hooks) return;
    
    for (const hook of manifest.hooks) {
      const handlerName = `on${hook.split(':').map(s => 
        s.charAt(0).toUpperCase() + s.slice(1)
      ).join('')}` as keyof TardisPlugin;
      
      const handler = plugin[handlerName];
      
      if (typeof handler === 'function') {
        this.eventBus.on(hook, manifest.name, async (data: any) => {
          try {
            await (handler as any).call(plugin, data, api);
          } catch (error) {
            logger.error(`Plugin hook error: ${manifest.name}.${handlerName}`, error);
          }
        });
      }
    }
  }
  
  private registerCommands(plugin: TardisPlugin, api: PluginAPI, manifest: PluginManifest): void {
    if (!plugin.commands) return;
    
    for (const [commandName, handler] of Object.entries(plugin.commands)) {
      // Commands will be accessible as: tardis plugin run <plugin-name> <command>
      logger.info(`Registered command: ${manifest.name}:${commandName}`);
    }
  }
}

interface LoadedPlugin {
  manifest: PluginManifest;
  instance: TardisPlugin;
  api: PluginAPI;
}
```

### 5.2 Plugin API Implementation

**File:** `packages/server/src/plugins/api.ts`

```typescript
import { PluginAPI as IPluginAPI, PluginManifest } from '@tardis/shared/types/plugin';
import { SessionManager } from '../core/session-manager';
import { TaskCache } from '../storage/task-cache';
import { PluginStorage } from './storage';
import { NotificationService } from '../integrations/notifications/service';
import { EventBus } from './event-bus';
import { logger as coreLogger } from '@tardis/shared/utils/logger';

export class PluginAPI implements IPluginAPI {
  private sessionManager: SessionManager;
  private taskCache: TaskCache;
  private pluginStorage: PluginStorage;
  private notificationService: NotificationService;
  private eventBus: EventBus;
  
  constructor(
    private pluginName: string,
    private manifest: PluginManifest,
    eventBus: EventBus
  ) {
    this.sessionManager = new SessionManager();
    this.taskCache = new TaskCache();
    this.pluginStorage = new PluginStorage(pluginName);
    this.notificationService = new NotificationService({}); // Will use global config
    this.eventBus = eventBus;
  }
  
  /**
   * Sessions API
   */
  sessions = {
    getActive: async () => {
      this.checkPermission('sessions:read');
      return this.sessionManager.getActiveSessions();
    },
    
    getById: async (id: string) => {
      this.checkPermission('sessions:read');
      return this.sessionManager.getSessionById(id);
    },
    
    create: async (data: any) => {
      this.checkPermission('sessions:write');
      return this.sessionManager.startSession(data);
    },
    
    update: async (id: string, data: any) => {
      this.checkPermission('sessions:write');
      return this.sessionManager.updateSession(id, data);
    },
  };
  
  /**
   * Tasks API
   */
  tasks = {
    getAll: async () => {
      this.checkPermission('tasks:read');
      return this.taskCache.getAllTasks();
    },
    
    getById: async (id: string) => {
      this.checkPermission('tasks:read');
      return this.taskCache.getTaskById(id);
    },
    
    sync: async () => {
      this.checkPermission('tasks:write');
      // Trigger Todoist sync
      await this.eventBus.emit('task:sync', {});
    },
  };
  
  /**
   * Storage API
   */
  storage = {
    get: async (key: string) => {
      this.checkPermission('storage:read');
      return this.pluginStorage.get(key);
    },
    
    set: async (key: string, value: any) => {
      this.checkPermission('storage:write');
      return this.pluginStorage.set(key, value);
    },
    
    delete: async (key: string) => {
      this.checkPermission('storage:write');
      return this.pluginStorage.delete(key);
    },
    
    clear: async () => {
      this.checkPermission('storage:write');
      return this.pluginStorage.clear();
    },
  };
  
  /**
   * HTTP Client
   */
  http = {
    get: async (url: string, options?: RequestInit) => {
      this.checkPermission('http:external');
      return fetch(url, { ...options, method: 'GET' });
    },
    
    post: async (url: string, body: any, options?: RequestInit) => {
      this.checkPermission('http:external');
      return fetch(url, {
        ...options,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: JSON.stringify(body),
      });
    },
    
    put: async (url: string, body: any, options?: RequestInit) => {
      this.checkPermission('http:external');
      return fetch(url, {
        ...options,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: JSON.stringify(body),
      });
    },
    
    delete: async (url: string, options?: RequestInit) => {
      this.checkPermission('http:external');
      return fetch(url, { ...options, method: 'DELETE' });
    },
  };
  
  /**
   * Notifications API
   */
  notifications = {
    send: async (message: string, channel?: 'telegram' | 'email') => {
      this.checkPermission('notifications:send');
      
      if (channel === 'telegram') {
        await this.notificationService.sendTelegram(message);
      } else if (channel === 'email') {
        await this.notificationService.sendEmail('TARDIS Plugin Notification', message);
      } else {
        await this.notificationService.send(message);
      }
    },
  };
  
  /**
   * Config API
   */
  config = {
    get: (key: string) => {
      return this.manifest.config?.[key];
    },
    
    set: async (key: string, value: any) => {
      // Update plugin config file
      this.manifest.config = this.manifest.config || {};
      this.manifest.config[key] = value;
      await this.pluginStorage.set('_config', this.manifest.config);
    },
    
    getAll: () => {
      return this.manifest.config || {};
    },
  };
  
  /**
   * Logger
   */
  logger = {
    info: (message: string, ...args: any[]) => {
      coreLogger.info(`[${this.pluginName}] ${message}`, ...args);
    },
    
    warn: (message: string, ...args: any[]) => {
      coreLogger.warn(`[${this.pluginName}] ${message}`, ...args);
    },
    
    error: (message: string, ...args: any[]) => {
      coreLogger.error(`[${this.pluginName}] ${message}`, ...args);
    },
    
    debug: (message: string, ...args: any[]) => {
      coreLogger.debug(`[${this.pluginName}] ${message}`, ...args);
    },
  };
  
  /**
   * Events API
   */
  events = {
    emit: (eventName: string, data: any) => {
      this.eventBus.emit(`plugin:${this.pluginName}:${eventName}`, data);
    },
    
    on: (eventName: string, handler: (data: any) => void) => {
      this.eventBus.on(`plugin:${this.pluginName}:${eventName}`, this.pluginName, handler);
    },
  };
  
  /**
   * Check if plugin has permission
   */
  private checkPermission(permission: string): void {
    if (!this.manifest.permissions?.includes(permission)) {
      throw new Error(`Plugin ${this.pluginName} does not have permission: ${permission}`);
    }
  }
}
```

### 5.3 Event Bus

**File:** `packages/server/src/plugins/event-bus.ts`

```typescript
type EventHandler = (data: any) => void | Promise<void>;

export class EventBus {
  private listeners: Map<string, Map<string, EventHandler[]>> = new Map();
  
  /**
   * Register event listener
   */
  on(eventName: string, pluginName: string, handler: EventHandler): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Map());
    }
    
    const eventListeners = this.listeners.get(eventName)!;
    
    if (!eventListeners.has(pluginName)) {
      eventListeners.set(pluginName, []);
    }
    
    eventListeners.get(pluginName)!.push(handler);
  }
  
  /**
   * Emit event to all listeners
   */
  async emit(eventName: string, data: any): Promise<void> {
    const eventListeners = this.listeners.get(eventName);
    
    if (!eventListeners) return;
    
    const promises: Promise<void>[] = [];
    
    for (const [pluginName, handlers] of eventListeners) {
      for (const handler of handlers) {
        promises.push(
          Promise.resolve(handler(data)).catch(error => {
            console.error(`Event handler error: ${pluginName}.${eventName}`, error);
          })
        );
      }
    }
    
    await Promise.all(promises);
  }
  
  /**
   * Remove all listeners for a plugin
   */
  removeAllListeners(pluginName: string): void {
    for (const eventListeners of this.listeners.values()) {
      eventListeners.delete(pluginName);
    }
  }
  
  /**
   * Remove specific listener
   */
  removeListener(eventName: string, pluginName: string): void {
    const eventListeners = this.listeners.get(eventName);
    
    if (eventListeners) {
      eventListeners.delete(pluginName);
    }
  }
}
```

### 5.4 Plugin Storage

**File:** `packages/server/src/plugins/storage.ts`

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export class PluginStorage {
  private storageDir: string;
  private storageFile: string;
  private cache: Map<string, any> = new Map();
  
  constructor(pluginName: string) {
    this.storageDir = join(process.env.HOME || '~', '.tardis', 'plugins', pluginName, 'storage');
    this.storageFile = join(this.storageDir, 'data.json');
    
    this.ensureStorage();
    this.loadCache();
  }
  
  private ensureStorage(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    
    if (!existsSync(this.storageFile)) {
      writeFileSync(this.storageFile, JSON.stringify({}));
    }
  }
  
  private loadCache(): void {
    try {
      const content = readFileSync(this.storageFile, 'utf-8');
      const data = JSON.parse(content);
      
      for (const [key, value] of Object.entries(data)) {
        this.cache.set(key, value);
      }
    } catch (error) {
      console.error('Failed to load plugin storage:', error);
    }
  }
  
  private saveCache(): void {
    try {
      const data = Object.fromEntries(this.cache);
      writeFileSync(this.storageFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save plugin storage:', error);
    }
  }
  
  async get(key: string): Promise<any> {
    return this.cache.get(key);
  }
  
  async set(key: string, value: any): Promise<void> {
    this.cache.set(key, value);
    this.saveCache();
  }
  
  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.saveCache();
  }
  
  async clear(): Promise<void> {
    this.cache.clear();
    this.saveCache();
  }
}
```

---

## 6. Example Plugins

### 6.1 Google Calendar Sync Plugin

**File:** `~/.tardis/plugins/google-calendar-sync/index.ts`

```typescript
import { TardisPlugin, PluginAPI, Session } from '@tardis/shared/types/plugin';
import { google } from 'googleapis';

const plugin: TardisPlugin = {
  name: 'google-calendar-sync',
  version: '1.0.0',
  
  async onActivate(api: PluginAPI) {
    api.logger.info('Google Calendar Sync activated');
    
    // Check for OAuth credentials
    const credentials = await api.storage.get('oauth_credentials');
    
    if (!credentials) {
      api.logger.warn('Google Calendar credentials not configured');
      api.logger.info('Run: tardis plugin run google-calendar-sync setup');
    }
  },
  
  async onSessionStop(session: Session, api: PluginAPI) {
    const config = api.config.getAll();
    
    if (!config.autoSync) {
      api.logger.debug('Auto-sync disabled, skipping');
      return;
    }
    
    try {
      await this.syncToCalendar(session, api);
      api.logger.info(`Synced session to Google Calendar: ${session.taskName}`);
    } catch (error) {
      api.logger.error('Failed to sync to Google Calendar:', error);
    }
  },
  
  async syncToCalendar(session: Session, api: PluginAPI) {
    const credentials = await api.storage.get('oauth_credentials');
    
    if (!credentials) {
      throw new Error('OAuth credentials not configured');
    }
    
    // Initialize Google Calendar API
    const auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      'http://localhost:3000/oauth/callback'
    );
    
    auth.setCredentials(credentials.tokens);
    
    const calendar = google.calendar({ version: 'v3', auth });
    
    // Create calendar event
    const event = {
      summary: session.taskName,
      description: `TARDIS Session\nDuration: ${this.formatDuration(session.duration)}`,
      start: {
        dateTime: session.startTime,
      },
      end: {
        dateTime: session.endTime,
      },
    };
    
    const calendarId = api.config.get('calendarId') || 'primary';
    
    await calendar.events.insert({
      calendarId,
      requestBody: event,
    });
  },
  
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  },
  
  commands: {
    'setup': async (args: string[], api: PluginAPI) => {
      api.logger.info('Starting Google Calendar OAuth setup...');
      api.logger.info('Visit: http://localhost:3000/oauth/setup');
      // OAuth setup flow would be implemented here
    },
    
    'sync-all': async (args: string[], api: PluginAPI) => {
      api.logger.info('Syncing all sessions to Google Calendar...');
      
      const sessions = await api.sessions.getActive();
      
      for (const session of sessions) {
        if (session.status === 'COMPLETED') {
          await plugin.syncToCalendar(session, api);
        }
      }
      
      api.logger.info(`Synced ${sessions.length} sessions`);
    },
  },
};

export default plugin;
```

**Manifest:** `plugin.json`

```json
{
  "name": "google-calendar-sync",
  "version": "1.0.0",
  "displayName": "Google Calendar Sync",
  "description": "Automatically sync completed TARDIS sessions to Google Calendar",
  "author": "Mohammad <mohammad@weborbit.dev>",
  "license": "MIT",
  "tardisVersion": ">=2.0.0",
  "main": "index.ts",
  "dependencies": {
    "googleapis": "^128.0.0"
  },
  "permissions": [
    "sessions:read",
    "storage:read",
    "storage:write",
    "http:external"
  ],
  "hooks": [
    "session:stop"
  ],
  "commands": [
    {
      "name": "setup",
      "description": "Set up Google Calendar OAuth"
    },
    {
      "name": "sync-all",
      "description": "Sync all sessions to Google Calendar"
    }
  ],
  "config": {
    "enabled": true,
    "autoSync": true,
    "calendarId": "primary"
  }
}
```

### 6.2 Pomodoro Timer Plugin

**File:** `~/.tardis/plugins/pomodoro-timer/index.ts`

```typescript
import { TardisPlugin, PluginAPI, Session } from '@tardis/shared/types/plugin';

const plugin: TardisPlugin = {
  name: 'pomodoro-timer',
  version: '1.0.0',
  
  async onActivate(api: PluginAPI) {
    api.logger.info('Pomodoro Timer activated');
  },
  
  async onSessionStart(session: Session, api: PluginAPI) {
    const config = api.config.getAll();
    
    if (!config.enabled) return;
    
    const workDuration = config.workDuration || 25; // minutes
    const breakDuration = config.breakDuration || 5; // minutes
    
    // Schedule break notification
    setTimeout(async () => {
      await api.notifications.send(
        `⏰ Pomodoro complete for "${session.taskName}"!\n` +
        `Time for a ${breakDuration} minute break. 🧘`
      );
      
      api.logger.info(`Pomodoro completed: ${session.taskName}`);
    }, workDuration * 60 * 1000);
  },
  
  commands: {
    'start': async (args: string[], api: PluginAPI) => {
      const taskName = args.join(' ');
      const config = api.config.getAll();
      const workDuration = config.workDuration || 25;
      
      api.logger.info(`Starting Pomodoro: ${workDuration} minutes`);
      
      // Start a TARDIS session
      await api.sessions.create({
        taskName: taskName || 'Pomodoro Session',
      });
      
      await api.notifications.send(
        `🍅 Pomodoro started: ${workDuration} minutes\n` +
        `Focus on: ${taskName || 'your task'}`
      );
    },
    
    'config': async (args: string[], api: PluginAPI) => {
      if (args.length === 0) {
        const config = api.config.getAll();
        api.logger.info('Current Pomodoro configuration:');
        api.logger.info(`  Work duration: ${config.workDuration || 25} minutes`);
        api.logger.info(`  Break duration: ${config.breakDuration || 5} minutes`);
        return;
      }
      
      const [key, value] = args;
      await api.config.set(key, parseInt(value));
      api.logger.info(`Updated ${key} to ${value}`);
    },
  },
};

export default plugin;
```

### 6.3 GitHub Activity Tracker

**File:** `~/.tardis/plugins/github-activity/index.ts`

```typescript
import { TardisPlugin, PluginAPI, Session } from '@tardis/shared/types/plugin';

const plugin: TardisPlugin = {
  name: 'github-activity',
  version: '1.0.0',
  
  async onSessionStop(session: Session, api: PluginAPI) {
    const config = api.config.getAll();
    
    if (!config.trackGitHub) return;
    
    try {
      // Get GitHub activity during session
      const activity = await this.fetchGitHubActivity(session, api);
      
      if (activity.length > 0) {
        // Store in session metadata
        await api.storage.set(`github_${session.id}`, activity);
        
        api.logger.info(`Tracked ${activity.length} GitHub events for: ${session.taskName}`);
      }
    } catch (error) {
      api.logger.error('Failed to track GitHub activity:', error);
    }
  },
  
  async fetchGitHubActivity(session: Session, api: PluginAPI) {
    const config = api.config.getAll();
    const username = config.githubUsername;
    const token = await api.storage.get('github_token');
    
    if (!username || !token) {
      throw new Error('GitHub credentials not configured');
    }
    
    const response = await api.http.get(
      `https://api.github.com/users/${username}/events`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );
    
    const events = await response.json();
    
    // Filter events within session time range
    const sessionStart = new Date(session.startTime).getTime();
    const sessionEnd = new Date(session.endTime!).getTime();
    
    return events.filter((event: any) => {
      const eventTime = new Date(event.created_at).getTime();
      return eventTime >= sessionStart && eventTime <= sessionEnd;
    });
  },
  
  commands: {
    'setup': async (args: string[], api: PluginAPI) => {
      const [username, token] = args;
      
      if (!username || !token) {
        api.logger.error('Usage: tardis plugin run github-activity setup <username> <token>');
        return;
      }
      
      await api.config.set('githubUsername', username);
      await api.storage.set('github_token', token);
      
      api.logger.info('GitHub credentials configured');
    },
    
    'report': async (args: string[], api: PluginAPI) => {
      // Generate activity report
      api.logger.info('GitHub Activity Report');
      api.logger.info('=====================');
      
      // Implementation would show stats
    },
  },
};

export default plugin;
```

---

## 7. Plugin Marketplace

### 7.1 Simple Registry Structure

```
tardis-plugin-registry/
├── plugins/
│   ├── google-calendar-sync.json
│   ├── github-activity.json
│   ├── pomodoro-timer.json
│   └── ...
└── index.json
```

**Registry Index:** `index.json`

```json
{
  "version": "1.0.0",
  "plugins": [
    {
      "name": "google-calendar-sync",
      "version": "1.0.0",
      "displayName": "Google Calendar Sync",
      "description": "Sync sessions to Google Calendar",
      "author": "Mohammad",
      "repository": "https://github.com/weborbit/tardis-plugin-gcal",
      "downloads": 150,
      "rating": 4.8,
      "verified": true
    },
    {
      "name": "github-activity",
      "version": "1.0.0",
      "displayName": "GitHub Activity Tracker",
      "description": "Track GitHub activity during sessions",
      "author": "Mohammad",
      "repository": "https://github.com/weborbit/tardis-plugin-github",
      "downloads": 89,
      "rating": 4.5,
      "verified": true
    }
  ]
}
```

### 7.2 Plugin Installation CLI

```bash
# Search for plugins
tardis plugin search calendar

# Install plugin
tardis plugin install google-calendar-sync

# List installed plugins
tardis plugin list

# Update plugin
tardis plugin update google-calendar-sync

# Uninstall plugin
tardis plugin uninstall google-calendar-sync

# Enable/disable plugin
tardis plugin enable google-calendar-sync
tardis plugin disable google-calendar-sync

# Run plugin command
tardis plugin run google-calendar-sync setup
```

**Implementation:** `packages/cli/src/commands/plugin.ts`

```typescript
import { Command } from 'commander';
import { PluginManager } from '../plugin-manager';

const plugin = new Command('plugin');

plugin
  .command('search <query>')
  .description('Search for plugins in the registry')
  .action(async (query) => {
    // Implementation
  });

plugin
  .command('install <name>')
  .description('Install a plugin')
  .action(async (name) => {
    const manager = new PluginManager();
    await manager.install(name);
    console.log(`✓ Plugin installed: ${name}`);
  });

plugin
  .command('list')
  .description('List installed plugins')
  .action(async () => {
    const manager = new PluginManager();
    const plugins = await manager.list();
    
    console.log('Installed Plugins:');
    for (const p of plugins) {
      const status = p.enabled ? '✓' : '✗';
      console.log(`  ${status} ${p.displayName} (v${p.version})`);
    }
  });

plugin
  .command('run <plugin> <command> [...args]')
  .description('Run a plugin command')
  .action(async (pluginName, command, args) => {
    const manager = new PluginManager();
    await manager.runCommand(pluginName, command, args);
  });

export default plugin;
```

---

## 8. Testing Plan

### 8.1 Plugin System Tests

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { PluginManager } from './plugin-manager';
import { PluginAPI } from './api';

describe('Plugin System', () => {
  let manager: PluginManager;
  
  beforeEach(() => {
    manager = new PluginManager('./test-plugins');
  });
  
  it('discovers plugins', async () => {
    const manifests = await manager.discover();
    expect(manifests.length).toBeGreaterThan(0);
  });
  
  it('loads plugin successfully', async () => {
    await manager.loadPlugin('test-plugin');
    const plugin = manager.getPlugin('test-plugin');
    expect(plugin).toBeDefined();
  });
  
  it('calls onActivate hook', async () => {
    let activated = false;
    
    // Create test plugin with onActivate
    // ... test implementation
    
    expect(activated).toBe(true);
  });
  
  it('registers event hooks', async () => {
    await manager.loadPlugin('test-plugin');
    
    // Emit event
    await manager.emitEvent('session:start', { taskName: 'Test' });
    
    // Verify hook was called
  });
  
  it('enforces permissions', async () => {
    await manager.loadPlugin('test-plugin');
    const plugin = manager.getPlugin('test-plugin');
    
    // Try to access API without permission
    await expect(
      plugin?.api.sessions.create({ taskName: 'Test' })
    ).rejects.toThrow('does not have permission');
  });
});
```

### 8.2 Plugin API Tests

```typescript
describe('Plugin API', () => {
  it('provides session access', async () => {
    const api = new PluginAPI('test', manifest, eventBus);
    const sessions = await api.sessions.getActive();
    expect(Array.isArray(sessions)).toBe(true);
  });
  
  it('provides storage access', async () => {
    const api = new PluginAPI('test', manifest, eventBus);
    
    await api.storage.set('key', 'value');
    const value = await api.storage.get('key');
    
    expect(value).toBe('value');
  });
  
  it('provides HTTP client', async () => {
    const api = new PluginAPI('test', manifest, eventBus);
    
    const response = await api.http.get('https://api.example.com/test');
    expect(response).toBeDefined();
  });
});
```

### 8.3 Example Plugin Tests

```typescript
describe('Google Calendar Plugin', () => {
  it('syncs session to calendar', async () => {
    // Test implementation
  });
  
  it('handles OAuth setup', async () => {
    // Test implementation
  });
});
```

---

## 9. Documentation

### 9.1 Plugin Development Guide

**File:** `docs/plugin-development.md`

```markdown
# TARDIS Plugin Development Guide

## Getting Started

### Prerequisites
- TARDIS v2.0.0 or higher
- TypeScript knowledge
- Node.js/Bun installed

### Creating Your First Plugin

1. **Create plugin directory:**
```bash
mkdir -p ~/.tardis/plugins/my-plugin
cd ~/.tardis/plugins/my-plugin
```

2. **Initialize package:**
```bash
bun init -y
```

3. **Create plugin.json:**
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "description": "My awesome TARDIS plugin",
  "main": "index.ts",
  "tardisVersion": ">=2.0.0",
  "permissions": ["sessions:read"],
  "hooks": ["session:start"]
}
```

4. **Create index.ts:**
```typescript
import { TardisPlugin, PluginAPI } from '@tardis/shared/types/plugin';

const plugin: TardisPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  async onActivate(api: PluginAPI) {
    api.logger.info('My plugin activated!');
  },
  
  async onSessionStart(session, api) {
    api.logger.info(`Session started: ${session.taskName}`);
  },
};

export default plugin;
```

5. **Test your plugin:**
```bash
# Enable plugin in TARDIS
echo '{"enabled": true}' > config.json

# Restart TARDIS server
systemctl restart tardis

# Check logs
tardis plugin run my-plugin
```

## Plugin API Reference

[Complete API documentation...]

## Best Practices

### Security
- Never store credentials in code
- Use api.storage for sensitive data
- Validate all user input
- Handle errors gracefully

### Performance
- Use async/await properly
- Cache expensive operations
- Limit API calls
- Clean up resources in onDeactivate

### User Experience
- Provide clear error messages
- Log important events
- Document configuration options
- Include examples in README

## Publishing Your Plugin

1. Create GitHub repository
2. Add to plugin registry
3. Submit pull request to tardis-plugin-registry
4. Wait for review and approval
```

### 9.2 API Reference Documentation

Generate from TypeScript types using TypeDoc.

---

## 10. Quality Gates

### 10.1 Before Merging

- [ ] All tests passing (70%+ coverage)
- [ ] Plugin API fully documented
- [ ] Example plugins working
- [ ] Security review complete
- [ ] No TypeScript errors
- [ ] Plugin isolation verified

### 10.2 Before Release

- [ ] At least 3 example plugins
- [ ] Plugin development guide complete
- [ ] API reference published
- [ ] Plugin marketplace functional
- [ ] Installation/update tested
- [ ] Community plugin created

---

## 11. Deliverables

### 11.1 Code

- [ ] Plugin manager
- [ ] Plugin API
- [ ] Event bus
- [ ] Plugin storage
- [ ] Example plugins (3+)
- [ ] CLI commands
- [ ] Tests (70%+ coverage)

### 11.2 Documentation

- [ ] Plugin development guide
- [ ] API reference
- [ ] Security best practices
- [ ] Example plugin tutorials
- [ ] Migration guide

### 11.3 Tooling

- [ ] Plugin scaffolding CLI
- [ ] Plugin marketplace
- [ ] Installation system
- [ ] Update mechanism

---

**END OF PHASE 3 IMPLEMENTATION PLAN**
