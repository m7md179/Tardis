import { success, error, formatTaskName } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { confirm } from '../ui';

/**
 * Delete a session by task name
 */
export async function deleteCommand(taskQuery: string): Promise<void> {
  const store = new SessionStore();

  // Check active sessions first
  const activeSessions = store.getActiveSessions();
  const activeMatch = activeSessions.find(
    (s) => s.taskName.toLowerCase() === taskQuery.toLowerCase()
  );

  if (activeMatch) {
    console.log(error(`Cannot delete active session: "${activeMatch.taskName}"`));
    console.log(`\nStop the session first with: tardis stop "${activeMatch.taskName}"`);
    process.exit(1);
  }

  // Check archived sessions
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

  // Show what will be deleted
  console.log(`\nFound ${archivedMatches.length} session(s) matching "${taskQuery}":`);
  archivedMatches.forEach((s) => {
    const date = new Date(s.startTime).toLocaleDateString();
    const duration = Math.floor(s.duration / 60);
    console.log(`  - ${date}: ${s.taskName} (${duration}m)`);
  });

  // Confirm deletion
  const confirmed = await confirm(
    `\nDelete ${archivedMatches.length} session(s)?`,
    false
  );

  if (!confirmed) {
    console.log('Cancelled.');
    process.exit(0);
  }

  // Delete sessions
  const deleted = store.deleteSessionByTask(taskQuery);

  if (deleted) {
    console.log(success(`✓ Deleted ${archivedMatches.length} session(s) for: ${formatTaskName(taskQuery)}`));
  } else {
    console.log(error('Failed to delete session(s)'));
    process.exit(1);
  }
}
