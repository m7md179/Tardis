import { success, error, warning } from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';
import { SessionStore } from '../storage/session-store';
import { TodoistClient } from '../todoist';
import { spinner } from '../ui';

/**
 * Manually sync completed sessions with Todoist
 */
export async function syncCommand(): Promise<void> {
  const configStore = new ConfigStore();

  if (!configStore.isTodoistConfigured()) {
    console.log(error('Todoist is not configured.'));
    console.log(`\nRun: tardis setup`);
    process.exit(1);
  }

  const store = new SessionStore();
  const archivedSessions = store.getAllArchivedSessions();

  // Find unsynced sessions that have task IDs
  const unsyncedSessions = archivedSessions.filter(
    (s) => s.taskId && !s.todoistSynced && s.status === 'COMPLETED'
  );

  if (unsyncedSessions.length === 0) {
    console.log(success('All sessions are already synced!'));
    process.exit(0);
  }

  console.log(`Found ${unsyncedSessions.length} unsynced session(s):\n`);

  unsyncedSessions.forEach((s) => {
    console.log(`  - ${s.taskName}`);
  });

  const spin = spinner(`\nSyncing ${unsyncedSessions.length} session(s)...`).start();

  try {
    const client = new TodoistClient();
    let syncedCount = 0;
    let failedCount = 0;

    for (const session of unsyncedSessions) {
      try {
        if (session.taskId) {
          await client.completeTask(session.taskId);
          session.todoistSynced = true;

          // Update the archived session
          // Note: We need to re-save it to update the sync status
          // This is a limitation of the current storage design
          syncedCount++;
        }
      } catch (err) {
        console.warn(`\nFailed to sync: ${session.taskName}`);
        failedCount++;
      }
    }

    spin.stop();

    if (syncedCount > 0) {
      console.log(success(`✓ Synced ${syncedCount} session(s) to Todoist`));
    }

    if (failedCount > 0) {
      console.log(warning(`⚠ Failed to sync ${failedCount} session(s)`));
    }
  } catch (err) {
    spin.fail('Sync failed');
    console.log(error(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
