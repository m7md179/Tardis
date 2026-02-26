import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { createDb, migrate } from '@tardis/db';
import { ProactiveScheduler } from './scheduler.js';
import type { ProactiveTrigger } from '@tardis/shared';

function makeTestDb() {
  const path = `/tmp/tardis-scheduler-test-${randomUUID()}.db`;
  migrate(path);
  const db = createDb(path);
  return {
    db,
    cleanup() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}

const testTriggers: ProactiveTrigger[] = [
  {
    name: 'long-session-reminder',
    description: 'Remind to take a break',
    defaultSchedule: '*/15 * * * *',
    defaultEnabled: false,
    handler: 'checkLongSession',
  },
  {
    name: 'daily-summary',
    description: 'Daily time summary',
    defaultSchedule: '0 18 * * *',
    defaultEnabled: true,
    handler: 'sendDailySummary',
  },
];

describe('ProactiveScheduler', () => {
  let scheduler: ProactiveScheduler;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = makeTestDb();
    scheduler = new ProactiveScheduler(testDb.db);
    cleanup = testDb.cleanup;
  });

  afterEach(() => {
    scheduler.stop();
    cleanup();
  });

  describe('registerPlugin', () => {
    it('should register triggers with matching handlers', async () => {
      const handlers = {
        checkLongSession: async () => {},
        sendDailySummary: async () => {},
      };

      await scheduler.registerPlugin('time-tracker', testTriggers, handlers);

      const triggers = await scheduler.listTriggers();
      expect(triggers.length).toBe(2);
      expect(triggers.find((t) => t.triggerName === 'long-session-reminder')).toBeDefined();
      expect(triggers.find((t) => t.triggerName === 'daily-summary')).toBeDefined();
    });

    it('should preserve default enabled state', async () => {
      const handlers = {
        checkLongSession: async () => {},
        sendDailySummary: async () => {},
      };

      await scheduler.registerPlugin('time-tracker', testTriggers, handlers);

      const triggers = await scheduler.listTriggers();
      const reminder = triggers.find((t) => t.triggerName === 'long-session-reminder')!;
      const summary = triggers.find((t) => t.triggerName === 'daily-summary')!;
      expect(reminder.enabled).toBe(false);
      expect(summary.enabled).toBe(true);
    });

    it('should skip triggers with missing handler exports', async () => {
      const handlers = {
        checkLongSession: async () => {},
        // sendDailySummary is missing
      };

      await scheduler.registerPlugin('time-tracker', testTriggers, handlers);

      const triggers = await scheduler.listTriggers();
      expect(triggers.length).toBe(1);
      expect(triggers[0]!.triggerName).toBe('long-session-reminder');
    });

    it('should not overwrite existing settings on re-register', async () => {
      const handlers = {
        checkLongSession: async () => {},
        sendDailySummary: async () => {},
      };

      await scheduler.registerPlugin('time-tracker', testTriggers, handlers);

      // Toggle the reminder on
      await scheduler.toggleTrigger('time-tracker', 'long-session-reminder', true);

      // Re-register (simulate restart)
      await scheduler.registerPlugin('time-tracker', testTriggers, handlers);

      const triggers = await scheduler.listTriggers();
      const reminder = triggers.find((t) => t.triggerName === 'long-session-reminder')!;
      expect(reminder.enabled).toBe(true); // user's setting preserved
    });
  });

  describe('toggleTrigger', () => {
    it('should enable/disable a trigger', async () => {
      const handlers = { checkLongSession: async () => {} };
      await scheduler.registerPlugin('time-tracker', [testTriggers[0]!], handlers);

      await scheduler.toggleTrigger('time-tracker', 'long-session-reminder', true);
      let triggers = await scheduler.listTriggers();
      expect(triggers[0]!.enabled).toBe(true);

      await scheduler.toggleTrigger('time-tracker', 'long-session-reminder', false);
      triggers = await scheduler.listTriggers();
      expect(triggers[0]!.enabled).toBe(false);
    });

    it('should return false for non-existent trigger', async () => {
      const found = await scheduler.toggleTrigger('nope', 'nope', true);
      expect(found).toBe(false);
    });
  });

  describe('updateSchedule', () => {
    it('should update cron schedule', async () => {
      const handlers = { checkLongSession: async () => {} };
      await scheduler.registerPlugin('time-tracker', [testTriggers[0]!], handlers);

      await scheduler.updateSchedule('time-tracker', 'long-session-reminder', '*/30 * * * *');

      const triggers = await scheduler.listTriggers();
      expect(triggers[0]!.schedule).toBe('*/30 * * * *');
    });
  });

  describe('setQuietHours', () => {
    it('should set quiet hours', async () => {
      const handlers = { checkLongSession: async () => {} };
      await scheduler.registerPlugin('time-tracker', [testTriggers[0]!], handlers);

      await scheduler.setQuietHours('time-tracker', 'long-session-reminder', '22:00', '08:00');

      const triggers = await scheduler.listTriggers();
      expect(triggers[0]!.quietHoursStart).toBe('22:00');
      expect(triggers[0]!.quietHoursEnd).toBe('08:00');
    });

    it('should clear quiet hours with null', async () => {
      const handlers = { checkLongSession: async () => {} };
      await scheduler.registerPlugin('time-tracker', [testTriggers[0]!], handlers);

      await scheduler.setQuietHours('time-tracker', 'long-session-reminder', '22:00', '08:00');
      await scheduler.setQuietHours('time-tracker', 'long-session-reminder', null, null);

      const triggers = await scheduler.listTriggers();
      expect(triggers[0]!.quietHoursStart).toBeNull();
      expect(triggers[0]!.quietHoursEnd).toBeNull();
    });
  });

  describe('start/stop', () => {
    it('should start and stop without errors', () => {
      scheduler.start();
      // start again should be a no-op
      scheduler.start();
      scheduler.stop();
    });
  });

  // ─── Trigger firing ────────────────────────────────────────────────────

  describe('tick (trigger firing)', () => {
    it('should fire an enabled every-minute trigger when ticked at the right time', async () => {
      let fired = 0;
      const handlers = {
        myHandler: async () => { fired++; },
      };

      const trigger: ProactiveTrigger = {
        name: 'every-minute',
        description: 'Fires every minute',
        defaultSchedule: '* * * * *', // every minute
        defaultEnabled: true,
        handler: 'myHandler',
      };

      await scheduler.registerPlugin('test-plugin', [trigger], handlers);

      // Tick at an arbitrary time — every-minute cron always matches
      await scheduler.tickNow(new Date('2026-03-01T12:00:00'));

      expect(fired).toBe(1);
    });

    it('should NOT fire a disabled trigger', async () => {
      let fired = 0;
      const handlers = {
        myHandler: async () => { fired++; },
      };

      const trigger: ProactiveTrigger = {
        name: 'disabled-trigger',
        description: 'Disabled by default',
        defaultSchedule: '* * * * *',
        defaultEnabled: false, // disabled
        handler: 'myHandler',
      };

      await scheduler.registerPlugin('test-plugin', [trigger], handlers);

      await scheduler.tickNow(new Date('2026-03-01T12:00:00'));

      expect(fired).toBe(0);
    });

    it('should NOT fire during quiet hours', async () => {
      let fired = 0;
      const handlers = {
        myHandler: async () => { fired++; },
      };

      const trigger: ProactiveTrigger = {
        name: 'quiet-test',
        description: 'Test quiet hours',
        defaultSchedule: '* * * * *', // every minute
        defaultEnabled: true,
        handler: 'myHandler',
      };

      await scheduler.registerPlugin('test-plugin', [trigger], handlers);

      // Set quiet hours from 22:00 to 08:00
      await scheduler.setQuietHours('test-plugin', 'quiet-test', '22:00', '08:00');

      // Tick at 23:00 — inside quiet hours → should NOT fire
      await scheduler.tickNow(new Date('2026-03-01T23:00:00'));
      expect(fired).toBe(0);

      // Tick at 03:00 — still inside quiet hours (midnight wrap) → should NOT fire
      await scheduler.tickNow(new Date('2026-03-02T03:00:00'));
      expect(fired).toBe(0);

      // Tick at 12:00 — outside quiet hours → SHOULD fire
      await scheduler.tickNow(new Date('2026-03-01T12:00:00'));
      expect(fired).toBe(1);
    });

    it('should fire a trigger scheduled at a specific time only at that time', async () => {
      let fired = 0;
      const handlers = {
        myHandler: async () => { fired++; },
      };

      const trigger: ProactiveTrigger = {
        name: 'daily-6pm',
        description: 'Fires at 18:00 daily',
        defaultSchedule: '0 18 * * *',
        defaultEnabled: true,
        handler: 'myHandler',
      };

      await scheduler.registerPlugin('test-plugin', [trigger], handlers);

      // Tick at 12:00 — should NOT fire
      await scheduler.tickNow(new Date('2026-03-01T12:00:00'));
      expect(fired).toBe(0);

      // Tick at 18:00 — should fire
      await scheduler.tickNow(new Date('2026-03-01T18:00:00'));
      expect(fired).toBe(1);

      // Tick at 18:01 — should NOT fire again
      await scheduler.tickNow(new Date('2026-03-01T18:01:30'));
      expect(fired).toBe(1);
    });

    it('should not crash if a handler throws', async () => {
      const handlers = {
        badHandler: async () => { throw new Error('handler exploded'); },
      };

      const trigger: ProactiveTrigger = {
        name: 'crasher',
        description: 'Always throws',
        defaultSchedule: '* * * * *',
        defaultEnabled: true,
        handler: 'badHandler',
      };

      await scheduler.registerPlugin('test-plugin', [trigger], handlers);

      // Should not throw
      await scheduler.tickNow(new Date('2026-03-01T12:00:00'));
    });
  });
});
