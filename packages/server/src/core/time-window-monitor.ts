import { ServerConfig } from '../config';
import { TodoistClient } from '../integrations/todoist/client';
import { SessionManager } from './session-manager';
import { NotificationService } from '../integrations/notifications/service';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { parseTimeWindow } from '@tardis/shared';

interface TaskWithWindow {
  id: string;
  content: string;
  description: string;
  timeWindow: {
    start: string;
    end: string;
  };
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
    const now = new Date();
    const currentTime = format(now, 'HH:mm');
    const currentDate = format(now, 'yyyy-MM-dd');

    console.log(`[Monitor] Check started at ${currentTime} (${currentDate})`);

    try {
      // Get all tasks from Todoist
      const allTasks = await this.todoistClient.getTasks();
      console.log(`[Monitor] Fetched ${allTasks.length} tasks from Todoist`);

      // Filter tasks with time windows for today
      const tasksWithWindows: TaskWithWindow[] = [];

      for (const task of allTasks) {
        if (!task.description) continue;

        // Extract time window from description
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

      console.log(`[Monitor] Found ${tasksWithWindows.length} tasks with time windows`);

      // Check each task
      for (const task of tasksWithWindows) {
        console.log(`[Monitor] Checking: "${task.content}" [${task.timeWindow.start}-${task.timeWindow.end}]`);
        await this.checkTask(task, now, currentTime, currentDate);
      }

      // Clean up old notifications
      this.cleanupNotifications(currentDate);

      console.log(`[Monitor] Check complete. Notified keys: ${this.notifiedTasks.size}`);
    } catch (error) {
      console.error('[Monitor] Time window monitor error:', error);
    }
  }

  /**
   * Check individual task
   */
  private async checkTask(
    task: TaskWithWindow,
    now: Date,
    currentTime: string,
    currentDate: string
  ) {
    const { start, end } = task.timeWindow;

    // Check if time window is starting soon (5 minutes)
    const startTime = parseISO(`${currentDate}T${start}:00`);
    const minutesUntilStart = differenceInMinutes(startTime, now);
    const startKey = `start_${currentDate}_${task.id}`;
    const alreadyNotifiedStart = this.notifiedTasks.has(startKey);

    console.log(`[Monitor]   Start: ${start} | minutesUntil: ${minutesUntilStart} | notified: ${alreadyNotifiedStart}`);

    if (minutesUntilStart > 0 && minutesUntilStart <= 5 && !alreadyNotifiedStart) {
      // Check if task is already active
      const activeSession = await this.sessionManager.getSessionByTask(task.content);

      if (!activeSession) {
        await this.notificationService.sendTimeWindowStarting(task);
        this.notifiedTasks.add(startKey);
        console.log(`[Monitor]   -> Sent START notification for: ${task.content}`);
      } else {
        console.log(`[Monitor]   -> Skipped START (session already active)`);
      }
    }

    // Check if time window is ending soon (5 minutes)
    const endTime = parseISO(`${currentDate}T${end}:00`);
    const minutesUntilEnd = differenceInMinutes(endTime, now);
    const endKey = `end_${currentDate}_${task.id}`;
    const alreadyNotifiedEnd = this.notifiedTasks.has(endKey);

    console.log(`[Monitor]   End: ${end} | minutesUntil: ${minutesUntilEnd} | notified: ${alreadyNotifiedEnd}`);

    if (minutesUntilEnd > 0 && minutesUntilEnd <= 5 && !alreadyNotifiedEnd) {
      const activeSession = await this.sessionManager.getSessionByTask(task.content);

      if (activeSession && activeSession.status === 'ACTIVE') {
        await this.notificationService.sendTimeWindowEnding(task);
        this.notifiedTasks.add(endKey);
        console.log(`[Monitor]   -> Sent END notification for: ${task.content}`);
      } else {
        console.log(`[Monitor]   -> Skipped END (no active session)`);
      }
    }

    // Check if working past time window
    const overdueKey = `overdue_${currentDate}_${task.id}`;
    const alreadyNotifiedOverdue = this.notifiedTasks.has(overdueKey);

    if (currentTime > end && !alreadyNotifiedOverdue) {
      const activeSession = await this.sessionManager.getSessionByTask(task.content);

      if (activeSession && activeSession.status === 'ACTIVE') {
        const overage = differenceInMinutes(now, endTime);
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
      // Notifications are valid only for today
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
