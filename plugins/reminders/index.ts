import { randomUUID } from 'crypto';
import type { PluginAPI } from '@tardis/core';

// ─── Types ───

interface Reminder {
  id: string;
  message: string;
  fireAt: number; // unix ms
  createdAt: number;
}

// ─── Plugin state ───

let api: PluginAPI;
// In-memory timers. Timers are re-created on activation from persisted storage.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Helpers ───

function reminderKey(id: string): string {
  return `reminder:${id}`;
}

async function scheduleReminder(reminder: Reminder): Promise<void> {
  const delayMs = Math.max(0, reminder.fireAt - Date.now());

  const timer = setTimeout(async () => {
    timers.delete(reminder.id);
    await api.storage.delete(reminderKey(reminder.id));
    await api.notifications.send(`⏰ Reminder: ${reminder.message}`);
  }, delayMs);

  timers.set(reminder.id, timer);
}

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;

  // Restore pending reminders from storage
  const keys = await api.storage.list('reminder:');
  let restored = 0;
  for (const key of keys) {
    const reminder = await api.storage.get<Reminder>(key);
    if (!reminder) continue;

    if (reminder.fireAt <= Date.now()) {
      // Already past due — fire immediately
      await api.storage.delete(key);
      await api.notifications.send(`⏰ Reminder (delivered late): ${reminder.message}`);
    } else {
      await scheduleReminder(reminder);
      restored++;
    }
  }

  api.logger.info(`Reminders plugin activated — ${restored} reminder(s) restored`);
};

export const onDeactivate = async (): Promise<void> => {
  // Clear all in-memory timers
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
  api.logger.info('Reminders plugin deactivated');
};

// ─── Tool execution ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'reminders.set-reminder': {
      const message = String(args['message'] ?? '').trim();
      const delayMinutes = Number(args['delayMinutes'] ?? 0);

      if (!message) return { success: false, message: 'Reminder message is required.' };
      if (delayMinutes <= 0) return { success: false, message: 'delayMinutes must be greater than 0.' };

      const now = Date.now();
      const reminder: Reminder = {
        id: randomUUID(),
        message,
        fireAt: now + delayMinutes * 60 * 1000,
        createdAt: now,
      };

      await api.storage.set(reminderKey(reminder.id), reminder);
      await scheduleReminder(reminder);

      const minutes = Math.round(delayMinutes);
      const timeDesc =
        minutes >= 60
          ? `${Math.floor(minutes / 60)}h ${minutes % 60 > 0 ? `${minutes % 60}m` : ''}`.trim()
          : `${minutes}m`;

      return {
        success: true,
        message: `Reminder set for ${timeDesc} from now.`,
        reminder: { id: reminder.id, message, fireAt: reminder.fireAt },
      };
    }

    case 'reminders.list-reminders': {
      const keys = await api.storage.list('reminder:');
      const reminders: Reminder[] = [];
      for (const key of keys) {
        const r = await api.storage.get<Reminder>(key);
        if (r) reminders.push(r);
      }

      reminders.sort((a, b) => a.fireAt - b.fireAt);

      if (reminders.length === 0) return { reminders: [], message: 'No pending reminders.' };

      const formatted = reminders.map((r) => {
        const inMinutes = Math.max(0, Math.round((r.fireAt - Date.now()) / 60000));
        return {
          id: r.id,
          message: r.message,
          fireAt: new Date(r.fireAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
          inMinutes,
          inMinutesLabel: inMinutes < 60
            ? `${inMinutes} minute(s)`
            : inMinutes < 1440
              ? `${Math.round(inMinutes / 60)} hour(s)`
              : `${Math.round(inMinutes / 1440)} day(s)`,
        };
      });
      return { reminders: formatted };
    }

    case 'reminders.cancel-reminder': {
      const id = String(args['id'] ?? '').trim();
      const reminder = await api.storage.get<Reminder>(reminderKey(id));
      if (!reminder) return { success: false, message: `No reminder found with ID "${id}".` };

      const timer = timers.get(id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(id);
      }
      await api.storage.delete(reminderKey(id));
      return { success: true, message: `Reminder cancelled: "${reminder.message}"` };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
