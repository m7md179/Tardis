import type { PluginAPI } from '@tardis/core';

// ─── Types ───

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

interface GoogleEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; responseStatus: string }[];
  htmlLink: string;
}

// ─── Constants ───

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

// ─── Plugin state ───

let api: PluginAPI;
let clientId = '';
let clientSecret = '';

// ─── Lifecycle ───

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  const id = await api.config.get<string>('clientId');
  const secret = await api.config.get<string>('clientSecret');
  if (id) clientId = id;
  if (secret) clientSecret = secret;

  // Check storage as fallback
  if (!clientId) {
    const stored = await api.storage.get<string>('clientId');
    if (stored) clientId = stored;
  }
  if (!clientSecret) {
    const stored = await api.storage.get<string>('clientSecret');
    if (stored) clientSecret = stored;
  }

  api.logger.info(
    `Google Calendar plugin activated${clientId ? '' : ' (OAuth not configured — run setup-oauth)'}`
  );
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Google Calendar plugin deactivated');
};

// ─── OAuth helpers ───

function assertOAuthConfig(): void {
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google Calendar OAuth not configured. Run google-calendar.setup-oauth to begin.'
    );
  }
}

async function getTokens(): Promise<OAuthTokens | null> {
  return api.storage.get<OAuthTokens>('oauth_tokens');
}

async function refreshAccessToken(tokens: OAuthTokens): Promise<OAuthTokens> {
  const res = await api.http.post(
    TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const updated: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000, // 1 min buffer
  };
  await api.storage.set('oauth_tokens', updated);
  return updated;
}

async function getValidAccessToken(): Promise<string> {
  assertOAuthConfig();
  let tokens = await getTokens();
  if (!tokens) {
    throw new Error(
      'Google Calendar not authorized. Run google-calendar.setup-oauth to connect your account.'
    );
  }
  if (Date.now() >= tokens.expiresAt) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens.accessToken;
}

// ─── Calendar helpers ───

function toRFC3339Date(dateStr: string): string {
  return dateStr;
}

/** Resolve natural language dates to YYYY-MM-DD. */
function resolveDate(dateArg: string): string {
  const d = dateArg.toLowerCase().trim();
  if (d === 'today') return new Date().toISOString().split('T')[0]!;
  if (d === 'tomorrow') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0]!;
  }
  return dateArg;
}

/** Add one hour to HH:MM, wrapping at 23:59. */
function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  if (h >= 23) return '23:59';
  return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

  // Returns YYYY-MM-DD for all-day or YYYY-MM-DDTHH:MM:SS for timed
  return dateStr;
}

function formatEvent(event: GoogleEvent): string {
  const start = event.start.dateTime
    ? new Date(event.start.dateTime).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
    : 'All day';
  const end = event.end.dateTime
    ? new Date(event.end.dateTime).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const time = end ? `${start}–${end}` : start;
  return `• ${event.summary} (${time})${event.location ? ` @ ${event.location}` : ''}`;
}

