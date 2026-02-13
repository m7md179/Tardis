import { ServerConfig } from '../../config';
import { TelegramNotifier } from './telegram';
import { EmailNotifier } from './email';


export class NotificationService {
  private telegram?: TelegramNotifier;
  private email?: EmailNotifier;

  constructor(private config: ServerConfig) {
    if (config.notifications.channels.telegram?.enabled) {
      this.telegram = new TelegramNotifier(config);
    }

    if (config.notifications.channels.email?.enabled) {
      this.email = new EmailNotifier(config);
    }
  }

  async sendTimeWindowStarting(task: any) {
    const message = this.formatTimeWindowStarting(task);
    await this.send(message);
  }

  async sendTimeWindowEnding(task: any) {
    const message = this.formatTimeWindowEnding(task);
    await this.send(message);
  }

  async sendTaskOverdue(task: any, minutesOver: number) {
    const message = this.formatTaskOverdue(task, minutesOver);
    await this.send(message);
  }

  async sendRescheduleSummary(tasks: any[], date: string) {
    const message = this.formatRescheduleSummary(tasks, date);
    await this.send(message);
  }

  async send(message: string) {
    const promises: Promise<void>[] = [];

    if (this.telegram) {
      promises.push(this.telegram.send(message));
    }

    if (this.email) {
      promises.push(this.email.send('TARDIS Notification', message));
    }

    try {
      await Promise.all(promises);
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  private formatTimeWindowStarting(task: any): string {
    const { start, end } = task.timeWindow;
    const duration = this.calculateDuration(start, end);

    return (
      `🕐 Time to start: "${task.content}"\n` +
      `⏰ Scheduled: ${start} - ${end} (${duration})\n\n` +
      `Start tracking: tardis start "${task.content}"`
    );
  }

  private formatTimeWindowEnding(task: any): string {
    const { end } = task.timeWindow;

    return (
      `⏰ Time window ending: "${task.content}"\n` +
      `📊 Scheduled end: ${end}\n\n` +
      `Don't forget to stop: tardis stop`
    );
  }

  private formatTaskOverdue(task: any, minutesOver: number): string {
    const { end } = task.timeWindow;

    return (
      `⚠️ Still working on: "${task.content}"\n` +
      `⏰ Scheduled end was: ${end} (${minutesOver} minutes ago)\n` +
      `📍 Consider wrapping up soon.`
    );
  }

  private formatRescheduleSummary(tasks: any[], date: string): string {
    let message = `📅 Rescheduled ${tasks.length} task(s) to ${date}:\n\n`;

    for (const task of tasks) {
      message += `• ${task.content}`;
      if (task.timeWindow) {
        message += ` [${task.timeWindow.start}-${task.timeWindow.end}]`;
      }
      message += '\n';
    }

    return message;
  }

  private calculateDuration(start: string, end: string): string {
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${minutes}m`;
    }
  }
}
