import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';

/** Active timer handles, keyed by session ID */
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

const plugin: TardisPlugin = {
  name: 'pomodoro-timer',
  version: '1.0.0',

  async onActivate(api: PluginAPI) {
    const config = api.config.getAll();
    api.logger.info(
      `Pomodoro Timer active (work: ${config.workDuration ?? 25}m, break: ${config.breakDuration ?? 5}m)`
    );
  },

  async onDeactivate() {
    // Clear all pending timers
    for (const [id, timer] of activeTimers) {
      clearTimeout(timer);
      activeTimers.delete(id);
    }
  },

  async onSessionStart(session: Session, api: PluginAPI) {
    const config = api.config.getAll();
    if (!config.autoNotify) return;

    const workMinutes = (config.workDuration as number) ?? 25;
    const breakMinutes = (config.breakDuration as number) ?? 5;

    api.logger.debug(`Scheduling Pomodoro notification in ${workMinutes}m for "${session.taskName}"`);

    const timer = setTimeout(async () => {
      activeTimers.delete(session.id);

      try {
        await api.notifications.send(
          `Pomodoro complete for "${session.taskName}"!\n` +
            `Time for a ${breakMinutes} minute break.`
        );

        // Track completion
        const completions = ((await api.storage.get<number>('totalCompletions')) ?? 0) + 1;
        await api.storage.set('totalCompletions', completions);

        const today = new Date().toISOString().split('T')[0];
        const todayCount = ((await api.storage.get<number>(`day:${today}`)) ?? 0) + 1;
        await api.storage.set(`day:${today}`, todayCount);
      } catch (error) {
        api.logger.error('Failed to send Pomodoro notification', error);
      }
    }, workMinutes * 60 * 1000);

    activeTimers.set(session.id, timer);
  },

  async onSessionStop(session: Session, api: PluginAPI) {
    // Cancel timer if session ends before Pomodoro completes
    const timer = activeTimers.get(session.id);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(session.id);
      api.logger.debug(`Cancelled Pomodoro timer for "${session.taskName}"`);
    }
  },

  commands: {
    async start(args: string[], api: PluginAPI) {
      const taskName = args.join(' ') || 'Pomodoro Session';
      const config = api.config.getAll();
      const workMinutes = (config.workDuration as number) ?? 25;

      const session = await api.sessions.start({ taskName });

      await api.notifications.send(
        `Pomodoro started: ${workMinutes} minutes\nFocus on: ${taskName}`
      );

      api.logger.info(`Pomodoro started: "${taskName}" (${workMinutes}m)`);
    },

    async config(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        const config = api.config.getAll();
        api.logger.info('Pomodoro configuration:');
        api.logger.info(`  workDuration: ${config.workDuration ?? 25} minutes`);
        api.logger.info(`  breakDuration: ${config.breakDuration ?? 5} minutes`);
        api.logger.info(`  autoNotify: ${config.autoNotify ?? true}`);
        return;
      }

      const [key, value] = args;
      if (!key || !value) {
        api.logger.error('Usage: config <key> <value>');
        api.logger.info('Keys: workDuration, breakDuration, autoNotify');
        return;
      }

      const parsed = key === 'autoNotify' ? value === 'true' : parseInt(value, 10);
      if (typeof parsed === 'number' && isNaN(parsed)) {
        api.logger.error(`Invalid value: ${value}`);
        return;
      }

      await api.config.set(key, parsed);
      api.logger.info(`Updated ${key} = ${parsed}`);
    },

    async stats(args: string[], api: PluginAPI) {
      const total = (await api.storage.get<number>('totalCompletions')) ?? 0;
      const today = new Date().toISOString().split('T')[0];
      const todayCount = (await api.storage.get<number>(`day:${today}`)) ?? 0;

      api.logger.info('Pomodoro Stats:');
      api.logger.info(`  Today: ${todayCount} pomodoros`);
      api.logger.info(`  All time: ${total} pomodoros`);
    },
  },
};

export default plugin;
