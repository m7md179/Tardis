import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';

/**
 * Google Calendar Sync Plugin
 *
 * Syncs completed TARDIS sessions to Google Calendar as events.
 * Requires OAuth2 credentials to be configured via the `setup` command.
 *
 * Note: This plugin requires the `googleapis` npm package to be installed
 * in the plugin directory. Run `bun add googleapis` in this directory.
 */

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

async function syncSessionToCalendar(session: Session, api: PluginAPI): Promise<boolean> {
  const credentials = await api.storage.get<{
    client_id: string;
    client_secret: string;
    tokens: { access_token: string; refresh_token: string };
  }>('oauth_credentials');

  if (!credentials) {
    api.logger.warn('OAuth credentials not configured. Run: tardis plugin run google-calendar-sync setup');
    return false;
  }

  const calendarId = (api.config.get('calendarId') as string) || 'primary';

  // Create calendar event via Google Calendar API
  const event = {
    summary: session.taskName,
    description: `TARDIS Session\nDuration: ${formatDuration(session.duration)}\nSession ID: ${session.id}`,
    start: { dateTime: session.startTime },
    end: { dateTime: session.endTime },
  };

  try {
    // Refresh access token if needed
    const tokenResponse = await api.http.post(
      'https://oauth2.googleapis.com/token',
      {
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        refresh_token: credentials.tokens.refresh_token,
        grant_type: 'refresh_token',
      }
    );

    const tokenData = (await tokenResponse.json()) as { access_token: string };
    const accessToken = tokenData.access_token || credentials.tokens.access_token;

    // Insert event
    const response = await api.http.post(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      event,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Calendar API error ${response.status}: ${errorText}`);
    }

    return true;
  } catch (error) {
    api.logger.error('Failed to sync to Google Calendar:', error);
    return false;
  }
}

const plugin: TardisPlugin = {
  name: 'google-calendar-sync',
  version: '1.0.0',

  async onActivate(api: PluginAPI) {
    const credentials = await api.storage.get('oauth_credentials');
    if (!credentials) {
      api.logger.warn('Google Calendar credentials not configured');
      api.logger.info('Run: tardis plugin run google-calendar-sync setup');
    } else {
      api.logger.info('Google Calendar Sync active');
    }
  },

  async onSessionStop(session: Session, api: PluginAPI) {
    const config = api.config.getAll();
    if (!config.autoSync) {
      api.logger.debug('Auto-sync disabled, skipping');
      return;
    }

    const success = await syncSessionToCalendar(session, api);
    if (success) {
      api.logger.info(`Synced to Google Calendar: "${session.taskName}"`);

      // Track sync count
      const count = ((await api.storage.get<number>('syncCount')) ?? 0) + 1;
      await api.storage.set('syncCount', count);
      await api.storage.set('lastSyncAt', new Date().toISOString());
    }
  },

  commands: {
    async setup(args: string[], api: PluginAPI) {
      if (args.length < 2) {
        api.logger.info('Google Calendar OAuth Setup');
        api.logger.info('');
        api.logger.info('1. Go to https://console.cloud.google.com/apis/credentials');
        api.logger.info('2. Create an OAuth 2.0 Client ID (Desktop application)');
        api.logger.info('3. Run: tardis plugin run google-calendar-sync setup <client_id> <client_secret>');
        api.logger.info('');
        api.logger.info('After providing credentials, you will need to complete the OAuth flow');
        api.logger.info('to authorize TARDIS to access your Google Calendar.');

        const existing = await api.storage.get('oauth_credentials');
        if (existing) {
          api.logger.info('');
          api.logger.info('(Credentials already configured. Re-run setup to update.)');
        }
        return;
      }

      const [clientId, clientSecret] = args;

      // Store credentials (user still needs to complete OAuth flow for tokens)
      await api.storage.set('oauth_credentials', {
        client_id: clientId,
        client_secret: clientSecret,
        tokens: {},
      });

      api.logger.info('Credentials saved.');
      api.logger.info('');
      api.logger.info('Next step: Complete the OAuth flow to get access tokens.');
      api.logger.info('Visit this URL to authorize:');
      api.logger.info(
        `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=https://www.googleapis.com/auth/calendar.events&access_type=offline`
      );
      api.logger.info('');
      api.logger.info('Then run: tardis plugin run google-calendar-sync setup-token <auth_code>');
    },

    async 'setup-token'(args: string[], api: PluginAPI) {
      if (args.length < 1) {
        api.logger.error('Usage: tardis plugin run google-calendar-sync setup-token <auth_code>');
        return;
      }

      const credentials = await api.storage.get<{
        client_id: string;
        client_secret: string;
      }>('oauth_credentials');

      if (!credentials) {
        api.logger.error('Run setup first to configure client credentials.');
        return;
      }

      const [authCode] = args;

      try {
        const response = await api.http.post('https://oauth2.googleapis.com/token', {
          code: authCode,
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
          grant_type: 'authorization_code',
        });

        if (!response.ok) {
          const error = await response.text();
          api.logger.error(`Token exchange failed: ${error}`);
          return;
        }

        const tokens = await response.json();
        await api.storage.set('oauth_credentials', {
          ...credentials,
          tokens,
        });

        api.logger.info('OAuth setup complete! Sessions will now sync to Google Calendar.');
      } catch (error) {
        api.logger.error('Token exchange failed:', error);
      }
    },

    async 'sync-all'(args: string[], api: PluginAPI) {
      api.logger.info('Syncing recent sessions to Google Calendar...');

      const sessions = await api.sessions.getActive();
      let synced = 0;

      for (const session of sessions) {
        if (session.status === 'COMPLETED' && session.endTime) {
          const success = await syncSessionToCalendar(session, api);
          if (success) synced++;
        }
      }

      api.logger.info(`Synced ${synced} session(s) to Google Calendar`);
    },

    async status(args: string[], api: PluginAPI) {
      const credentials = await api.storage.get('oauth_credentials');
      const syncCount = (await api.storage.get<number>('syncCount')) ?? 0;
      const lastSync = await api.storage.get<string>('lastSyncAt');
      const config = api.config.getAll();

      api.logger.info('Google Calendar Sync Status:');
      api.logger.info(`  Configured: ${credentials ? 'Yes' : 'No'}`);
      api.logger.info(`  Auto-sync: ${config.autoSync ? 'On' : 'Off'}`);
      api.logger.info(`  Calendar ID: ${config.calendarId || 'primary'}`);
      api.logger.info(`  Total synced: ${syncCount}`);
      api.logger.info(`  Last sync: ${lastSync || 'Never'}`);
    },
  },
};

export default plugin;
