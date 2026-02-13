import { v4 as uuidv4 } from 'uuid';
import { Session } from '@tardis/shared';
import { success, error, warning, formatTaskName } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';
import { ConfigStore } from '../storage/config-store';
import { TodoistClient, matchTask, parseTask } from '../todoist';
import { spinner, selectTask } from '../ui';
import { resolveBackend } from '../session-client';

interface StartOptions {
  timeWindow?: string;
}

/**
 * Start a new tracking session
 */
export async function startCommand(taskQuery: string, options: StartOptions = {}): Promise<void> {
  const backend = await resolveBackend();

  // Check for duplicate active session
  if (backend.type === 'server') {
    try {
      const activeSessions = await backend.client.getActiveSessions();
      const existing = activeSessions.find(
        (s) => s.taskName.toLowerCase() === taskQuery.toLowerCase()
      );
      if (existing) {
        console.log(error(`Session for "${existing.taskName}" is already active.`));
        console.log(`Started: ${new Date(existing.startTime).toLocaleString()}`);
        console.log(
          `\nUse 'tardis stop "${existing.taskName}"' to end it first, or choose a different name.`
        );
        process.exit(1);
      }
    } catch (err) {
      console.log(warning('Could not check server for existing sessions, continuing...'));
    }
  } else {
    try {
      const existing = backend.store.getActiveSessionByTask(taskQuery);
      if (existing) {
        console.log(error(`Session for "${existing.taskName}" is already active.`));
        console.log(`Started: ${new Date(existing.startTime).toLocaleString()}`);
        console.log(
          `\nUse 'tardis stop "${existing.taskName}"' to end it first, or choose a different name.`
        );
        process.exit(1);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Multiple sessions')) {
        console.log(error(err.message));
        console.log('\nPlease stop one of these sessions or use a more specific name.');
        process.exit(1);
      }
    }
  }

  // Try to match with Todoist task
  const configStore = new ConfigStore();
  let taskId: string | undefined;
  let taskName = taskQuery;
  let timeWindow;

  if (configStore.isTodoistConfigured()) {
    const spin = spinner('Checking Todoist...').start();

    try {
      const todoist = new TodoistClient();
      const matches = await matchTask(todoist, taskQuery);

      if (matches.length === 0) {
        spin.warn(`No matching task found in Todoist`);
        console.log(warning('Starting session without Todoist sync.'));
      } else if (matches.length === 1) {
        spin.succeed('Matched with Todoist');
        const parsed = parseTask(matches[0].task);
        taskId = parsed.id;
        taskName = parsed.content;
        timeWindow = parsed.timeWindow;
        console.log(success(`Task: ${formatTaskName(taskName)}`));
        if (timeWindow) {
          console.log(`Time window: ${timeWindow.start} - ${timeWindow.end}`);
        }
      } else {
        spin.stop();
        console.log(warning(`Found ${matches.length} matching tasks in Todoist:`));

        const taskList = matches.map((m) => {
          const parsed = parseTask(m.task);
          return {
            id: parsed.id,
            name: parsed.content,
            description: parsed.timeWindow
              ? `[${parsed.timeWindow.start}-${parsed.timeWindow.end}]`
              : undefined,
          };
        });

        const selectedId = await selectTask('Select task:', taskList);
        const selected = matches.find((m) => m.task.id === selectedId);

        if (selected) {
          const parsed = parseTask(selected.task);
          taskId = parsed.id;
          taskName = parsed.content;
          timeWindow = parsed.timeWindow;
        }
      }
    } catch (err) {
      spin.fail('Could not connect to Todoist');
      console.log(warning('Starting session without Todoist sync.'));
    }
  }

  // Create session
  if (backend.type === 'server') {
    try {
      const session = await backend.client.startSession(taskName, taskId);
      console.log('\n' + success('Session started! (server)'));
      console.log(`Task: ${formatTaskName(session.taskName)}`);
      console.log(`Started: ${new Date(session.startTime).toLocaleString()}`);
      if (session.timeWindow) {
        console.log(`Time window: ${session.timeWindow.start} - ${session.timeWindow.end}`);
      }
      console.log(`\nUse 'tardis stop' to end this session.`);
      return;
    } catch (err) {
      console.log(warning('Server error, saving locally as fallback.'));
    }
  }

  // Local fallback
  const store = backend.type === 'local' ? backend.store : new SessionStore();
  const now = new Date().toISOString();
  const session: Session = {
    id: uuidv4(),
    taskId,
    taskName,
    status: 'ACTIVE',
    startTime: now,
    duration: 0,
    timeWindow,
    todoistSynced: false,
    createdAt: now,
    updatedAt: now,
  };

  store.saveActiveSession(session);

  console.log('\n' + success('Session started!'));
  console.log(`Task: ${formatTaskName(taskName)}`);
  console.log(`Started: ${new Date(now).toLocaleString()}`);
  if (timeWindow) {
    console.log(`Time window: ${timeWindow.start} - ${timeWindow.end}`);
  }
  console.log(`\nUse 'tardis stop' to end this session.`);
}
