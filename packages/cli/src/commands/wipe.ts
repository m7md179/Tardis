import { success, error, warning, heading } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { confirm, input } from '../ui';
import { resolveBackend } from '../session-client';

/**
 * Delete all sessions (requires confirmation)
 */
export async function wipeCommand(): Promise<void> {
  const backend = await resolveBackend();

  if (backend.type === 'server') {
    try {
      console.log(heading('\n WARNING: This will delete ALL session data on the server'));
      console.log('\n' + warning('This action CANNOT be undone!'));

      const firstConfirm = await confirm('\nAre you sure you want to delete ALL sessions?', false);
      if (!firstConfirm) {
        console.log('Cancelled.');
        process.exit(0);
      }

      console.log('\n' + warning('Please type "DELETE ALL" to confirm:'));
      const confirmation = await input('Type DELETE ALL to confirm');

      if (confirmation.trim() !== 'DELETE ALL') {
        console.log(error('Confirmation failed. Cancelling.'));
        process.exit(0);
      }

      const result = await backend.client.wipeAllSessions();
      console.log('\n' + success(`Deleted ${result.deleted} session(s) (server)`));
      console.log('All session data has been removed.');
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.log(warning(`Server error: ${msg}. Trying local...`));
    }
  }

  // Local fallback
  const store = backend.type === 'local' ? backend.store : new SessionStore();

  const activeSessions = store.getActiveSessions();
  const archivedSessions = store.getAllArchivedSessions();
  const totalSessions = activeSessions.length + archivedSessions.length;

  if (totalSessions === 0) {
    console.log(error('No sessions to delete.'));
    process.exit(0);
  }

  console.log(heading('\n WARNING: This will delete ALL session data'));
  console.log(`\nYou have:`);
  console.log(`  - ${activeSessions.length} active session(s)`);
  console.log(`  - ${archivedSessions.length} archived session(s)`);
  console.log(`  - ${totalSessions} total session(s)`);

  console.log('\n' + warning('This action CANNOT be undone!'));

  const firstConfirm = await confirm('\nAre you sure you want to delete ALL sessions?', false);
  if (!firstConfirm) {
    console.log('Cancelled.');
    process.exit(0);
  }

  console.log('\n' + warning('Please type "DELETE ALL" to confirm:'));
  const confirmation = await input('Type DELETE ALL to confirm');

  if (confirmation.trim() !== 'DELETE ALL') {
    console.log(error('Confirmation failed. Cancelling.'));
    process.exit(0);
  }

  const finalConfirm = await confirm(
    `\nFinal confirmation: Delete ${totalSessions} sessions?`,
    false
  );

  if (!finalConfirm) {
    console.log('Cancelled.');
    process.exit(0);
  }

  const deletedCount = store.wipeAllSessions();

  console.log('\n' + success(`Deleted ${deletedCount} session(s)`));
  console.log('All session data has been removed.');
}
