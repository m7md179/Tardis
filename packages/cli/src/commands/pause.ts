import { success, error, warning, formatTaskName } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { selectTask } from '../ui';

/**
 * Pause a tracking session
 */
export async function pauseCommand(taskQuery?: string): Promise<void> {
  const store = new SessionStore();

  // Find session to pause
  let session;

  if (taskQuery) {
    try {
      session = store.getActiveSessionByTask(taskQuery);
      if (!session) {
        console.log(error(`No active session found matching "${taskQuery}"`));
        process.exit(1);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Multiple sessions')) {
        console.log(error(err.message));
        console.log('\nPlease be more specific with the task name.');
        process.exit(1);
      }
      throw err;
    }
  } else {
    // No task specified - use most recent or show picker
    const activeSessions = store.getActiveSessions().filter((s) => s.status === 'ACTIVE');

    if (activeSessions.length === 0) {
      console.log(error('No active sessions found.'));
      console.log(`\nStart a session with: tardis start "task name"`);
      process.exit(1);
    }

    if (activeSessions.length === 1) {
      session = activeSessions[0];
    } else {
      const taskList = activeSessions.map((s) => ({
        id: s.id,
        name: s.taskName,
        description: `Started: ${new Date(s.startTime).toLocaleString()}`,
      }));

      const selectedId = await selectTask('Select session to pause:', taskList);
      session = activeSessions.find((s) => s.id === selectedId);

      if (!session) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }
  }

  // Check if already paused
  if (session.status === 'PAUSED') {
    console.log(warning(`Session "${session.taskName}" is already paused.`));
    console.log(`Paused at: ${session.pausedAt ? new Date(session.pausedAt).toLocaleString() : 'unknown'}`);
    console.log(`\nUse 'tardis resume' to continue.`);
    process.exit(0);
  }

  // Pause session
  const now = new Date().toISOString();
  session.status = 'PAUSED';
  session.pausedAt = now;
  session.updatedAt = now;

  store.saveActiveSession(session);

  console.log(success('Session paused!'));
  console.log(`Task: ${formatTaskName(session.taskName)}`);
  console.log(`Paused at: ${new Date(now).toLocaleString()}`);
  console.log(`\nUse 'tardis resume' to continue.`);
}
