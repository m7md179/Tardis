import { success, error, warning, formatTaskName } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { confirm } from '../ui';
import { resolveBackend } from '../session-client';

/**
 * Delete a session by task name
 */
export async function deleteCommand(taskQuery: string): Promise<void> {
  const backend = await resolveBackend();

  if (backend.type === 'server') {
    try {
      // Server needs a session ID, so we need to find matching sessions first
      const activeSessions = await backend.client.getActiveSessions();
      const activeMatch = activeSessions.find(
        (s) => s.taskName.toLowerCase() === taskQuery.toLowerCase()
      );

      if (activeMatch) {
        console.log(error(`Cannot delete active session: "${activeMatch.taskName}"`));
        console.log(`\nStop the session first with: tardis stop "${activeMatch.taskName}"`);
        process.exit(1);
      }

      // Try to get history to find archived sessions matching the query
      const history = await backend.client.getHistory();
      const matches = history.filter(
        (s) => s.taskName.toLowerCase() === taskQuery.toLowerCase()
      );

      if (matches.length === 0) {
        console.log(error(`No session found with task name: "${taskQuery}"`));
        process.exit(1);
      }

      console.log(`\nFound ${matches.length} session(s) matching "${taskQuery}" (server):`);
      matches.forEach((s) => {
        const date = new Date(s.startTime).toLocaleDateString();
        const duration = Math.floor(s.duration / 60);
        console.log(`  - ${date}: ${s.taskName} (${duration}m)`);
      });

      const confirmed = await confirm(`\nDelete ${matches.length} session(s)?`, false);
      if (!confirmed) {
        console.log('Cancelled.');
        process.exit(0);
      }

      for (const session of matches) {
        await backend.client.deleteSession(session.id);
      }

      console.log(success(`Deleted ${matches.length} session(s) for: ${formatTaskName(taskQuery)}`));
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.log(warning(`Server error: ${msg}. Trying local...`));
    }
  }

  // Local fallback
  const store = backend.type === 'local' ? backend.store : new SessionStore();

  const activeSessions = store.getActiveSessions();
  const activeMatch = activeSessions.find(
    (s) => s.taskName.toLowerCase() === taskQuery.toLowerCase()
  );

  if (activeMatch) {
    console.log(error(`Cannot delete active session: "${activeMatch.taskName}"`));
    console.log(`\nStop the session first with: tardis stop "${activeMatch.taskName}"`);
    process.exit(1);
  }

  const allArchived = store.getAllArchivedSessions();
  const archivedMatches = allArchived.filter(
    (s) => s.taskName.toLowerCase() === taskQuery.toLowerCase()
  );

  if (archivedMatches.length === 0) {
    console.log(error(`No session found with task name: "${taskQuery}"`));
    console.log(`\nAvailable sessions:`);

    const allSessions = [...activeSessions, ...allArchived];
    const uniqueTasks = new Set(allSessions.map((s) => s.taskName));
    uniqueTasks.forEach((task) => console.log(`  - ${task}`));

    process.exit(1);
  }

  console.log(`\nFound ${archivedMatches.length} session(s) matching "${taskQuery}":`);
  archivedMatches.forEach((s) => {
    const date = new Date(s.startTime).toLocaleDateString();
    const duration = Math.floor(s.duration / 60);
    console.log(`  - ${date}: ${s.taskName} (${duration}m)`);
  });

  const confirmed = await confirm(
    `\nDelete ${archivedMatches.length} session(s)?`,
    false
  );

  if (!confirmed) {
    console.log('Cancelled.');
    process.exit(0);
  }

  const deleted = store.deleteSessionByTask(taskQuery);

  if (deleted) {
    console.log(success(`Deleted ${archivedMatches.length} session(s) for: ${formatTaskName(taskQuery)}`));
  } else {
    console.log(error('Failed to delete session(s)'));
    process.exit(1);
  }
}
