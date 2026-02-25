import type { PluginAPI } from '@tardis/core';
import { formatDuration } from '@tardis/shared';

// ─── Plugin state ───

let api: PluginAPI;
let longSessionThresholdMinutes = 120;

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  const threshold = await api.config.get<number>('longSessionThresholdMinutes');
  if (threshold !== null) longSessionThresholdMinutes = threshold;
  api.logger.info('Time tracker plugin activated');
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Time tracker plugin deactivated');
};

// ─── Tool execution ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'time-tracker.start': {
      const taskName = String(args['taskName'] ?? 'Unnamed task');

      // Warn if a session is already active
      const activeSessions = await api.sessions.getActive();
      const running = activeSessions.find((s) => s.status === 'active');
      if (running) {
        return {
          success: false,
          message: `Already tracking "${running.taskName}". Stop or pause it first.`,
          session: running,
        };
      }

      const session = await api.sessions.start({ taskName });
      return { success: true, message: `Started tracking "${taskName}"`, session };
    }

    case 'time-tracker.stop': {
      const sessionId = typeof args['sessionId'] === 'string' ? args['sessionId'] : null;

      let targetId = sessionId;
      if (!targetId) {
        const active = await api.sessions.getActive();
        const pick = active.find((s) => s.status === 'active') ?? active[0];
        if (!pick) return { success: false, message: 'No active or paused session to stop.' };
        targetId = pick.id;
      }

      const session = await api.sessions.stop(targetId);
      return {
        success: true,
        message: `Stopped "${session.taskName}" — tracked for ${formatDuration(session.duration ?? 0)}`,
        session,
      };
    }

    case 'time-tracker.pause': {
      const sessionId = typeof args['sessionId'] === 'string' ? args['sessionId'] : null;

      let targetId = sessionId;
      if (!targetId) {
        const active = await api.sessions.getActive();
        const running = active.find((s) => s.status === 'active');
        if (!running) return { success: false, message: 'No active session to pause.' };
        targetId = running.id;
      }

      const session = await api.sessions.pause(targetId);
      return {
        success: true,
        message: `Paused "${session.taskName}" — ${formatDuration(session.accumulatedTime)} tracked so far`,
        session,
      };
    }

    case 'time-tracker.resume': {
      const sessionId = typeof args['sessionId'] === 'string' ? args['sessionId'] : null;

      let targetId = sessionId;
      if (!targetId) {
        const active = await api.sessions.getActive();
        const paused = active.find((s) => s.status === 'paused');
        if (!paused) return { success: false, message: 'No paused session to resume.' };
        targetId = paused.id;
      }

      const session = await api.sessions.resume(targetId);
      return { success: true, message: `Resumed "${session.taskName}"`, session };
    }

    case 'time-tracker.status': {
      const active = await api.sessions.getActive();
      if (active.length === 0) return { sessions: [], message: 'No active sessions.' };

      const formatted = active.map((s) => {
        const elapsed =
          s.status === 'active'
            ? s.accumulatedTime + Math.round((Date.now() - s.startTime) / 1000)
            : s.accumulatedTime;
        return { ...s, elapsedFormatted: formatDuration(elapsed) };
      });
      return { sessions: formatted };
    }

    case 'time-tracker.history': {
      const limit = typeof args['limit'] === 'number' ? Math.min(args['limit'], 100) : 10;
      const date = typeof args['date'] === 'string' ? args['date'] : undefined;

      const sessions = await api.sessions.getHistory({ limit, date });
      if (sessions.length === 0) {
        return {
          sessions: [],
          message: date ? `No sessions on ${date}.` : 'No session history yet.',
        };
      }

      const formatted = sessions.map((s) => ({
        ...s,
        durationFormatted: formatDuration(s.duration ?? 0),
      }));
      return { sessions: formatted };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};

// ─── Proactive handlers (registered with the scheduler in Phase 5) ───

export async function checkLongSession(): Promise<void> {
  const active = await api.sessions.getActive();
  const threshold = longSessionThresholdMinutes * 60;

  for (const session of active) {
    if (session.status !== 'active') continue;
    const elapsed = session.accumulatedTime + Math.round((Date.now() - session.startTime) / 1000);
    if (elapsed > threshold) {
      await api.notifications.send(
        `⏰ You've been working on "${session.taskName}" for ${formatDuration(elapsed)}. Time for a break?`
      );
    }
  }
}

export async function sendDailySummary(): Promise<void> {
  const today = new Date().toISOString().split('T')[0]!;
  const sessions = await api.sessions.getHistory({ date: today, limit: 100 });
  if (sessions.length === 0) return;

  const totalSeconds = sessions.reduce((sum, s) => sum + (s.duration ?? 0), 0);
  const lines = sessions.map((s) => `• ${s.taskName}: ${formatDuration(s.duration ?? 0)}`);
  await api.notifications.send(
    `📊 Today's time summary:\n\n${lines.join('\n')}\n\nTotal: ${formatDuration(totalSeconds)}`
  );
}
