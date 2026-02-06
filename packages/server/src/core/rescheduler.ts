import { ServerConfig } from '../config';
import { SessionManager } from './session-manager';
import { TodoistClient } from '../integrations/todoist/client';
import { NotificationService } from '../integrations/notifications/service';
import { format, addDays } from 'date-fns';
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
 * Auto-reschedule unfinished tasks
 */
export class AutoRescheduler {
  private sessionManager: SessionManager;
  private todoistClient: TodoistClient;
  private notificationService: NotificationService;

  constructor(private config: ServerConfig) {
    this.sessionManager = new SessionManager();
    this.todoistClient = new TodoistClient(config);
    this.notificationService = new NotificationService(config);
  }

  /**
   * Reschedule all unfinished tasks to tomorrow
   */
  async rescheduleUnfinished() {
    const today = format(new Date(), 'yyyy-MM-dd');
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

    console.log(`Running auto-reschedule for ${today}...`);

    try {
      // Get all tasks from Todoist
      const allTasks = await this.todoistClient.getTasks();

      // Filter tasks with time windows for today
      const todaysTasks: TaskWithWindow[] = [];

      for (const task of allTasks) {
        if (!task.description) continue;

        // Check if task is due today
        if (task.due?.date !== today) continue;

        // Extract time window
        const matches = task.description.match(/\[([^\]]+)\]/g);
        if (!matches) continue;

        for (const match of matches) {
          const timeWindow = parseTimeWindow(match);
          if (timeWindow) {
            todaysTasks.push({
              id: task.id,
              content: task.content,
              description: task.description,
              timeWindow,
            });
            break;
          }
        }
      }

      const unfinished: TaskWithWindow[] = [];

      // Check which tasks were not completed
      for (const task of todaysTasks) {
        const sessions = await this.sessionManager.getSessionsByTaskId(task.id);
        const completed = sessions.some((s) => s.status === 'COMPLETED');

        if (!completed) {
          unfinished.push(task);
        }
      }

      console.log(`Found ${unfinished.length} unfinished tasks to reschedule`);

      // Reschedule each unfinished task
      for (const task of unfinished) {
        try {
          // Create new task for tomorrow
          const description = `${task.description}\n\n(Rescheduled from ${today})`;

          await this.todoistClient.createTask(task.content, description, 'tomorrow');

          // Mark original as complete
          await this.todoistClient.completeTask(task.id);

          console.log(`Rescheduled: ${task.content} to ${tomorrow}`);
        } catch (error) {
          console.error(`Failed to reschedule task ${task.content}:`, error);
        }
      }

      // Send summary notification
      if (unfinished.length > 0) {
        await this.notificationService.sendRescheduleSummary(unfinished, tomorrow);
      }

      console.log('Auto-reschedule completed');
    } catch (error) {
      console.error('Auto-reschedule failed:', error);
    }
  }
}
