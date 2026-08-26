import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { proactiveSettings, proactiveLogs } from '@tardis/db';
import type { TardisDB } from '@tardis/db';
import type { ProactiveTrigger } from '@tardis/shared';
import { isTimeToRun, isDuringQuietHours } from './cron-utils.js';

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
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
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

      // Check quiet hours
      if (isDuringQuietHours(now, row.quietHoursStart ?? undefined, row.quietHoursEnd ?? undefined)) {
        continue;
      }

      // Check cron schedule
      if (!isTimeToRun(row.schedule, now, since)) {
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
        quietHoursStart: r.quietHoursStart,
        quietHoursEnd: r.quietHoursEnd,
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

  async updateSchedule(
    pluginName: string,
    triggerName: string,
    schedule: string
  ): Promise<boolean> {
    await this.db
      .update(proactiveSettings)
      .set({ schedule })
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
    await this.db
      .update(proactiveSettings)
      .set({ quietHoursStart: start, quietHoursEnd: end })
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
