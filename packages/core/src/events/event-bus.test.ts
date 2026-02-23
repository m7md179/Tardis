import { describe, it, expect } from 'bun:test';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  it('delivers events to all subscribers', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('test', (data: unknown) => {
      received.push(`a:${String(data)}`);
    });
    bus.on('test', (data: unknown) => {
      received.push(`b:${String(data)}`);
    });

    await bus.emit('test', 'hello');

    expect(received).toContain('a:hello');
    expect(received).toContain('b:hello');
  });

  it('does not deliver events to unrelated subscribers', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('event-a', () => {
      received.push('a');
    });
    bus.on('event-b', () => {
      received.push('b');
    });

    await bus.emit('event-a');

    expect(received).toEqual(['a']);
  });

  it('unsubscribes correctly with off()', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    const handler = () => {
      received.push('called');
    };
    bus.on('test', handler);
    await bus.emit('test');
    expect(received).toHaveLength(1);

    bus.off('test', handler);
    await bus.emit('test');
    expect(received).toHaveLength(1); // still 1 — handler was removed
  });

  it('unsubscribes via returned function', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    const unsub = bus.on('test', () => {
      received.push('called');
    });
    await bus.emit('test');
    expect(received).toHaveLength(1);

    unsub();
    await bus.emit('test');
    expect(received).toHaveLength(1);
  });

  it('error in one handler does not break other handlers', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('test', () => {
      throw new Error('handler error');
    });
    bus.on('test', () => {
      received.push('second ran');
    });

    // Should not throw
    await bus.emit('test');

    expect(received).toContain('second ran');
  });

  it('error in async handler does not break other handlers', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('test', async () => {
      throw new Error('async handler error');
    });
    bus.on('test', async () => {
      received.push('second ran');
    });

    await bus.emit('test');

    expect(received).toContain('second ran');
  });

  it('reports correct listener count', () => {
    const bus = new EventBus();
    expect(bus.listenerCount('test')).toBe(0);

    const h1 = () => {};
    const h2 = () => {};
    bus.on('test', h1);
    bus.on('test', h2);
    expect(bus.listenerCount('test')).toBe(2);

    bus.off('test', h1);
    expect(bus.listenerCount('test')).toBe(1);
  });

  it('removeAllListeners removes all handlers for a specific event', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('test', () => {
      received.push('test');
    });
    bus.on('other', () => {
      received.push('other');
    });

    bus.removeAllListeners('test');
    await bus.emit('test');
    await bus.emit('other');

    expect(received).toEqual(['other']);
  });

  it('removeAllListeners with no arg removes all subscriptions', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('a', () => {
      received.push('a');
    });
    bus.on('b', () => {
      received.push('b');
    });

    bus.removeAllListeners();
    await bus.emit('a');
    await bus.emit('b');

    expect(received).toHaveLength(0);
  });

  it('passes typed data to handlers', async () => {
    const bus = new EventBus();
    let received: { userId: string; action: string } | null = null;

    bus.on<{ userId: string; action: string }>('user:action', (data) => {
      received = data;
    });

    await bus.emit('user:action', { userId: '42', action: 'login' });

    expect(received).not.toBeNull();
    expect(received!).toEqual({ userId: '42', action: 'login' });
  });
});
