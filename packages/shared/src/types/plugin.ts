import { z } from 'zod';
import type { Session } from './session';

/**
 * Plugin permission types
 */
export const PluginPermissionSchema = z.enum([
  'sessions:read',
  'sessions:write',
  'storage:read',
  'storage:write',
  'http:external',
  'notifications:send',
  'tasks:read',
  'tasks:write',
]);
export type PluginPermission = z.infer<typeof PluginPermissionSchema>;

/**
 * Plugin hook event types
 */
export const PluginHookSchema = z.enum([
  'session:start',
  'session:stop',
  'session:pause',
  'session:resume',
  'task:sync',
  'notification:send',
]);
export type PluginHook = z.infer<typeof PluginHookSchema>;

/**
 * Plugin command definition in manifest
 */
export const PluginCommandDefSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type PluginCommandDef = z.infer<typeof PluginCommandDefSchema>;

/**
 * Plugin manifest schema (plugin.json)
 */
export const PluginManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver format (x.y.z)'),
  displayName: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  repository: z.string().url().optional(),

  tardisVersion: z.string().min(1),
  main: z.string().min(1),

  dependencies: z.record(z.string()).optional(),
  permissions: z.array(PluginPermissionSchema).default([]),
  hooks: z.array(PluginHookSchema).default([]),
  commands: z.array(PluginCommandDefSchema).default([]),

  config: z.record(z.unknown()).default({ enabled: true }),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Plugin API - provided to plugins for interacting with TARDIS
 */
export interface PluginAPI {
  /** Session management */
  sessions: {
    getActive(): Promise<Session[]>;
    getById(id: string): Promise<Session | null>;
    start(options: { taskName: string; taskId?: string }): Promise<Session>;
    stop(sessionId: string): Promise<Session>;
    pause(sessionId: string): Promise<Session>;
    resume(sessionId: string): Promise<Session>;
  };

  /** Todoist task access */
  tasks: {
    getAll(): Promise<any[]>;
    complete(taskId: string): Promise<void>;
  };

  /** Plugin-specific persistent storage */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };

  /** HTTP client for external API calls */
  http: {
    get(url: string, options?: RequestInit): Promise<Response>;
    post(url: string, body: unknown, options?: RequestInit): Promise<Response>;
    put(url: string, body: unknown, options?: RequestInit): Promise<Response>;
    delete(url: string, options?: RequestInit): Promise<Response>;
  };

  /** Send notifications via configured channels */
  notifications: {
    send(message: string): Promise<void>;
  };

  /** Plugin configuration */
  config: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): Promise<void>;
    getAll(): Record<string, unknown>;
  };

  /** Plugin-scoped logger */
  logger: {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
  };

  /** Custom event emission */
  events: {
    emit(eventName: string, data: unknown): void;
    on(eventName: string, handler: (data: unknown) => void): void;
  };
}

/**
 * Plugin interface - what a plugin module must export as default
 */
export interface TardisPlugin {
  readonly name: string;
  readonly version: string;

  /** Called when the plugin is activated */
  onActivate?(api: PluginAPI): Promise<void>;
  /** Called when the plugin is deactivated */
  onDeactivate?(): Promise<void>;

  /** Session lifecycle hooks */
  onSessionStart?(session: Session, api: PluginAPI): Promise<void>;
  onSessionStop?(session: Session, api: PluginAPI): Promise<void>;
  onSessionPause?(session: Session, api: PluginAPI): Promise<void>;
  onSessionResume?(session: Session, api: PluginAPI): Promise<void>;

  /** Task sync hook */
  onTaskSync?(tasks: unknown[], api: PluginAPI): Promise<void>;

  /** Notification hook */
  onNotificationSend?(message: string, api: PluginAPI): Promise<void>;

  /** Custom commands executable via `tardis plugin run <name> <command>` */
  commands?: Record<string, (args: string[], api: PluginAPI) => Promise<void>>;

  /** API routes (mounted under /api/plugins/<name>/) */
  routes?: Record<string, (req: Request, api: PluginAPI) => Promise<Response>>;
}

/**
 * Loaded plugin state (internal use by plugin manager)
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: TardisPlugin;
  api: PluginAPI;
}
