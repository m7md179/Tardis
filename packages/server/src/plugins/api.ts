import type { PluginAPI as IPluginAPI, PluginManifest, PluginPermission } from '@tardis/shared';
import type { SessionManager } from '../core/session-manager';
import type { TodoistClient } from '../integrations/todoist/client';
import type { NotificationService } from '../integrations/notifications/service';
import type { PluginStorage } from './storage';
import type { EventBus } from './event-bus';
import type { PluginManager } from './manager';

export interface PluginAPIOptions {
  pluginName: string;
  manifest: PluginManifest;
  sessionManager: SessionManager;
  todoistClient: TodoistClient;
  notificationService: NotificationService;
  storage: PluginStorage;
  eventBus: EventBus;
  pluginManager: PluginManager;
}

/**
 * Plugin API implementation that wraps core TARDIS services
 * with permission-based access control.
 */
export function createPluginAPI(options: PluginAPIOptions): IPluginAPI {
  const {
    pluginName,
    manifest,
    sessionManager,
    todoistClient,
    notificationService,
    storage,
    eventBus,
    pluginManager,
  } = options;

  const permissions = new Set<PluginPermission>(manifest.permissions);
  const pluginConfig: Record<string, unknown> = { ...manifest.config };

  function checkPermission(required: PluginPermission): void {
    if (!permissions.has(required)) {
      throw new Error(`Plugin "${pluginName}" lacks permission: ${required}`);
    }
  }

  const api: IPluginAPI = {
    sessions: {
      async getActive() {
        checkPermission('sessions:read');
        return sessionManager.getActiveSessions();
      },
      async getById(id: string) {
        checkPermission('sessions:read');
        return sessionManager.getSessionById(id);
      },
      async start(opts) {
        checkPermission('sessions:write');
        return sessionManager.startSession(opts);
      },
      async stop(sessionId: string) {
        checkPermission('sessions:write');
        return sessionManager.stopSession(sessionId);
      },
      async pause(sessionId: string) {
        checkPermission('sessions:write');
        return sessionManager.pauseSession(sessionId);
      },
      async resume(sessionId: string) {
        checkPermission('sessions:write');
        return sessionManager.resumeSession(sessionId);
      },
    },

    tasks: {
      async getAll() {
        checkPermission('tasks:read');
        return todoistClient.getTasks();
      },
      async getById(taskId: string) {
        checkPermission('tasks:read');
        return todoistClient.getTask(taskId);
      },
      async complete(taskId: string) {
        checkPermission('tasks:write');
        return todoistClient.completeTask(taskId);
      },
      async create(content: string, description?: string, dueString?: string) {
        checkPermission('tasks:write');
        return todoistClient.createTask(content, description, dueString);
      },
      async update(taskId: string, updates: { content?: string; description?: string; due_string?: string; priority?: number }) {
        checkPermission('tasks:write');
        return todoistClient.updateTask(taskId, updates);
      },
      async delete(taskId: string) {
        checkPermission('tasks:write');
        return todoistClient.deleteTask(taskId);
      },
    },

    storage: {
      async get<T = unknown>(key: string) {
        checkPermission('storage:read');
        return storage.get<T>(key);
      },
      async set(key: string, value: unknown) {
        checkPermission('storage:write');
        return storage.set(key, value);
      },
      async delete(key: string) {
        checkPermission('storage:write');
        return storage.delete(key);
      },
      async clear() {
        checkPermission('storage:write');
        return storage.clear();
      },
    },

    http: {
      async get(url: string, opts?: RequestInit) {
        checkPermission('http:external');
        return fetch(url, { ...opts, method: 'GET' });
      },
      async post(url: string, body: unknown, opts?: RequestInit) {
        checkPermission('http:external');
        return fetch(url, {
          ...opts,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...opts?.headers },
          body: JSON.stringify(body),
        });
      },
      async put(url: string, body: unknown, opts?: RequestInit) {
        checkPermission('http:external');
        return fetch(url, {
          ...opts,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...opts?.headers },
          body: JSON.stringify(body),
        });
      },
      async delete(url: string, opts?: RequestInit) {
        checkPermission('http:external');
        return fetch(url, { ...opts, method: 'DELETE' });
      },
    },

    notifications: {
      async send(message: string) {
        checkPermission('notifications:send');
        await notificationService.send(message);
      },
    },

    config: {
      get<T = unknown>(key: string) {
        return pluginConfig[key] as T | undefined;
      },
      async set(key: string, value: unknown) {
        pluginConfig[key] = value;
        await storage.set('_plugin_config', pluginConfig);
      },
      getAll() {
        return { ...pluginConfig };
      },
    },

    logger: {
      info(message: string, ...args: unknown[]) {
        console.log(`[plugin:${pluginName}]`, message, ...args);
      },
      warn(message: string, ...args: unknown[]) {
        console.warn(`[plugin:${pluginName}]`, message, ...args);
      },
      error(message: string, ...args: unknown[]) {
        console.error(`[plugin:${pluginName}]`, message, ...args);
      },
      debug(message: string, ...args: unknown[]) {
        console.debug(`[plugin:${pluginName}]`, message, ...args);
      },
    },

    events: {
      emit(eventName: string, data: unknown) {
        eventBus.emit(`plugin:${pluginName}:${eventName}`, data);
      },
      on(eventName: string, handler: (data: unknown) => void) {
        eventBus.on(`plugin:${pluginName}:${eventName}`, pluginName, handler);
      },
    },

    plugins: {
      list() {
        return pluginManager.getAllPlugins().map((p) => ({
          name: p.manifest.name,
          displayName: p.manifest.displayName,
          commands: p.manifest.commands.map((c) => ({ name: c.name, description: c.description })),
        }));
      },
      async run(targetPlugin: string, command: string, args: string[]) {
        await pluginManager.runCommand(targetPlugin, command, args);
      },
      async runWithResult(targetPlugin: string, command: string, args: string[]) {
        return pluginManager.runCommandWithResult(targetPlugin, command, args);
      },
    },
  };

  return api;
}
