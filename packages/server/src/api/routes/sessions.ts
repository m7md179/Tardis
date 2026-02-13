import { Hono } from 'hono';
import { SessionManager } from '../../core/session-manager';
import { TodoistClient } from '../../integrations/todoist/client';
import { ServerConfig } from '../../config';

export function createSessionRoutes(config: ServerConfig) {
  const sessions = new Hono();
  const manager = new SessionManager();
  const todoist = new TodoistClient(config);

  sessions.get('/active', async (c) => {
    const activeSessions = await manager.getActiveSessions();
    return c.json(activeSessions);
  });

  sessions.get('/status', async (c) => {
    const taskName = c.req.query('taskName');

    const session = taskName
      ? await manager.getSessionByTask(taskName)
      : await manager.getMostRecentSession();

    if (!session) {
      return c.json({ error: 'No active session found' }, 404);
    }

    return c.json(session);
  });

  sessions.post('/start', async (c) => {
    const body = await c.req.json();
    const { taskName, taskId, timeWindow } = body;

    if (!taskName) {
      return c.json({ error: 'Task name required' }, 400);
    }

    // Check for duplicates
    const existing = await manager.getSessionByTask(taskName);
    if (existing) {
      return c.json(
        {
          error: `Task '${taskName}' already active`,
          session: existing,
        },
        409
      );
    }

    const session = await manager.startSession({
      taskName,
      taskId,
      timeWindow,
    });

    return c.json(session, 201);
  });

  sessions.post('/stop', async (c) => {
    const body = await c.req.json();
    const { sessionId, taskName, noSync } = body;

    const session = sessionId
      ? await manager.getSessionById(sessionId)
      : taskName
        ? await manager.getSessionByTask(taskName)
        : await manager.getMostRecentSession();

    if (!session) {
      return c.json({ error: 'No active session found' }, 404);
    }

    const stopped = await manager.stopSession(session.id, { sync: !noSync });

    // Complete task in Todoist
    if (!noSync && stopped.taskId) {
      try {
        await todoist.completeTask(stopped.taskId);
        stopped.todoistSynced = true;
      } catch (err) {
        console.error('Failed to complete task in Todoist:', err);
      }
    }

    return c.json(stopped);
  });

  sessions.post('/pause', async (c) => {
    const body = await c.req.json();
    const { sessionId, taskName } = body;

    const session = sessionId
      ? await manager.getSessionById(sessionId)
      : taskName
        ? await manager.getSessionByTask(taskName)
        : await manager.getMostRecentSession();

    if (!session) {
      return c.json({ error: 'No active session found' }, 404);
    }

    const paused = await manager.pauseSession(session.id);

    return c.json(paused);
  });

  sessions.post('/resume', async (c) => {
    const body = await c.req.json();
    const { sessionId, taskName } = body;

    const session = sessionId
      ? await manager.getSessionById(sessionId)
      : taskName
        ? await manager.getSessionByTask(taskName)
        : await manager.getMostRecentSession();

    if (!session) {
      return c.json({ error: 'No paused session found' }, 404);
    }

    const resumed = await manager.resumeSession(session.id);

    return c.json(resumed);
  });

  sessions.get('/history', async (c) => {
    const date = c.req.query('date');
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');

    const history = await manager.getHistory({ date, limit, offset });

    return c.json(history);
  });

  sessions.delete('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');

    await manager.deleteSession(sessionId);

    return c.json({ deleted: true });
  });

  sessions.delete('/', async (c) => {
    const body = await c.req.json();
    const { confirm } = body;

    if (confirm !== 'yes') {
      return c.json({ error: 'Confirmation required' }, 400);
    }

    const count = await manager.wipeAllSessions();

    return c.json({ deleted: count });
  });

  return sessions;
}

// Keep backward-compatible default export for existing imports
export default createSessionRoutes;
