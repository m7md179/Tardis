import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { proactiveSettings, proactiveLogs } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { ProactiveTrigger } from '@tardis/shared';
import { isDuringQuietHours } from './cron-utils.js';
import { occursIn, nextRunAt, isValidSchedule, scheduleKind } from './schedule.js';

// ─── Types ───

export interface TriggerHandler {
  (): Promise<void>;
}

interface RegisteredTrigger {
  pluginName: string;
  triggerName: string;
  description: string;
  handler: TriggerHandler;
}

export interface TriggerInfo {
  pluginName: string;
  triggerName: string;
  description: string;
  enabled: boolean;
  schedule: string;
  /** Which dialect `schedule` is written in. */
  scheduleKind: 'cron' | 'rrule';
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  /**
   * Epoch ms of the next run, honouring quiet hours. Null when disabled, when
   * the rule has no future occurrence, or when quiet hours swallow every one.
   */
  nextRunAt: number | null;
}

export interface ProactiveLogEntry {
  id: string;
  pluginName: string;
  triggerName: string;
  status: 'success' | 'error';
  message: string | null;
  timestamp: number;
  durationMs: number | null;
}

// ─── ProactiveScheduler ───

export class ProactiveScheduler {
  private readonly db: TardisDB;
  private readonly handlers = new Map<string, RegisteredTrigger>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** End of the window the last tick covered, so drift cannot skip an occurrence. */
  private lastTickAt: Date | null = null;

  constructor(db: TardisDB) {
    this.db = db;
  }

