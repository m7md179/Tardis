import { calculateDuration, formatDurationHuman, formatTime } from '@tardis/shared';
import { error, heading } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { sessionTable } from '../ui';

/**
 * List all active sessions
 */
export async function listCommand(): Promise<void> {
  const store = new SessionStore();
  const activeSessions = store.getActiveSessions();

  if (activeSessions.length === 0) {
    console.log(error('No active sessions.'));
    console.log(`\nStart a session with: tardis start "task name"`);
    process.exit(0);
  }

  console.log(heading(`\nActive Sessions (${activeSessions.length})`));

  const table = sessionTable();

  const now = new Date().toISOString();

  for (const session of activeSessions) {
    let duration: number;

    if (session.status === 'PAUSED' && session.pausedAt) {
      // Show duration up to pause time
      duration = calculateDuration(session.startTime, session.pausedAt);
    } else {
      // Show current duration
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
