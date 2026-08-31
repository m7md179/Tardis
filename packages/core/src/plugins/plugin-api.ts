import { eq, and, or, desc, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { pluginStorage, sessions as sessionsTable } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { Session, SystemConfig, MemoryEntry, MemoryType } from '@tardis/shared';
import { PermissionGuard } from './permission-guard.js';
import type { PluginConfigField } from '@tardis/shared';
import { coerceConfigValue, resolvePluginConfig } from './plugin-config.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { MemoryIndexer } from '../memory/memory-indexer.js';
import type { LLMMessage, LLMProvider } from '../llm/provider.js';

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
  getActive(): Promise<Session[]>;
  start(params: { taskName: string; metadata?: Record<string, unknown> }): Promise<Session>;
  stop(sessionId: string): Promise<Session>;
  pause(sessionId: string): Promise<Session>;
  resume(sessionId: string): Promise<Session>;
  getHistory(options?: { limit?: number; date?: string }): Promise<Session[]>;
}
export interface MemoryAPI {
  get(key: string): Promise<MemoryEntry | null>;
  set(key: string, value: string, type?: MemoryType): Promise<void>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  delete(key: string): Promise<boolean>;
}
export interface HttpAPI {
  get(url: string, options?: RequestInit): Promise<never>;
  post(url: string, body: unknown, options?: RequestInit): Promise<never>;
  put(url: string, body: unknown, options?: RequestInit): Promise<never>;
  patch(url: string, body: unknown, options?: RequestInit): Promise<never>;
  delete(url: string, options?: RequestInit): Promise<never>;
}
export interface LLMGenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMPluginAPI {
  /**
   * Text in, text out. No tools, no conversation history — a plugin's LLM never
   * sees the user's chat, only the parameters the plugin hands it.
   */
  generate(prompt: string, options?: LLMGenerateOptions): Promise<string>;
  /**
   * Same, plus exactly one image (a data URI).
   *
   * One image per call is not a limitation of this method, it is the contract:
   * the local model blends several images into a single confident wrong answer.
   * Callers analysing multiple photos must call this once per photo.
   */
  analyzeImage(
    prompt: string,
    imageDataUri: string,
    options?: LLMGenerateOptions
  ): Promise<string>;
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
  /** Called by notifications.send() — typically wired to Telegram sendMessage. */
  notificationSender?: (message: string, options?: { urgent?: boolean }) => Promise<void>;
  /** Shared MemoryStore instance for plugin memory access. */
  memoryStore?: MemoryStore;
  /** Optional vector index. Absent means keyword-only memory search. */
  memoryIndexer?: MemoryIndexer | undefined;
  /** Shared LLM provider, exposed to plugins holding the "llm:use" permission. */
  llmProvider?: LLMProvider;
  /**
   * The plugin's declared settings. Supplies defaults and validates writes.
   * Absent means the old behaviour: system config only, no defaults, no checks.
   */
  configSchema?: Record<string, PluginConfigField> | undefined;
  /**
   * Persists a setting changed through `api.config.set`.
   *
   * Without it, `set` throws instead of silently discarding — which is what it
   * used to do, and is the harder bug to find of the two.
   */
  persistConfig?:
    | ((pluginName: string, key: string, value: unknown) => Promise<void>)
    | undefined;
}): PluginAPI {
  const { pluginName, permissions, db, eventEmitter, notificationSender, llmProvider } = params;
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
    info: (msg, data) =>
      console.log(`[${pluginName}] INFO:`, msg, ...(data !== undefined ? [data] : [])),
    warn: (msg, data) =>
      console.warn(`[${pluginName}] WARN:`, msg, ...(data !== undefined ? [data] : [])),
    error: (msg, data) =>
      console.error(`[${pluginName}] ERROR:`, msg, ...(data !== undefined ? [data] : [])),
    debug: (msg, data) =>
      console.debug(`[${pluginName}] DEBUG:`, msg, ...(data !== undefined ? [data] : [])),
  };

  // ─── Config ───
  //
  // Declared defaults, overlaid by the system config. Before this, `get` looked
  // only at the system config, so a manifest's own defaults were dead weight
  // and every plugin carried a DEFAULTS constant and a merge loop to work
  // around it.
  const pluginConfig = params.config.plugins?.[pluginName] ?? {};
  const configSchema = params.configSchema ?? {};
  const resolved = resolvePluginConfig(configSchema, pluginConfig);

  const configApi: ConfigAPI = {
    async get<T = unknown>(key: string): Promise<T | null> {
      if (key in resolved.values) return resolved.values[key] as T;
      // A key the schema does not declare still reads through, so a plugin
      // using config as a loose bag is not broken by gaining a schema.
      if (key in pluginConfig) return pluginConfig[key] as T;
      return null;
    },

    async set(key: string, value: unknown): Promise<void> {
      const field = configSchema[key];
      if (field) {
        const coerced = coerceConfigValue(field, value);
        if (!coerced.ok) {
          throw new Error(`Invalid value for ${pluginName}.${key}: ${coerced.message}`);
        }
        value = coerced.value;
      }

      if (!params.persistConfig) {
        // Loudly, rather than the no-op this used to be. A setting that
        // vanishes without a word is worse than one that refuses to save.
        throw new Error(
          `Cannot save ${pluginName}.${key}: this TARDIS instance has no config writer`
        );
      }

      await params.persistConfig(pluginName, key, value);
      resolved.values[key] = value;
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

  // ─── Notifications ───
  const notifications: NotificationsAPI = {
    async send(message, options) {
      guard.assert('notifications:send');
      if (notificationSender) {
        await notificationSender(message, options);
      } else {
        // No sender configured — log to console as fallback
        console.log(`[${pluginName}] NOTIFICATION: ${message}`);
      }
    },
  };

  // ─── Session helpers ───
  function dbRowToSession(row: typeof sessionsTable.$inferSelect): Session {
    return {
      id: row.id,
      taskName: row.taskName,
      status: row.status as Session['status'],
      startTime: row.startTime,
      ...(row.endTime !== null ? { endTime: row.endTime } : {}),
      ...(row.duration !== null ? { duration: row.duration } : {}),
      ...(row.pausedAt !== null ? { pausedAt: row.pausedAt } : {}),
      accumulatedTime: row.accumulatedTime ?? 0,
      ...(row.metadata !== null ? { metadata: JSON.parse(row.metadata!) as Record<string, unknown> } : {}),
      createdAt: row.createdAt,
    };
  }

  async function getSessionOrThrow(id: string): Promise<typeof sessionsTable.$inferSelect> {
    const rows = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).all();
    if (rows.length === 0) throw new Error(`Session "${id}" not found`);
    return rows[0]!;
  }

  const sessions: SessionsAPI = {
    async getActive() {
      guard.assert('sessions:read');
      const rows = await db
        .select()
        .from(sessionsTable)
        .where(or(eq(sessionsTable.status, 'active'), eq(sessionsTable.status, 'paused')))
        .all();
      return rows.map(dbRowToSession);
    },

    async start({ taskName, metadata }) {
      guard.assert('sessions:write');
      const now = Date.now();
      const id = randomUUID();
      await db.insert(sessionsTable).values({
        id,
        taskName,
        status: 'active',
        startTime: now,
        accumulatedTime: 0,
        metadata: metadata !== undefined ? JSON.stringify(metadata) : null,
        createdAt: now,
      });
      const row = await getSessionOrThrow(id);
      return dbRowToSession(row);
    },

    async stop(sessionId) {
      guard.assert('sessions:write');
      const row = await getSessionOrThrow(sessionId);
      if (row.status === 'completed') throw new Error(`Session "${sessionId}" is already completed`);
      const now = Date.now();
      const accumulated = row.accumulatedTime ?? 0;
      const activeSeconds =
        row.status === 'active' ? Math.round((now - row.startTime) / 1000) : 0;
      const duration = accumulated + activeSeconds;
      await db
        .update(sessionsTable)
        .set({ status: 'completed', endTime: now, duration })
        .where(eq(sessionsTable.id, sessionId));
      return dbRowToSession({ ...row, status: 'completed', endTime: now, duration });
    },

    async pause(sessionId) {
      guard.assert('sessions:write');
      const row = await getSessionOrThrow(sessionId);
      if (row.status !== 'active') throw new Error(`Session "${sessionId}" is not active`);
      const now = Date.now();
      const elapsed = Math.round((now - row.startTime) / 1000);
      const newAccumulated = (row.accumulatedTime ?? 0) + elapsed;
      await db
        .update(sessionsTable)
        .set({ status: 'paused', pausedAt: now, accumulatedTime: newAccumulated })
        .where(eq(sessionsTable.id, sessionId));
      return dbRowToSession({
        ...row,
        status: 'paused',
        pausedAt: now,
        accumulatedTime: newAccumulated,
      });
    },

    async resume(sessionId) {
      guard.assert('sessions:write');
      const row = await getSessionOrThrow(sessionId);
      if (row.status !== 'paused') throw new Error(`Session "${sessionId}" is not paused`);
      const now = Date.now();
      // Reset startTime to now — it marks the start of the new active period
      await db
        .update(sessionsTable)
        .set({ status: 'active', startTime: now, pausedAt: null })
        .where(eq(sessionsTable.id, sessionId));
      return dbRowToSession({ ...row, status: 'active', startTime: now, pausedAt: null });
    },

    async getHistory({ limit = 10, date } = {}) {
      guard.assert('sessions:read');
      const baseWhere =
        date !== undefined
          ? and(
              eq(sessionsTable.status, 'completed'),
              gte(sessionsTable.createdAt, new Date(date + 'T00:00:00').getTime()),
              lte(sessionsTable.createdAt, new Date(date + 'T23:59:59.999').getTime())
            )
          : eq(sessionsTable.status, 'completed');

      const rows = await db
        .select()
        .from(sessionsTable)
        .where(baseWhere)
        .orderBy(desc(sessionsTable.createdAt))
        .limit(limit)
        .all();
      return rows.map(dbRowToSession);
    },
  };

  const memory: MemoryAPI = {
    async get(key: string): Promise<MemoryEntry | null> {
      guard.assert('memory:read');
      if (!params.memoryStore) throw new Error('MemoryStore not configured');
      return params.memoryStore.getByKey(key);
    },
    async set(key: string, value: string, type?: MemoryType): Promise<void> {
      guard.assert('memory:write');
      if (!params.memoryStore) throw new Error('MemoryStore not configured');
      const saved = await params.memoryStore.upsertByKey({
        type: type ?? 'plugin',
        key,
        value,
        source: pluginName,
        pluginName,
      });
      // A plugin's memories are searched by the same retriever as everyone
      // else's, so they need the same index. indexOne never throws.
      await params.memoryIndexer?.indexOne(saved);
    },
    async search(query: string, limit?: number): Promise<MemoryEntry[]> {
      guard.assert('memory:read');
      if (!params.memoryStore) throw new Error('MemoryStore not configured');
      const results = await params.memoryStore.search(query, limit);
      const seen = new Set(results.map((m) => m.id));
      for (const m of (await params.memoryIndexer?.similar(query)) ?? []) {
        if (!seen.has(m.id)) {
          results.push(m);
          seen.add(m.id);
        }
      }
      return results;
    },
    async delete(key: string): Promise<boolean> {
      guard.assert('memory:write');
      if (!params.memoryStore) throw new Error('MemoryStore not configured');
      return params.memoryStore.delete(key);
    },
  };

  const http: HttpAPI = {
    async get(url, options) {
      guard.assert('http:external');
      return fetch(url, { ...options, method: 'GET' }) as Promise<never>;
    },
    async post(url, body, options) {
      guard.assert('http:external');
      const isString = typeof body === 'string';
      return fetch(url, {
        ...options,
        method: 'POST',
        body: isString ? body : JSON.stringify(body),
        headers: {
          'Content-Type': isString ? 'application/x-www-form-urlencoded' : 'application/json',
          ...(options?.headers ?? {}),
        },
      }) as Promise<never>;
    },
    async put(url, body, options) {
      guard.assert('http:external');
      const isString = typeof body === 'string';
      return fetch(url, {
        ...options,
        method: 'PUT',
        body: isString ? body : JSON.stringify(body),
        headers: {
          'Content-Type': isString ? 'application/x-www-form-urlencoded' : 'application/json',
          ...(options?.headers ?? {}),
        },
      }) as Promise<never>;
    },
    async patch(url, body, options) {
      guard.assert('http:external');
      const isString = typeof body === 'string';
      return fetch(url, {
        ...options,
        method: 'PATCH',
        body: isString ? body : JSON.stringify(body),
        headers: {
          'Content-Type': isString ? 'application/x-www-form-urlencoded' : 'application/json',
          ...(options?.headers ?? {}),
        },
      }) as Promise<never>;
    },
    async delete(url, options) {
      guard.assert('http:external');
      return fetch(url, { ...options, method: 'DELETE' }) as Promise<never>;
    },
  };

  const llm: LLMPluginAPI = {
    async generate(prompt, options) {
      guard.assert('llm:use');
      if (!llmProvider) {
        throw new Error(`PluginAPI.llm.generate is unavailable: no LLM provider configured`);
      }
      return llmProvider.generate({
        systemPrompt: options?.systemPrompt ?? '',
        userPrompt: prompt,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      });
    },

    async analyzeImage(prompt, imageDataUri, options) {
      guard.assert('llm:use');
      if (!llmProvider) {
        throw new Error(`PluginAPI.llm.analyzeImage is unavailable: no LLM provider configured`);
      }
      if (!imageDataUri.startsWith('data:')) {
        throw new Error(
          'analyzeImage expects a data URI. TARDIS never asks the model to fetch a URL itself.'
        );
      }

      const messages: LLMMessage[] = [];
      if (options?.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUri } },
        ],
      });

      const res = await llmProvider.chat({
        messages,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      });
      return res.text ?? '';
    },
  };

  const plugins: PluginsAPI = {
    list: makeStubAsync('plugins.list') as PluginsAPI['list'],
    call: makeStubAsync('plugins.call') as PluginsAPI['call'],
  };

  return {
    storage,
    config: configApi,
    logger,
    events,
    notifications,
    sessions,
    memory,
    http,
    llm,
    plugins,
  };
}
