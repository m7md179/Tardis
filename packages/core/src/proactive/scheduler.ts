import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { proactiveSettings } from '@tardis/db';
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

// ─── ProactiveScheduler ───

export class ProactiveScheduler {
  private readonly db: TardisDB;
  private readonly handlers = new Map<string, RegisteredTrigger>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

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

    // Run first tick immediately
    this.tick().catch((err) => {
      console.error('[scheduler] Tick error:', err instanceof Error ? err.message : String(err));
    });

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[scheduler] Tick error:', err instanceof Error ? err.message : String(err));
      });
    }, 60_000);
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Single scheduler tick: check all enabled triggers against current time.
   */
  private async tick(): Promise<void> {
    const now = new Date();

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
      if (!isTimeToRun(row.schedule, now)) {
        continue;
      }

      // Fire handler (never let it crash the scheduler)
      try {
        await registered.handler();
      } catch (err) {
        console.error(
          `[scheduler] Handler "${key}" failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  // ─── Management API ───

  async listTriggers(): Promise<TriggerInfo[]> {
    const rows = await this.db.select().from(proactiveSettings);
    return rows.map((r) => ({
      pluginName: r.pluginName,
      triggerName: r.triggerName,
      description: '', // TODO: store description in DB or resolve from manifest
      enabled: r.enabled === 1,
      schedule: r.schedule,
      quietHoursStart: r.quietHoursStart,
      quietHoursEnd: r.quietHoursEnd,
    }));
  }

  async toggleTrigger(pluginName: string, triggerName: string, enabled: boolean): Promise<boolean> {
    const result = await this.db
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
