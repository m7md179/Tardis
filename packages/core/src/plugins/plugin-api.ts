import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { pluginStorage } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { SystemConfig } from '@tardis/shared';
import { PermissionGuard } from './permission-guard.js';

// ─── Types ───

export interface StorageAPI {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface LoggerAPI {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

export interface EventsAPI {
  emit(name: string, data?: unknown): void;
  on(name: string, handler: (data: unknown) => void): void;
}

export interface ConfigAPI {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

// Stubbed APIs — will be implemented in later phases
export interface NotificationsAPI {
  send(message: string, options?: { urgent?: boolean }): Promise<void>;
}
export interface SessionsAPI {
  getActive(): Promise<never[]>;
  start(params: { taskName: string; metadata?: unknown }): Promise<never>;
  stop(sessionId: string): Promise<never>;
  pause(sessionId: string): Promise<never>;
  resume(sessionId: string): Promise<never>;
  getHistory(options?: { limit?: number; date?: string }): Promise<never[]>;
}
export interface MemoryAPI {
  get(key: string): Promise<null>;
  set(key: string, value: string, type?: string): Promise<void>;
  search(query: string, limit?: number): Promise<never[]>;
  delete(key: string): Promise<void>;
}
export interface HttpAPI {
  get(url: string, options?: RequestInit): Promise<never>;
  post(url: string, body: unknown, options?: RequestInit): Promise<never>;
  put(url: string, body: unknown, options?: RequestInit): Promise<never>;
  delete(url: string, options?: RequestInit): Promise<never>;
}
export interface LLMPluginAPI {
  generate(prompt: string, options?: { systemPrompt?: string }): Promise<never>;
}
export interface PluginsAPI {
  list(): Promise<never[]>;
  call(pluginName: string, toolName: string, args: Record<string, unknown>): Promise<never>;
}

export interface PluginAPI {
  storage: StorageAPI;
  config: ConfigAPI;
  logger: LoggerAPI;
  events: EventsAPI;
  notifications: NotificationsAPI;
  sessions: SessionsAPI;
  memory: MemoryAPI;
  http: HttpAPI;
  llm: LLMPluginAPI;
  plugins: PluginsAPI;
}

// ─── Helpers ───

function makeStubAsync<T>(method: string): () => Promise<T> {
  return async () => {
    throw new Error(`PluginAPI.${method} is not yet implemented (coming in a later phase)`);
  };
}

/**
 * Create a sandboxed PluginAPI instance for a plugin.
 *
 * Each method that requires a permission checks the guard before executing.
 * Storage, logger, config, and events are always available or guarded.
 * Everything else is stubbed — permission check runs first, then throws "not yet implemented".
 */
export function createPluginApi(params: {
  pluginName: string;
  permissions: string[];
  db: TardisDB;
  config: SystemConfig;
  eventEmitter?: {
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (data: unknown) => void) => void;
  };
}): PluginAPI {
  const { pluginName, permissions, db, eventEmitter } = params;
  const guard = new PermissionGuard(pluginName, permissions);

  // ─── Storage ───
  const storage: StorageAPI = {
    async get<T = unknown>(key: string): Promise<T | null> {
      guard.assert('storage:read');
      const rows = await db
        .select()
        .from(pluginStorage)
        .where(and(eq(pluginStorage.pluginName, pluginName), eq(pluginStorage.key, key)))
        .all();
      if (rows.length === 0) return null;
      return JSON.parse(rows[0]!.value) as T;
    },

    async set(key: string, value: unknown): Promise<void> {
      guard.assert('storage:write');
      const existing = await db
        .select({ id: pluginStorage.id })
        .from(pluginStorage)
        .where(and(eq(pluginStorage.pluginName, pluginName), eq(pluginStorage.key, key)))
        .all();

      if (existing.length > 0) {
        await db
          .update(pluginStorage)
          .set({ value: JSON.stringify(value), updatedAt: Date.now() })
          .where(and(eq(pluginStorage.pluginName, pluginName), eq(pluginStorage.key, key)));
      } else {
        await db.insert(pluginStorage).values({
          id: randomUUID(),
          pluginName,
          key,
          value: JSON.stringify(value),
          updatedAt: Date.now(),
        });
      }
    },

    async delete(key: string): Promise<void> {
      guard.assert('storage:write');
      await db
        .delete(pluginStorage)
        .where(and(eq(pluginStorage.pluginName, pluginName), eq(pluginStorage.key, key)));
    },

    async list(prefix?: string): Promise<string[]> {
      guard.assert('storage:read');
      const rows = await db
        .select({ key: pluginStorage.key })
        .from(pluginStorage)
        .where(eq(pluginStorage.pluginName, pluginName))
        .all();
      const keys = rows.map((r) => r.key);
      return prefix !== undefined ? keys.filter((k) => k.startsWith(prefix)) : keys;
    },
  };

  // ─── Logger (always available, no permission required) ───
  const logger: LoggerAPI = {
    info: (msg, data) => console.log(`[${pluginName}] INFO:`, msg, ...(data !== undefined ? [data] : [])),
    warn: (msg, data) => console.warn(`[${pluginName}] WARN:`, msg, ...(data !== undefined ? [data] : [])),
    error: (msg, data) => console.error(`[${pluginName}] ERROR:`, msg, ...(data !== undefined ? [data] : [])),
    debug: (msg, data) => console.debug(`[${pluginName}] DEBUG:`, msg, ...(data !== undefined ? [data] : [])),
  };

  // ─── Config (MVP: no-op storage, returns null) ───
  const configApi: ConfigAPI = {
    async get<T = unknown>(_key: string): Promise<T | null> {
      return null;
    },
    async set(_key: string, _value: unknown): Promise<void> {
      // Plugin config persistence comes in phase 2
    },
  };

  // ─── Events ───
  const events: EventsAPI = {
    emit(name, data) {
      eventEmitter?.emit(name, data);
    },
    on(name, handler) {
      eventEmitter?.on(name, handler);
    },
  };

  // ─── Stubs (permission check runs, then "not yet implemented") ───
  const notifications: NotificationsAPI = {
    send: async () => {
      guard.assert('notifications:send');
      throw new Error('PluginAPI.notifications.send is not yet implemented');
    },
  };

  const sessions: SessionsAPI = {
    getActive: async () => { guard.assert('sessions:read'); throw new Error('PluginAPI.sessions not yet implemented'); },
    start: async () => { guard.assert('sessions:write'); throw new Error('PluginAPI.sessions not yet implemented'); },
    stop: async () => { guard.assert('sessions:write'); throw new Error('PluginAPI.sessions not yet implemented'); },
    pause: async () => { guard.assert('sessions:write'); throw new Error('PluginAPI.sessions not yet implemented'); },
    resume: async () => { guard.assert('sessions:write'); throw new Error('PluginAPI.sessions not yet implemented'); },
    getHistory: async () => { guard.assert('sessions:read'); throw new Error('PluginAPI.sessions not yet implemented'); },
  };

  const memory: MemoryAPI = {
    get: async () => { guard.assert('memory:read'); throw new Error('PluginAPI.memory not yet implemented'); },
    set: async () => { guard.assert('memory:write'); throw new Error('PluginAPI.memory not yet implemented'); },
    search: async () => { guard.assert('memory:read'); throw new Error('PluginAPI.memory not yet implemented'); },
    delete: async () => { guard.assert('memory:write'); throw new Error('PluginAPI.memory not yet implemented'); },
  };

  const http: HttpAPI = {
    get: makeStubAsync('http.get') as HttpAPI['get'],
    post: makeStubAsync('http.post') as HttpAPI['post'],
    put: makeStubAsync('http.put') as HttpAPI['put'],
    delete: makeStubAsync('http.delete') as HttpAPI['delete'],
  };

  const llm: LLMPluginAPI = {
    generate: makeStubAsync('llm.generate') as LLMPluginAPI['generate'],
  };

  const plugins: PluginsAPI = {
    list: makeStubAsync('plugins.list') as PluginsAPI['list'],
    call: makeStubAsync('plugins.call') as PluginsAPI['call'],
  };

  return { storage, config: configApi, logger, events, notifications, sessions, memory, http, llm, plugins };
}
