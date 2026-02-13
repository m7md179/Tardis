import { calculateDuration } from '@tardis/shared';
import { success, error, warning, formatTaskName } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { selectTask } from '../ui';
import { resolveBackend } from '../session-client';

/**
 * Resume a paused tracking session
 */
export async function resumeCommand(taskQuery?: string): Promise<void> {
  const backend = await resolveBackend();

  if (backend.type === 'server') {
    try {
      const session = await backend.client.resumeSession(undefined, taskQuery || undefined);
      console.log(success('Session resumed! (server)'));
      console.log(`Task: ${formatTaskName(session.taskName)}`);
      if (session.resumedAt) {
        console.log(`Resumed at: ${new Date(session.resumedAt).toLocaleString()}`);
      }
      console.log(`\nUse 'tardis stop' to end this session.`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('No paused session') || msg.includes('not found') || msg.includes('not paused')) {
        console.log(error(msg));
        process.exit(1);
      }
      console.log(warning(`Server error: ${msg}. Trying local...`));
    }
  }

  // Local fallback
  const store = backend.type === 'local' ? backend.store : new SessionStore();

  let session;

  if (taskQuery) {
    try {
      session = store.getActiveSessionByTask(taskQuery);
      if (!session) {
        console.log(error(`No session found matching "${taskQuery}"`));
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
    const pausedSessions = store.getActiveSessions().filter((s) => s.status === 'PAUSED');

    if (pausedSessions.length === 0) {
      console.log(error('No paused sessions found.'));
      console.log(`\nPause a session with: tardis pause`);
      process.exit(1);
    }

    if (pausedSessions.length === 1) {
      session = pausedSessions[0];
    } else {
      const taskList = pausedSessions.map((s) => ({
        id: s.id,
        name: s.taskName,
        description: `Paused: ${s.pausedAt ? new Date(s.pausedAt).toLocaleString() : 'unknown'}`,
      }));

      const selectedId = await selectTask('Select session to resume:', taskList);
      session = pausedSessions.find((s) => s.id === selectedId);

      if (!session) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }
  }

  if (session.status !== 'PAUSED') {
    if (session.status === 'ACTIVE') {
      console.log(warning(`Session "${session.taskName}" is already active.`));
    } else {
      console.log(warning(`Session "${session.taskName}" is ${session.status}.`));
    }
    process.exit(0);
  }

  const now = new Date().toISOString();
  let pauseDuration = 0;
  if (session.pausedAt) {
    pauseDuration = calculateDuration(session.pausedAt, now);
  }

  session.status = 'ACTIVE';
  session.resumedAt = now;
  session.pausedAt = undefined;
  session.updatedAt = now;

  store.saveActiveSession(session);

  console.log(success('Session resumed!'));
  console.log(`Task: ${formatTaskName(session.taskName)}`);
  console.log(`Resumed at: ${new Date(now).toLocaleString()}`);
  if (pauseDuration > 0) {
    console.log(`Pause duration: ${Math.floor(pauseDuration / 60)} minutes`);
  }
  console.log(`\nUse 'tardis stop' to end this session.`);
}
