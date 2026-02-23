type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

interface Subscription {
  event: string;
  handler: EventHandler;
}

/**
 * Simple typed pub/sub event bus.
 * - Error in one handler does not break other handlers.
 * - Supports typed events via generics on emit/on.
 */
export class EventBus {
  private readonly subscriptions: Subscription[] = [];

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    const sub: Subscription = { event, handler: handler as EventHandler };
    this.subscriptions.push(sub);
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe a specific handler from an event.
   */
  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    const index = this.subscriptions.findIndex(
      (s) => s.event === event && s.handler === (handler as EventHandler),
    );
    if (index !== -1) {
      this.subscriptions.splice(index, 1);
    }
  }

  /**
   * Emit an event to all subscribers. Each handler runs independently —
   * errors in one handler are caught and logged, not propagated.
   */
  async emit<T = unknown>(event: string, data?: T): Promise<void> {
    const handlers = this.subscriptions
      .filter((s) => s.event === event)
      .map((s) => s.handler);

    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(data);
        } catch (err) {
          console.error(`[EventBus] Error in handler for event "${event}":`, err);
        }
      }),
    );
  }

  /**
   * Returns the number of active subscriptions for an event (useful for tests).
   */
  listenerCount(event: string): number {
    return this.subscriptions.filter((s) => s.event === event).length;
  }

  /**
   * Remove all subscriptions for an event (or all events if no event given).
   */
  removeAllListeners(event?: string): void {
    if (event) {
      const filtered = this.subscriptions.filter((s) => s.event !== event);
      this.subscriptions.length = 0;
      this.subscriptions.push(...filtered);
    } else {
      this.subscriptions.length = 0;
    }
  }
}
