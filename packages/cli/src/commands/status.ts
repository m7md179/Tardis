import { calculateDuration, formatDurationHuman, formatDateTime } from '@tardis/shared';
import {
  success,
  error,
  warning,
  formatStatus,
  formatTaskName,
  heading,
  keyValue,
  dim,
} from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { resolveBackend } from '../session-client';

/**
 * Show status of current or specific session
 */
export async function statusCommand(taskQuery?: string): Promise<void> {
  const backend = await resolveBackend();

  if (backend.type === 'server') {
    try {
      if (taskQuery) {
        const session = await backend.client.getStatus(taskQuery);
        printSessionStatus(session);
      } else {
        const activeSessions = await backend.client.getActiveSessions();
        if (activeSessions.length === 0) {
          console.log(error('No active sessions.'));
          console.log(`\nStart a session with: tardis start "task name"`);
          process.exit(0);
        }

        console.log(heading(`\nActive Sessions (${activeSessions.length}) (server)`));
        for (const session of activeSessions) {
          console.log();
          printSessionStatus(session);
        }
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('not found') || msg.includes('No active')) {
        console.log(error(msg));
        process.exit(1);
      }
      console.log(warning(`Server error: ${msg}. Trying local...`));
    }
  }

  // Local fallback
  const store = backend.type === 'local' ? backend.store : new SessionStore();

  if (taskQuery) {
    try {
      const session = store.getActiveSessionByTask(taskQuery);
      if (!session) {
        console.log(error(`No active session found matching "${taskQuery}"`));
        process.exit(1);
      }

      printSessionStatus(session);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Multiple sessions')) {
        console.log(error(err.message));
        console.log('\nPlease be more specific with the task name.');
        process.exit(1);
      }
      throw err;
    }
  } else {
    const activeSessions = store.getActiveSessions();

    if (activeSessions.length === 0) {
      console.log(error('No active sessions.'));
      console.log(`\nStart a session with: tardis start "task name"`);
      process.exit(0);
    }

    console.log(heading(`\nActive Sessions (${activeSessions.length})`));

    for (const session of activeSessions) {
      console.log();
      printSessionStatus(session);
    }
  }
}

/**
 * Print session status details
 */
function printSessionStatus(session: any): void {
  const now = new Date().toISOString();
  const duration = calculateDuration(session.startTime, now);

  console.log(formatTaskName(session.taskName));
  console.log(keyValue('Status', formatStatus(session.status)));
  console.log(keyValue('Started', formatDateTime(session.startTime)));

  if (session.status === 'PAUSED' && session.pausedAt) {
    console.log(keyValue('Paused at', formatDateTime(session.pausedAt)));
    const activeDuration = calculateDuration(session.startTime, session.pausedAt);
    console.log(keyValue('Duration (active)', formatDurationHuman(activeDuration)));
  } else if (session.status === 'ACTIVE') {
    console.log(keyValue('Duration', formatDurationHuman(duration)));
  }

  if (session.timeWindow) {
    console.log(
      keyValue('Time window', `${session.timeWindow.start} - ${session.timeWindow.end}`)
    );
  }

  if (session.taskId) {
    console.log(dim(`Todoist: ${session.taskId}`));
  }
}
