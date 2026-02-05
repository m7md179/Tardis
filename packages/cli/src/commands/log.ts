import { formatDurationHuman, formatDate, formatTime } from '@tardis/shared';
import { error, heading, dim } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { sessionTable } from '../ui';

/**
 * View session logs
 * @param dateOrAll - Date in YYYY-MM-DD format, "all" for all history, or undefined for today
 */
export async function logCommand(dateOrAll?: string): Promise<void> {
  const store = new SessionStore();

  if (dateOrAll === 'all') {
    // Show all archived sessions
    const allSessions = store.getAllArchivedSessions();

    if (allSessions.length === 0) {
      console.log(error('No session history found.'));
      console.log(`\nComplete sessions with: tardis stop`);
      process.exit(0);
    }

    console.log(heading(`\nAll Sessions (${allSessions.length} total)`));

    // Group by date
    const byDate = new Map<string, typeof allSessions>();

    for (const session of allSessions) {
      const date = formatDate(session.startTime);
      if (!byDate.has(date)) {
        byDate.set(date, []);
      }
      byDate.get(date)!.push(session);
    }

    // Sort dates (newest first)
    const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

    for (const date of sortedDates) {
      const sessions = byDate.get(date)!;
      const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);

      console.log(`\n${heading(date)} (${formatDurationHuman(totalDuration)})`);

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
    }

    // Show summary
    const totalDuration = allSessions.reduce((sum, s) => sum + s.duration, 0);
    const totalDays = byDate.size;
    console.log(`\nTotal: ${formatDurationHuman(totalDuration)} across ${totalDays} days\n`);
  } else {
    // Show specific date or today
    const date = dateOrAll ? new Date(dateOrAll) : new Date();

    // Validate date
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
