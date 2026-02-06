import { ConfigStore } from '../storage/config-store';
import { Session } from '@tardis/shared';

/**
 * Server API client for CLI
 */
export class ServerClient {
  private baseUrl: string;
  private token?: string;
  private configStore: ConfigStore;

  constructor() {
    this.configStore = new ConfigStore();
    const config = this.configStore.load();

    this.baseUrl = config.server?.url || '';
    this.token = config.server?.token;
  }

  /**
   * Check if server is configured
   */
  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  /**
   * Authenticate with API key and get JWT
   */
  async authenticate(apiKey: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!response.ok) {
      throw new Error('Authentication failed');
    }

    const data = await response.json();
    this.token = data.token;

    // Save token to config
    const config = this.configStore.load();
    if (!config.server) {
      config.server = { url: this.baseUrl };
    }
    config.server.token = data.token;
    config.server.expiresAt = data.expiresAt;
    this.configStore.save(config);

    return data.token;
  }

  /**
   * Start a session
   */
  async startSession(taskName: string, taskId?: string): Promise<Session> {
    return this.request('POST', '/api/sessions/start', { taskName, taskId });
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId?: string, taskName?: string, noSync?: boolean): Promise<Session> {
    return this.request('POST', '/api/sessions/stop', { sessionId, taskName, noSync });
  }

  /**
   * Pause a session
   */
  async pauseSession(sessionId?: string, taskName?: string): Promise<Session> {
    return this.request('POST', '/api/sessions/pause', { sessionId, taskName });
  }

  /**
   * Resume a session
   */
  async resumeSession(sessionId?: string, taskName?: string): Promise<Session> {
    return this.request('POST', '/api/sessions/resume', { sessionId, taskName });
  }

  /**
   * Get active sessions
   */
  async getActiveSessions(): Promise<Session[]> {
    return this.request('GET', '/api/sessions/active');
  }

  /**
   * Get session status
   */
  async getStatus(taskName?: string): Promise<Session> {
    const query = taskName ? `?taskName=${encodeURIComponent(taskName)}` : '';
    return this.request('GET', `/api/sessions/status${query}`);
  }

  /**
   * Get session history
   */
  async getHistory(date?: string, limit?: number, offset?: number): Promise<Session[]> {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request('GET', `/api/sessions/history${query}`);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/api/sessions/${sessionId}`);
  }

  /**
   * Delete all sessions
   */
  async wipeAllSessions(): Promise<{ deleted: number }> {
    return this.request('DELETE', '/api/sessions', { confirm: 'yes' });
  }

  /**
   * Check if server is online
   */
  async isOnline(): Promise<boolean> {
    if (!this.baseUrl) return false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Make authenticated request
   */
  private async request(method: string, path: string, body?: any): Promise<any> {
    if (!this.baseUrl) {
      throw new Error('Server URL not configured. Run: tardis config --server-url <url>');
    }

    if (!this.token) {
      throw new Error('Not authenticated. Run: tardis config --api-key <key>');
    }

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    };

    if (body && (method === 'POST' || method === 'DELETE')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication expired. Run: tardis config --api-key <key>');
      }

      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    // Handle empty responses (like DELETE)
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}
