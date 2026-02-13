import { calculateDuration, formatDurationHuman, formatTime } from '@tardis/shared';
import { error, heading, warning } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { sessionTable } from '../ui';
import { resolveBackend } from '../session-client';

/**
 * List all active sessions
 */
export async function listCommand(): Promise<void> {
  const backend = await resolveBackend();

  let activeSessions;

  if (backend.type === 'server') {
    try {
      activeSessions = await backend.client.getActiveSessions();
    } catch (err) {
      console.log(warning('Server error, falling back to local...'));
      const store = new SessionStore();
      activeSessions = store.getActiveSessions();
    }
  } else {
    activeSessions = backend.store.getActiveSessions();
  }

  if (activeSessions.length === 0) {
    console.log(error('No active sessions.'));
    console.log(`\nStart a session with: tardis start "task name"`);
    process.exit(0);
  }

  const source = backend.type === 'server' ? ' (server)' : '';
  console.log(heading(`\nActive Sessions (${activeSessions.length})${source}`));

  const table = sessionTable();

  const now = new Date().toISOString();

  for (const session of activeSessions) {
    let duration: number;

    if (session.status === 'PAUSED' && session.pausedAt) {
      duration = calculateDuration(session.startTime, session.pausedAt);
    } else {
      duration = calculateDuration(session.startTime, now);
    }

    table.addRow({
      taskName: session.taskName,
      status: session.status,
      duration: formatDurationHuman(duration),
      startTime: formatTime(session.startTime),
    });
  }

  table.print();

  console.log('Use "tardis status <task>" for detailed status.');
  console.log('Use "tardis stop [task]" to end a session.\n');
}
