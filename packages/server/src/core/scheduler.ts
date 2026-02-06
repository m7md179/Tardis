import { ServerConfig } from '../config';
import { TimeWindowMonitor } from './time-window-monitor';
import { AutoRescheduler } from './rescheduler';

/**
 * Background scheduler for automated tasks
 */
export async function startScheduler(config: ServerConfig) {
  console.log('Starting background scheduler...');

  const timeWindowMonitor = new TimeWindowMonitor(config);
  const autoRescheduler = new AutoRescheduler(config);

  // Time window monitoring (every 1 minute)
  const monitorInterval = setInterval(async () => {
    try {
      await timeWindowMonitor.check();
    } catch (error) {
      console.error('Time window check failed:', error);
    }
  }, config.scheduler.timeWindowCheckInterval * 1000);

  console.log(
    `Time window monitor running (every ${config.scheduler.timeWindowCheckInterval}s)`
  );

  // Auto-reschedule (daily at 11:59 PM)
  const scheduleDaily = () => {
    const now = new Date();
    const tonight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0, 0);

    if (tonight < now) {
      // If it's already past 11:59 PM, schedule for tomorrow
      tonight.setDate(tonight.getDate() + 1);
    }

    const timeUntil = tonight.getTime() - now.getTime();

    console.log(`Auto-reschedule scheduled for ${tonight.toLocaleString()}`);

    setTimeout(async () => {
      try {
        await autoRescheduler.rescheduleUnfinished();
        console.log('Auto-reschedule completed');
      } catch (error) {
        console.error('Auto-reschedule failed:', error);
      }

      // Schedule next day
      scheduleDaily();
    }, timeUntil);
  };

  scheduleDaily();

  console.log('Background scheduler started successfully');

  // Cleanup on shutdown
  process.on('SIGTERM', () => {
    clearInterval(monitorInterval);
    console.log('Scheduler stopped');
  });
}
