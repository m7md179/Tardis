import { calculateDuration, formatDurationHuman } from '@tardis/shared';
import { success, error, warning, formatTaskName } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { ConfigStore } from '../storage/config-store';
import { TodoistClient } from '../todoist/client';
import { spinner, selectTask } from '../ui';
import { resolveBackend } from '../session-client';

interface StopOptions {
  sync?: boolean;
}

/**
 * Stop a tracking session
 */
export async function stopCommand(taskQuery?: string, options: StopOptions = {}): Promise<void> {
  const backend = await resolveBackend();
  const { sync = true } = options;

  if (backend.type === 'server') {
    try {
      const noSync = !sync;
      const session = await backend.client.stopSession(undefined, taskQuery || undefined, noSync);

      console.log('\n' + success('Session stopped! (server)'));
      console.log(`Task: ${formatTaskName(session.taskName)}`);
      console.log(`Duration: ${formatDurationHuman(session.duration)}`);
      if (session.endTime) {
        console.log(`Ended: ${new Date(session.endTime).toLocaleString()}`);
      }
      if (session.todoistSynced) {
        console.log(success('Completed in Todoist'));
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      // If server says no active sessions, don't fall back to local
      if (msg.includes('No active session') || msg.includes('not found')) {
        console.log(error(msg));
        process.exit(1);
      }
      console.log(warning(`Server error: ${msg}. Trying local...`));
    }
  }

  // Local fallback
  const store = backend.type === 'local' ? backend.store : new SessionStore();

  // Find session to stop
  let session;

  if (taskQuery) {
    try {
      session = store.getActiveSessionByTask(taskQuery);
      if (!session) {
        console.log(error(`No active session found matching "${taskQuery}"`));
        const activeSessions = store.getActiveSessions();
        if (activeSessions.length > 0) {
          console.log(`\nActive sessions:`);
          activeSessions.forEach((s) => console.log(`  - ${s.taskName}`));
        }
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
    const activeSessions = store.getActiveSessions();

    if (activeSessions.length === 0) {
      console.log(error('No active sessions found.'));
      console.log(`\nStart a session with: tardis start "task name"`);
      process.exit(1);
    }

    if (activeSessions.length === 1) {
      session = activeSessions[0];
    } else {
      console.log(`Found ${activeSessions.length} active sessions:\n`);

      const taskList = activeSessions.map((s) => ({
        id: s.id,
        name: s.taskName,
        description: `${s.status} | Started: ${new Date(s.startTime).toLocaleString()}`,
      }));

      const selectedId = await selectTask('Select session to stop:', taskList);
      session = activeSessions.find((s) => s.id === selectedId);

      if (!session) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }
  }

  // Calculate duration
  const now = new Date().toISOString();
  const duration = calculateDuration(session.startTime, now);

  // Update session
  session.status = 'COMPLETED';
  session.endTime = now;
  session.duration = duration;
  session.updatedAt = now;

  // Sync with Todoist
  let synced = false;
  if (sync && session.taskId) {
    const configStore = new ConfigStore();
    if (configStore.isTodoistConfigured()) {
      const spin = spinner('Syncing with Todoist...').start();
      try {
        const todoist = new TodoistClient();
        await todoist.completeTask(session.taskId);
        session.todoistSynced = true;
        synced = true;
        spin.succeed('Synced to Todoist');
      } catch (err) {
        spin.fail('Failed to sync with Todoist');
        console.log(warning('Session saved locally but not synced.'));
      }
    }
  }

  // Archive session
  store.archiveSession(session);

  console.log('\n' + success('Session stopped!'));
  console.log(`Task: ${formatTaskName(session.taskName)}`);
  console.log(`Duration: ${formatDurationHuman(duration)}`);
  console.log(`Ended: ${new Date(now).toLocaleString()}`);
  if (synced) {
    console.log(success('Completed in Todoist'));
  }
}
