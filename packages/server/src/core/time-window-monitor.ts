import { ServerConfig } from '../config';
import { TodoistClient } from '../integrations/todoist/client';
import { SessionManager } from './session-manager';
import { NotificationService } from '../integrations/notifications/service';
import { parseTimeWindow } from '@tardis/shared';

const TZ = 'Asia/Riyadh';

interface TaskWithWindow {
  id: string;
  content: string;
  description: string;
  timeWindow: {
    start: string;
    end: string;
  };
}

/** Get current date/time parts in the user's timezone */
function getNowInTZ(): { hours: number; minutes: number; dateStr: string; timeStr: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hours = parseInt(get('hour'));
  const minutes = parseInt(get('minute'));

  return {
    hours,
    minutes,
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  };
}

/** Parse "HH:MM" into total minutes since midnight */
function toMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Monitor time windows and send notifications
 */
export class TimeWindowMonitor {
  private todoistClient: TodoistClient;
  private sessionManager: SessionManager;
  private notificationService: NotificationService;
  private notifiedTasks: Set<string> = new Set();

  constructor(private config: ServerConfig) {
    this.todoistClient = new TodoistClient(config);
    this.sessionManager = new SessionManager();
    this.notificationService = new NotificationService(config);
  }

  /**
   * Check time windows and send notifications
   */
  async check() {
    const { hours, minutes, dateStr, timeStr } = getNowInTZ();
    const nowMinutes = hours * 60 + minutes;

    console.log(`[Monitor] Check at ${timeStr} ${TZ} (${dateStr})`);

    try {
      const allTasks = await this.todoistClient.getTasks();
      console.log(`[Monitor] Fetched ${allTasks.length} tasks from Todoist`);

      // Filter tasks with time windows that are due today
      const tasksWithWindows: TaskWithWindow[] = [];

      for (const task of allTasks) {
        if (!task.description) continue;

        // Only process tasks due today
        if (!task.due?.date || task.due.date !== dateStr) {
          continue;
        }

        const matches = task.description.match(/\[([^\]]+)\]/g);
        if (!matches) continue;

        for (const match of matches) {
          const timeWindow = parseTimeWindow(match);
          if (timeWindow) {
            tasksWithWindows.push({
              id: task.id,
              content: task.content,
              description: task.description,
              timeWindow,
            });
            break;
          }
        }
      }

      console.log(`[Monitor] Found ${tasksWithWindows.length} tasks with time windows due today`);

      for (const task of tasksWithWindows) {
        console.log(`[Monitor] Checking: "${task.content}" [${task.timeWindow.start}-${task.timeWindow.end}]`);
        await this.checkTask(task, nowMinutes, timeStr, dateStr);
      }

      this.cleanupNotifications(dateStr);

      console.log(`[Monitor] Check complete. Notified keys: ${this.notifiedTasks.size}`);
    } catch (error) {
      console.error('[Monitor] Time window monitor error:', error);
    }
  }

  /**
   * Check individual task using minutes-since-midnight arithmetic (timezone-safe)
   */
  private async checkTask(
    task: TaskWithWindow,
    nowMinutes: number,
    currentTime: string,
    currentDate: string
  ) {
    const { start, end } = task.timeWindow;
    const startMinutes = toMinutes(start);
    const endMinutes = toMinutes(end);

    // Minutes until start/end
    const minutesUntilStart = startMinutes - nowMinutes;
    const minutesUntilEnd = endMinutes - nowMinutes;

    // --- START notification (within 5 min before start) ---
    const startKey = `start_${currentDate}_${task.id}`;
    const alreadyStart = this.notifiedTasks.has(startKey);

    console.log(`[Monitor]   Start: ${start} | minutesUntil: ${minutesUntilStart} | notified: ${alreadyStart}`);

    if (minutesUntilStart > 0 && minutesUntilStart <= 5 && !alreadyStart) {
      const activeSession = await this.sessionManager.getSessionByTask(task.content);

      if (!activeSession) {
        await this.notificationService.sendTimeWindowStarting(task);
        this.notifiedTasks.add(startKey);
        console.log(`[Monitor]   -> Sent START notification for: ${task.content}`);
      } else {
        console.log(`[Monitor]   -> Skipped START (session already active)`);
      }
    }

    // --- END notification (within 5 min before end) ---
    const endKey = `end_${currentDate}_${task.id}`;
    const alreadyEnd = this.notifiedTasks.has(endKey);

    console.log(`[Monitor]   End: ${end} | minutesUntil: ${minutesUntilEnd} | notified: ${alreadyEnd}`);

    if (minutesUntilEnd > 0 && minutesUntilEnd <= 5 && !alreadyEnd) {
      const activeSession = await this.sessionManager.getSessionByTask(task.content);

      if (activeSession && activeSession.status === 'ACTIVE') {
        await this.notificationService.sendTimeWindowEnding(task);
        this.notifiedTasks.add(endKey);
        console.log(`[Monitor]   -> Sent END notification for: ${task.content}`);
      } else {
        console.log(`[Monitor]   -> Skipped END (no active session)`);
      }
    }

    // --- OVERDUE notification (past end time, still working) ---
    const overdueKey = `overdue_${currentDate}_${task.id}`;
    const alreadyOverdue = this.notifiedTasks.has(overdueKey);

    if (currentTime > end && !alreadyOverdue) {
      const activeSession = await this.sessionManager.getSessionByTask(task.content);

      if (activeSession && activeSession.status === 'ACTIVE') {
        const overage = nowMinutes - endMinutes;
        await this.notificationService.sendTaskOverdue(task, overage);
        this.notifiedTasks.add(overdueKey);
        console.log(`[Monitor]   -> Sent OVERDUE notification for: ${task.content} (${overage}m over)`);
      }
    }
  }

  /**
   * Clean up old notifications (reset daily)
   */
  private cleanupNotifications(currentDate: string) {
    const toRemove: string[] = [];

    for (const key of this.notifiedTasks) {
      if (!key.includes(currentDate)) {
        toRemove.push(key);
      }
    }

    if (toRemove.length > 0) {
      console.log(`[Monitor] Cleaning up ${toRemove.length} old notification keys`);
    }

    for (const key of toRemove) {
      this.notifiedTasks.delete(key);
    }
  }
}
