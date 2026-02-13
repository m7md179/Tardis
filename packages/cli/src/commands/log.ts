import { formatDurationHuman, formatDate, formatTime } from '@tardis/shared';
import { error, heading, dim, warning } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { sessionTable } from '../ui';
import { resolveBackend } from '../session-client';
import { Session } from '@tardis/shared';

/**
 * View session logs
 * @param dateOrAll - Date in YYYY-MM-DD format, "all" for all history, or undefined for today
 */
export async function logCommand(dateOrAll?: string): Promise<void> {
  const backend = await resolveBackend();

  if (backend.type === 'server') {
    try {
      const date = dateOrAll === 'all' ? undefined : dateOrAll;
      const sessions = await backend.client.getHistory(date);

      if (!sessions || sessions.length === 0) {
        const label = dateOrAll === 'all' ? '' : ` for ${dateOrAll || 'today'}`;
        console.log(error(`No session history found${label}.`));
        process.exit(0);
      }

      printSessionLog(sessions, dateOrAll, '(server)');
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.log(warning(`Server error: ${msg}. Trying local...`));
    }
  }

  // Local fallback
  const store = backend.type === 'local' ? backend.store : new SessionStore();

  if (dateOrAll === 'all') {
    const allSessions = store.getAllArchivedSessions();

    if (allSessions.length === 0) {
      console.log(error('No session history found.'));
      console.log(`\nComplete sessions with: tardis stop`);
      process.exit(0);
    }

    printSessionLog(allSessions, dateOrAll);
  } else {
    const date = dateOrAll ? new Date(dateOrAll) : new Date();

    if (isNaN(date.getTime())) {
      console.log(error(`Invalid date: "${dateOrAll}"`));
      console.log(`\nUse format: YYYY-MM-DD (e.g., 2024-01-15)`);
      console.log(`Or use "all" to see all history`);
      process.exit(1);
    }

    const sessions = store.getArchivedSessionsByDate(date);

    if (sessions.length === 0) {
      console.log(error(`No sessions found for ${formatDate(date.toISOString())}`));
      console.log(`\nTry: tardis log all`);
      process.exit(0);
    }

    const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);

    console.log(
      heading(`\nSessions for ${formatDate(date.toISOString())} (${formatDurationHuman(totalDuration)})`)
    );

    const table = sessionTable();
    for (const session of sessions) {
      table.addRow({
        taskName: session.taskName,
        status: session.status,
        duration: formatDurationHuman(session.duration),
        startTime: formatTime(session.startTime),
      });
    }
    table.print();

    console.log(dim(`Total duration: ${formatDurationHuman(totalDuration)}\n`));
  }
}

function printSessionLog(sessions: Session[], dateOrAll?: string, suffix = '') {
  // Group by date
  const byDate = new Map<string, Session[]>();

  for (const session of sessions) {
    const date = formatDate(session.startTime);
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date)!.push(session);
  }

  const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  const label = dateOrAll === 'all' ? 'All Sessions' : `Sessions`;
  console.log(heading(`\n${label} (${sessions.length} total) ${suffix}`));

  for (const date of sortedDates) {
    const dateSessions = byDate.get(date)!;
    const totalDuration = dateSessions.reduce((sum, s) => sum + s.duration, 0);

    console.log(`\n${heading(date)} (${formatDurationHuman(totalDuration)})`);

    const table = sessionTable();
    for (const session of dateSessions) {
      table.addRow({
        taskName: session.taskName,
        status: session.status,
        duration: formatDurationHuman(session.duration),
        startTime: formatTime(session.startTime),
      });
    }
    table.print();
  }

  const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
  const totalDays = byDate.size;
  console.log(`\nTotal: ${formatDurationHuman(totalDuration)} across ${totalDays} days\n`);
}
