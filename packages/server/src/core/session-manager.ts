import { randomUUID } from 'crypto';
import { Session, SessionStatus, TimeWindow } from '@tardis/shared';
import { SessionStore } from '../storage/session-store';

export interface StartSessionOptions {
  id?: string;
  taskName: string;
  taskId?: string;
  timeWindow?: TimeWindow;
}

export interface StopSessionOptions {
  sync?: boolean;
}

export interface GetHistoryOptions {
  date?: string;
  limit?: number;
  offset?: number;
}

/**
 * Session Manager - High-level session business logic
 */
export class SessionManager {
  private store: SessionStore;

  constructor(dataDir?: string) {
    this.store = new SessionStore(dataDir);
  }

  /**
   * Start a new session
   */
  async startSession(options: StartSessionOptions): Promise<Session> {
    const now = new Date().toISOString();

    const session: Session = {
      id: options.id || randomUUID(),
      taskId: options.taskId,
      taskName: options.taskName,
      status: 'ACTIVE',
      startTime: now,
      duration: 0,
      timeWindow: options.timeWindow,
      todoistSynced: false,
      createdAt: now,
      updatedAt: now,
    };

    this.store.saveActive(session);
    return session;
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string, options: StopSessionOptions = {}): Promise<Session> {
    const session = this.store.getById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === 'COMPLETED') {
      return session;
    }

    const now = new Date().toISOString();

    // Calculate final duration
    if (session.status === 'ACTIVE') {
      const resumeTime = session.resumedAt
        ? new Date(session.resumedAt).getTime()
        : new Date(session.startTime).getTime();
      const endTime = new Date(now).getTime();
      const finalActive = Math.floor((endTime - resumeTime) / 1000);
      session.duration = session.duration + finalActive;
    }
    // If PAUSED, duration is already correct

    session.status = 'COMPLETED';
    session.endTime = now;
    session.updatedAt = now;

    // If sync option is false, mark as synced to skip auto-sync
    if (options.sync === false) {
      session.todoistSynced = true;
    }

    this.store.archive(session);
    return session;
  }

  /**
   * Pause a session
   */
  async pauseSession(sessionId: string): Promise<Session> {
    const session = this.store.getById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== 'ACTIVE') {
      throw new Error(`Session is not active: ${sessionId}`);
    }

    const now = new Date().toISOString();

    // Calculate active duration up to this point
    const resumeTime = session.resumedAt
      ? new Date(session.resumedAt).getTime()
      : new Date(session.startTime).getTime();
    const pauseTime = new Date(now).getTime();
    const activeDuration = Math.floor((pauseTime - resumeTime) / 1000);

    session.status = 'PAUSED';
    session.pausedAt = now;
    session.duration = session.duration + activeDuration;
    session.updatedAt = now;

    this.store.saveActive(session);
    return session;
  }

  /**
   * Resume a paused session
   */
  async resumeSession(sessionId: string): Promise<Session> {
    const session = this.store.getById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== 'PAUSED') {
      throw new Error(`Session is not paused: ${sessionId}`);
    }

    const now = new Date().toISOString();
    session.status = 'ACTIVE';
    session.resumedAt = now;
    session.updatedAt = now;

    this.store.saveActive(session);
    return session;
  }

  /**
   * Get all active sessions
   */
  async getActiveSessions(): Promise<Session[]> {
    return this.store.getActive();
  }

  /**
   * Get session by ID
   */
  async getSessionById(id: string): Promise<Session | null> {
    return this.store.getById(id);
  }

  /**
   * Get session by task name (fuzzy match)
   */
  async getSessionByTask(taskQuery: string): Promise<Session | null> {
    const sessions = await this.getActiveSessions();
    if (sessions.length === 0) return null;

    const query = taskQuery.trim();
    const queryLower = query.toLowerCase();

    // Exact match (case-sensitive)
    const exactMatch = sessions.find((s) => s.taskName === query);
    if (exactMatch) return exactMatch;

    // Exact match (case-insensitive)
    const exactInsensitive = sessions.filter(
      (s) => s.taskName.toLowerCase() === queryLower
    );
    if (exactInsensitive.length === 1) return exactInsensitive[0];

    // Prefix match
    const prefixMatches = sessions.filter((s) =>
      s.taskName.toLowerCase().startsWith(queryLower)
    );
    if (prefixMatches.length === 1) return prefixMatches[0];

    // Contains match
    const containsMatches = sessions.filter((s) =>
      s.taskName.toLowerCase().includes(queryLower)
    );
    if (containsMatches.length === 1) return containsMatches[0];

    return null;
  }

  /**
   * Get most recent active or paused session
   */
  async getMostRecentSession(): Promise<Session | null> {
    const sessions = await this.getActiveSessions();
    return sessions.length > 0 ? sessions[0] : null;
  }

  /**
   * Get session history
   */
  async getHistory(options: GetHistoryOptions = {}): Promise<Session[]> {
    const { date, limit = 100, offset = 0 } = options;

    let sessions: Session[];

    if (date) {
      // Specific date
      sessions = this.store.getByDate(date);
    } else {
      // All archived
      sessions = this.store.getAllArchived();
    }

    // Apply pagination
    return sessions.slice(offset, offset + limit);
  }

  /**
   * Get sessions by Todoist task ID
   */
  async getSessionsByTaskId(taskId: string): Promise<Session[]> {
    const allSessions = this.store.getAllArchived();
    return allSessions.filter((s) => s.taskId === taskId);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const deleted = this.store.delete(sessionId);
    if (!deleted) {
      throw new Error(`Session not found: ${sessionId}`);
    }
  }

  /**
   * Delete all sessions
   */
  async wipeAllSessions(): Promise<number> {
    return this.store.deleteAll();
  }

  /**
   * Mark session as synced to Todoist
   */
  async markSynced(sessionId: string): Promise<void> {
    const session = this.store.getById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.todoistSynced = true;
    session.updatedAt = new Date().toISOString();

    if (session.status === 'COMPLETED') {
      this.store.archive(session);
    } else {
      this.store.saveActive(session);
    }
  }
}