// ─── Tool execution ───

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'google-calendar.list-events': {
      const token = await getValidAccessToken();

      // Determine date range
      let startDate: Date;
      const dateArg = typeof args['date'] === 'string' ? args['date'] : null;
      if (!dateArg || dateArg === 'today') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
      } else if (dateArg === 'tomorrow') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(0, 0, 0, 0);
      } else {
        startDate = new Date(dateArg + 'T00:00:00');
      }

      const days = typeof args['days'] === 'number' ? args['days'] : 1;
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + days);

      const maxResults = typeof args['maxResults'] === 'number' ? args['maxResults'] : 10;
      const params = new URLSearchParams({
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        maxResults: String(maxResults),
        singleEvents: 'true',
        orderBy: 'startTime',
      });

      const res = await api.http.get(
        `${CALENDAR_BASE}/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Google Calendar API error: ${res.status}`);
      const data = (await res.json()) as { items?: GoogleEvent[] };
      const events = data.items ?? [];

      if (events.length === 0) {
        const label = dateArg ?? 'today';
        return { events: [], message: `No events on ${label}.` };
      }

      return {
        events: events.map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start.dateTime ?? e.start.date,
          end: e.end.dateTime ?? e.end.date,
          location: e.location,
          description: e.description,
        })),
        formatted: events.map(formatEvent).join('\n'),
      };
    }

    case 'google-calendar.create-event': {
      const token = await getValidAccessToken();

      const title = String(args['title'] ?? '').trim();
      if (!title) return { success: false, message: 'Event title is required.' };

      const date = resolveDate(String(args['date'] ?? '').trim());
      const date = String(args['date'] ?? '').trim();
      if (!date) return { success: false, message: 'Event date is required.' };

      const startTime = typeof args['startTime'] === 'string' ? args['startTime'] : null;
      const endTime = typeof args['endTime'] === 'string' ? args['endTime'] : null;

      let startObj: GoogleEvent['start'];
      let endObj: GoogleEvent['end'];

      if (startTime) {
        startObj = { dateTime: `${date}T${startTime}:00`, timeZone: 'UTC' };
        const end = endTime ?? (() => {
          const [h, m] = startTime.split(':').map(Number) as [number, number];
          return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        })();
        endObj = { dateTime: `${date}T${end}:00`, timeZone: 'UTC' };
      } else {
        // All-day event
        startObj = { date: toRFC3339Date(date) };
        const nextDay = new Date(date + 'T00:00:00');
        nextDay.setDate(nextDay.getDate() + 1);
        endObj = { date: nextDay.toISOString().split('T')[0]! };
      }

      const body: Record<string, unknown> = { summary: title, start: startObj, end: endObj };
      if (typeof args['description'] === 'string') body['description'] = args['description'];
      if (typeof args['location'] === 'string') body['location'] = args['location'];
      if (Array.isArray(args['attendees'])) {
        body['attendees'] = (args['attendees'] as string[]).map((email) => ({ email }));
      }

      const res = await api.http.post(
        `${CALENDAR_BASE}/calendars/primary/events`,
        body,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Google Calendar API error: ${res.status}`);
      const event = (await res.json()) as GoogleEvent;
      return {
        success: true,
        message: `Created event: "${event.summary}" on ${date}${startTime ? ` at ${startTime}` : ''}`,
        event: { id: event.id, summary: event.summary, start: event.start, link: event.htmlLink },
      };
    }

    case 'google-calendar.check-schedule': {
      const token = await getValidAccessToken();

      const date = resolveDate(String(args['date'] ?? '').trim());
      const startTime = String(args['startTime'] ?? '').trim();
      const endTime = String(args['endTime'] ?? '').trim() || addOneHour(startTime);
      const date = String(args['date'] ?? '').trim();
      const startTime = String(args['startTime'] ?? '').trim();
      const endTime = String(args['endTime'] ?? '').trim();

      const params = new URLSearchParams({
        timeMin: `${date}T${startTime}:00Z`,
        timeMax: `${date}T${endTime}:00Z`,
        singleEvents: 'true',
      });

      const res = await api.http.get(
        `${CALENDAR_BASE}/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Google Calendar API error: ${res.status}`);
      const data = (await res.json()) as { items?: GoogleEvent[] };
      const conflicts = data.items ?? [];

      if (conflicts.length === 0) {
        return { free: true, message: `${startTime}–${endTime} on ${date} is free.` };
      }
      return {
        free: false,
        message: `${startTime}–${endTime} on ${date} has ${conflicts.length} conflict(s):`,
        conflicts: conflicts.map((e) => e.summary),
      };
    }

    case 'google-calendar.setup-oauth': {
      assertOAuthConfig();

      // Generate the authorization URL for the user to visit
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', // out-of-band (copy-paste code)
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
      });

      const authorizationUrl = `${AUTH_URL}?${params}`;

      // Store that we're waiting for the code
      await api.storage.set('oauth_pending', true);

      return {
        success: true,
        message: `To connect Google Calendar:\n\n1. Open this URL in your browser:\n${authorizationUrl}\n\n2. Sign in and allow access\n3. Copy the authorization code\n4. Tell me: "my Google Calendar code is <code>"`,
        authorizationUrl,
      };
    }

    case 'google-calendar.exchange-code': {
      const code = String(args['code'] ?? '').trim();
      if (!code) return { success: false, message: 'Authorization code is required.' };
      await exchangeOAuthCode(code);
      return { success: true, message: 'Google Calendar connected successfully! You can now list events and create events.' };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};

// ─── OAuth code exchange (called when user provides the code) ───
// This would be called via an agent-recognized pattern or a setup command.

export async function exchangeOAuthCode(code: string): Promise<void> {
  const res = await api.http.post(
    TOKEN_URL,
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'authorization_code',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OAuth code exchange failed: ${res.status} — ${errBody}`);
  }
  if (!res.ok) throw new Error(`OAuth code exchange failed: ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
  };

  await api.storage.set('oauth_tokens', tokens);
  await api.storage.delete('oauth_pending');
  await api.notifications.send('✅ Google Calendar connected successfully!');
}
