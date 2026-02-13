import { describe, test, expect, beforeEach } from 'bun:test';
import { EventBus } from '../event-bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  test('emits event to registered handler', async () => {
    let received: unknown = null;
    bus.on('test:event', 'plugin-a', (data) => {
      received = data;
    });

    await bus.emit('test:event', { foo: 'bar' });
    expect(received).toEqual({ foo: 'bar' });
  });

  test('emits to multiple handlers on same event', async () => {
    const calls: string[] = [];

    bus.on('test:event', 'plugin-a', () => { calls.push('a'); });
    bus.on('test:event', 'plugin-b', () => { calls.push('b'); });

    await bus.emit('test:event', null);
    expect(calls).toContain('a');
    expect(calls).toContain('b');
    expect(calls.length).toBe(2);
  });

  test('multiple handlers per plugin on same event', async () => {
    let count = 0;

    bus.on('test:event', 'plugin-a', () => { count++; });
    bus.on('test:event', 'plugin-a', () => { count++; });

    await bus.emit('test:event', null);
    expect(count).toBe(2);
  });

  test('does not emit to handlers of different events', async () => {
    let called = false;
    bus.on('other:event', 'plugin-a', () => { called = true; });

    await bus.emit('test:event', null);
    expect(called).toBe(false);
  });

  test('handler error does not affect other handlers', async () => {
    const calls: string[] = [];

    bus.on('test:event', 'plugin-a', () => {
      throw new Error('plugin-a failed');
    });
    bus.on('test:event', 'plugin-b', () => {
      calls.push('b');
    });

    await bus.emit('test:event', null);
    expect(calls).toEqual(['b']);
  });

  test('async handler error does not affect other handlers', async () => {
    const calls: string[] = [];

    bus.on('test:event', 'plugin-a', async () => {
      throw new Error('async failure');
    });
    bus.on('test:event', 'plugin-b', async () => {
      calls.push('b');
    });

    await bus.emit('test:event', null);
    expect(calls).toEqual(['b']);
  });

  test('emit with no listeners does not throw', async () => {
    await bus.emit('nonexistent:event', { data: true });
    // Should not throw
  });

  test('removeAllListeners removes all handlers for a plugin', async () => {
    let called = false;

    bus.on('event-a', 'plugin-a', () => { called = true; });
    bus.on('event-b', 'plugin-a', () => { called = true; });

    bus.removeAllListeners('plugin-a');

    await bus.emit('event-a', null);
    await bus.emit('event-b', null);

    expect(called).toBe(false);
  });

  test('removeAllListeners does not affect other plugins', async () => {
    const calls: string[] = [];

    bus.on('test:event', 'plugin-a', () => { calls.push('a'); });
    bus.on('test:event', 'plugin-b', () => { calls.push('b'); });

    bus.removeAllListeners('plugin-a');

    await bus.emit('test:event', null);
    expect(calls).toEqual(['b']);
  });

  test('removeListener removes specific event for a plugin', async () => {
    const calls: string[] = [];

    bus.on('event-a', 'plugin-a', () => { calls.push('a'); });
    bus.on('event-b', 'plugin-a', () => { calls.push('b'); });

    bus.removeListener('event-a', 'plugin-a');

    await bus.emit('event-a', null);
    await bus.emit('event-b', null);

    expect(calls).toEqual(['b']);
  });

  test('hasListeners returns true when listeners exist', () => {
    bus.on('test:event', 'plugin-a', () => {});
    expect(bus.hasListeners('test:event')).toBe(true);
  });

  test('hasListeners returns false when no listeners', () => {
    expect(bus.hasListeners('test:event')).toBe(false);
  });

  test('hasListeners returns false after removing all listeners', () => {
    bus.on('test:event', 'plugin-a', () => {});
    bus.removeAllListeners('plugin-a');
    expect(bus.hasListeners('test:event')).toBe(false);
  });
});