  /**
   * Register all proactive triggers from a plugin.
   * Creates DB rows for new triggers, preserves existing settings.
   */
  async registerPlugin(
    pluginName: string,
    triggers: ProactiveTrigger[],
    handlerMap: Record<string, TriggerHandler>
  ): Promise<void> {
    for (const trigger of triggers) {
      const key = `${pluginName}:${trigger.name}`;
      const handler = handlerMap[trigger.handler];
      if (!handler) {
        console.warn(
          `[scheduler] Plugin "${pluginName}" declares trigger "${trigger.name}" ` +
          `with handler "${trigger.handler}" but no matching export found — skipping`
        );
        continue;
      }

      this.handlers.set(key, {
        pluginName,
        triggerName: trigger.name,
        description: trigger.description ?? '',
        handler,
      });

      // Upsert DB row — create if not exists, don't overwrite user settings
      const existing = await this.db
        .select()
        .from(proactiveSettings)
        .where(
          and(
            eq(proactiveSettings.pluginName, pluginName),
            eq(proactiveSettings.triggerName, trigger.name)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await this.db.insert(proactiveSettings).values({
          id: randomUUID(),
          pluginName,
          triggerName: trigger.name,
          enabled: trigger.defaultEnabled ? 1 : 0,
          schedule: trigger.defaultSchedule,
          nextRunAt: nextRunAt(trigger.defaultSchedule)?.getTime() ?? null,
        });
      }
    }
  }

  /**
   * Start the scheduler tick (every 60 seconds).
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Baseline before the first tick: a restart covers a zero-length window and
    // so replays nothing. Without this, a service that restarts inside a
    // scheduled minute re-sends that minute's messages every time it comes up.
    this.lastTickAt = new Date();

    this.intervalId = setInterval(() => {
      this.runScheduledTick();
    }, 60_000);
  }

  /**
   * Stop the scheduler.
   */
  /** The interval-driven tick: covers everything since the previous one. */
  private runScheduledTick(): void {
    const now = new Date();
    const since = this.lastTickAt ?? undefined;
    this.lastTickAt = now;
    this.tick(now, since).catch((err) => {
      console.error('[scheduler] Tick error:', err instanceof Error ? err.message : String(err));
    });
  }

  stop(): void {
    this.running = false;
    this.lastTickAt = null;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Run a single scheduler tick with the given time. Useful for testing.
   */
  async tickNow(now: Date = new Date()): Promise<void> {
    return this.tick(now);
  }

  /**
   * Single scheduler tick: check all enabled triggers against current time.
   */
  private async tick(now: Date = new Date(), since?: Date): Promise<void> {

    const rows = await this.db
      .select()
      .from(proactiveSettings)
      .where(eq(proactiveSettings.enabled, 1));

    for (const row of rows) {
      const key = `${row.pluginName}:${row.triggerName}`;
      const registered = this.handlers.get(key);
      if (!registered) continue;

      // Recomputed every tick, from `now`. Cheap (a handful of rows), and it
      // self-heals a stored value left stale by a crash or a clock change —
      // which matters more than the arithmetic, because a stale answer to
      // "when will you next tell me?" is a wrong answer, not a slow one.
      await this.refreshNextRun(row.id, row.schedule, now, row.quietHoursStart, row.quietHoursEnd);

      // Check quiet hours
      if (isDuringQuietHours(now, row.quietHoursStart ?? undefined, row.quietHoursEnd ?? undefined)) {
        continue;
      }

      // Check the schedule, in whichever dialect it is written
      if (!occursIn(row.schedule, now, since)) {
        continue;
      }

      // Fire handler (never let it crash the scheduler)
      const handlerStart = Date.now();
      try {
        await registered.handler();
        const durationMs = Date.now() - handlerStart;
        await this.db.insert(proactiveLogs).values({
          id: randomUUID(),
          pluginName: row.pluginName,
          triggerName: row.triggerName,
          status: 'success',
          message: null,
          timestamp: handlerStart,
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - handlerStart;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Handler "${key}" failed:`, message);
        await this.db.insert(proactiveLogs).values({
          id: randomUUID(),
          pluginName: row.pluginName,
          triggerName: row.triggerName,
          status: 'error',
          message,
          timestamp: handlerStart,
          durationMs,
        }).catch(() => {}); // don't crash scheduler on log failure
      }
    }
  }

  /** Stores when this trigger next fires, quiet hours included. */
  private async refreshNextRun(
    id: string,
    schedule: string,
    from: Date,
    quietStart: string | null,
    quietEnd: string | null
  ): Promise<void> {
    const next =
      nextRunAt(schedule, from, {
        start: quietStart ?? undefined,
        end: quietEnd ?? undefined,
      })?.getTime() ?? null;
    await this.db
      .update(proactiveSettings)
      .set({ nextRunAt: next })
      .where(eq(proactiveSettings.id, id));
  }

  // ─── Management API ───

  async listTriggers(): Promise<TriggerInfo[]> {
    const rows = await this.db.select().from(proactiveSettings);
    return rows.map((r) => {
      const key = `${r.pluginName}:${r.triggerName}`;
      const registered = this.handlers.get(key);
      return {
        pluginName: r.pluginName,
        triggerName: r.triggerName,
        description: registered?.description ?? '',
        enabled: r.enabled === 1,
        schedule: r.schedule,
        scheduleKind: scheduleKind(r.schedule),
        quietHoursStart: r.quietHoursStart,
        quietHoursEnd: r.quietHoursEnd,
        // A disabled trigger has no next run, whatever its schedule says.
        nextRunAt: r.enabled === 1 ? r.nextRunAt : null,
      };
    });
  }

  async listLogs(limit = 20, page = 1, pluginName?: string, triggerName?: string): Promise<ProactiveLogEntry[]> {
    const offset = (page - 1) * limit;
    let query = this.db
      .select()
      .from(proactiveLogs)
      .orderBy(desc(proactiveLogs.timestamp))
      .limit(limit)
      .offset(offset)
      .$dynamic();

    if (pluginName) {
      query = query.where(eq(proactiveLogs.pluginName, pluginName));
    }
    if (triggerName) {
      query = query.where(eq(proactiveLogs.triggerName, triggerName));
    }

    const rows = await query;
    return rows.map((r) => ({
      id: r.id,
      pluginName: r.pluginName,
      triggerName: r.triggerName,
      status: r.status as 'success' | 'error',
      message: r.message,
      timestamp: r.timestamp,
      durationMs: r.durationMs,
    }));
  }

  async toggleTrigger(pluginName: string, triggerName: string, enabled: boolean): Promise<boolean> {
    await this.db
      .update(proactiveSettings)
      .set({ enabled: enabled ? 1 : 0 })
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      );
    // drizzle returns the rows affected indirectly — check if trigger exists
    const check = await this.db
      .select()
      .from(proactiveSettings)
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      )
      .limit(1);
    return check.length > 0;
  }

  /**
   * Change a trigger's schedule. Accepts cron or RRULE.
   *
   * Rejects an unparseable schedule rather than storing it: `occursIn` returns
   * false on a parse failure, so a bad expression would otherwise be accepted
   * silently and then simply never fire.
   */
  async updateSchedule(
    pluginName: string,
    triggerName: string,
    schedule: string
  ): Promise<boolean> {
    if (!isValidSchedule(schedule)) return false;

    const existing = await this.db
      .select()
      .from(proactiveSettings)
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      )
      .limit(1);
    const row = existing[0];

    await this.db
      .update(proactiveSettings)
      .set({
        schedule,
        nextRunAt:
          nextRunAt(schedule, new Date(), {
            start: row?.quietHoursStart ?? undefined,
            end: row?.quietHoursEnd ?? undefined,
          })?.getTime() ?? null,
      })
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      );
    const check = await this.db
      .select()
      .from(proactiveSettings)
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      )
      .limit(1);
    return check.length > 0;
  }

  async setQuietHours(
    pluginName: string,
    triggerName: string,
    start: string | null,
    end: string | null
  ): Promise<boolean> {
    const existing = await this.db
      .select()
      .from(proactiveSettings)
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      )
      .limit(1);
    const row = existing[0];

    await this.db
      .update(proactiveSettings)
      .set({
        quietHoursStart: start,
        quietHoursEnd: end,
        // Quiet hours change which occurrence is really next — the tick skips a
        // run inside them rather than deferring it.
        nextRunAt: row
          ? (nextRunAt(row.schedule, new Date(), {
              start: start ?? undefined,
              end: end ?? undefined,
            })?.getTime() ?? null)
          : null,
      })
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      );
    const check = await this.db
      .select()
      .from(proactiveSettings)
      .where(
        and(
          eq(proactiveSettings.pluginName, pluginName),
          eq(proactiveSettings.triggerName, triggerName)
        )
      )
      .limit(1);
    return check.length > 0;
  }
}
