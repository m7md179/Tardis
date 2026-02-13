import type { PluginHook } from '@tardis/shared';

type EventHandler = (data: unknown) => void | Promise<void>;

/**
 * Plugin event bus with per-plugin listener tracking.
 * Handlers run concurrently and errors are isolated per-handler.
 */
export class EventBus {
  /** Map<eventName, Map<pluginName, handlers[]>> */
  private listeners = new Map<string, Map<string, EventHandler[]>>();

  /**
   * Register an event listener for a plugin
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
   * Emit event to all listeners. Errors in individual handlers
   * are caught and logged without affecting other handlers.
   */
  async emit(eventName: string, data: unknown): Promise<void> {
    const eventListeners = this.listeners.get(eventName);
    if (!eventListeners) return;

    const promises: Promise<void>[] = [];

    for (const [pluginName, handlers] of eventListeners) {
      for (const handler of handlers) {
        promises.push(
          (async () => {
            try {
              await handler(data);
            } catch (error) {
              console.error(`[EventBus] Handler error in ${pluginName} for ${eventName}:`, error);
            }
          })()
        );
      }
    }

    await Promise.all(promises);
  }

  /**
   * Remove all listeners registered by a plugin
   */
  removeAllListeners(pluginName: string): void {
    for (const eventListeners of this.listeners.values()) {
      eventListeners.delete(pluginName);
    }
  }

  /**
   * Remove listeners for a specific event and plugin
   */
  removeListener(eventName: string, pluginName: string): void {
    const eventListeners = this.listeners.get(eventName);
    if (eventListeners) {
      eventListeners.delete(pluginName);
    }
  }

  /**
   * Check if any listeners exist for an event
   */
  hasListeners(eventName: string): boolean {
    const eventListeners = this.listeners.get(eventName);
    if (!eventListeners) return false;

    for (const handlers of eventListeners.values()) {
      if (handlers.length > 0) return true;
    }
    return false;
  }
}
