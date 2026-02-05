import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import {
  Session,
  SessionSchema,
  SessionStatus,
  type TimeWindow,
} from '@tardis/shared';
import { sanitizeTaskName } from '@tardis/shared';

/**
 * Session storage manager
 * Handles CRUD operations for active and archived sessions
 */
export class SessionStore {
  private tardisDir: string;

  constructor(tardisDir?: string) {
    this.tardisDir = tardisDir || process.env.TARDIS_DIR || require('os').homedir() + '/.tardis';
    this.ensureDirectories();
    this.migrateLegacySession();
  }

  private getActiveDir(): string {
    return join(this.tardisDir, 'active_sessions');
  }

  private getSessionsDir(): string {
    return join(this.tardisDir, 'sessions');
  }

  private getLegacyFile(): string {
    return join(this.tardisDir, 'current_session.json');
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    if (!existsSync(this.tardisDir)) {
      mkdirSync(this.tardisDir, { recursive: true });
    }
    if (!existsSync(this.getActiveDir())) {
      mkdirSync(this.getActiveDir(), { recursive: true });
    }
    if (!existsSync(this.getSessionsDir())) {
      mkdirSync(this.getSessionsDir(), { recursive: true });
    }
  }

  /**
   * Migrate legacy current_session.json to new format
   */
  private migrateLegacySession(): void {
    const legacyFile = this.getLegacyFile();
    if (!existsSync(legacyFile)) {
      return;
    }

    try {
      const content = readFileSync(legacyFile, 'utf-8');
      const data = JSON.parse(content);

      // Convert from Go format to TypeScript format
      const session: Session = {
        id: data.ID || data.id || randomUUID(),
        taskId: data.TaskID || data.taskId,
        taskName: data.Task || data.taskName || 'Unknown Task',
        status: this.mapLegacyStatus(data.Status || data.status || 'COMPLETED'),
        startTime: this.convertTimestamp(data.StartTime || data.startTime),
        endTime: data.EndTime || data.endTime ? this.convertTimestamp(data.EndTime || data.endTime) : undefined,
        pausedAt: data.PausedAt || data.pausedAt ? this.convertTimestamp(data.PausedAt || data.pausedAt) : undefined,
        resumedAt: data.ResumedAt || data.resumedAt ? this.convertTimestamp(data.ResumedAt || data.resumedAt) : undefined,
        duration: data.Duration || data.duration || 0,
        timeWindow: data.TimeWindow || data.timeWindow,
        todoistSynced: data.TodoistSynced || data.todoistSynced || false,
        createdAt: this.convertTimestamp(data.CreatedAt || data.createdAt || data.StartTime || data.startTime),
        updatedAt: new Date().toISOString(),
      };

      // Create backup
      writeFileSync(legacyFile + '.backup', content, 'utf-8');

      // Save based on status
      if (session.status === 'COMPLETED') {
        this.archiveSession(session);
      } else {
        this.saveActiveSession(session);
      }

      // Remove legacy file
      unlinkSync(legacyFile);
    } catch (error) {
      // If migration fails, just continue
      console.error('Failed to migrate legacy session:', error);
    }
  }

  /**
   * Convert Go timestamp (Unix seconds) to ISO string
   */
  private convertTimestamp(timestamp: number | string): string {
    if (typeof timestamp === 'string') {
      return timestamp;
    }
    if (timestamp === 0) {
      return new Date().toISOString();
    }
    return new Date(timestamp * 1000).toISOString();
  }

  /**
   * Map legacy status to new status enum
   */
  private mapLegacyStatus(status: string): SessionStatus {
    const upperStatus = status.toUpperCase();
    if (upperStatus === 'ACTIVE' || upperStatus === 'RUNNING') {
      return 'ACTIVE';
    }
    if (upperStatus === 'PAUSED') {
      return 'PAUSED';
    }
    return 'COMPLETED';
  }

  /**
   * Create a new session
   */
  async createSession(options: {
    taskId?: string;
    taskName: string;
    status: SessionStatus;
    timeWindow?: TimeWindow;
  }): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      taskId: options.taskId,
      taskName: options.taskName,
      status: options.status,
      startTime: now,
      duration: 0,
      timeWindow: options.timeWindow,
      todoistSynced: false,
      createdAt: now,
      updatedAt: now,
    };

    this.saveActiveSession(session);
    return session;
  }

  /**
   * Save an active session
   */
  saveActiveSession(session: Session): void {
    const validated = SessionSchema.parse(session);
    const filename = this.getSessionFilename(validated);
    const filepath = join(this.getActiveDir(), filename);
    writeFileSync(filepath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[] {
    const files = this.getJsonFiles(this.getActiveDir());
    const sessions: Session[] = [];

    for (const filepath of files) {
      try {
        const content = readFileSync(filepath, 'utf-8');
        const data = JSON.parse(content);
        const session = SessionSchema.parse(data);
        sessions.push(session);
      } catch (error) {
        console.error(`Failed to read session file ${basename(filepath)}:`, error);
      }
    }

    return sessions.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  /**
   * Get session by ID (searches both active and archived)
   */
  getSessionById(id: string): Session | null {
    // Check active first
    const active = this.getActiveSessions().find((s) => s.id === id);
    if (active) return active;

    // Check archived
    const archived = this.getArchivedSessions().find((s) => s.id === id);
    return archived || null;
  }

  /**
   * Get active session by task name with fuzzy matching
   */
  getActiveSessionByTask(taskQuery: string): Session | null {
    const sessions = this.getActiveSessions();
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
   * Calculate total pause duration
   */
  private calculatePauseDuration(session: Session): number {
    if (!session.pausedAt) return 0;

    const pauseStart = new Date(session.pausedAt).getTime();
    const pauseEnd = session.resumedAt
      ? new Date(session.resumedAt).getTime()
      : new Date().getTime();

    return Math.floor((pauseEnd - pauseStart) / 1000);
  }

  /**
   * Pause a session
   */
  pauseSession(id: string): Session | null {
    const session = this.getSessionById(id);
    if (!session || session.status !== 'ACTIVE') {
      return null;
    }

    const now = new Date().toISOString();

    // Calculate active duration up to this point
    const startTime = new Date(session.startTime).getTime();
    const resumeTime = session.resumedAt ? new Date(session.resumedAt).getTime() : startTime;
    const pauseTime = new Date(now).getTime();
    const activeDuration = Math.floor((pauseTime - resumeTime) / 1000);

    session.status = 'PAUSED';
    session.pausedAt = now;
    // Add this active duration to existing duration
    session.duration = session.duration + activeDuration;
    session.updatedAt = now;

    this.saveActiveSession(session);
    return session;
  }

  /**
   * Resume a paused session
   */
  resumeSession(id: string): Session | null {
    const session = this.getSessionById(id);
    if (!session || session.status !== 'PAUSED') {
      return null;
    }

    const now = new Date().toISOString();
    session.status = 'ACTIVE';
    session.resumedAt = now;
    session.updatedAt = now;
    // Duration is preserved from when we paused

    this.saveActiveSession(session);
    return session;
  }

  /**
   * Stop a session
   */
  stopSession(id: string): Session | null {
    const session = this.getSessionById(id);
    if (!session || session.status === 'COMPLETED') {
      return null;
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

    this.archiveSession(session);
    return session;
  }

  /**
   * Update session duration
   */
  updateSessionDuration(id: string): void {
    const session = this.getSessionById(id);
    if (!session || session.status !== 'ACTIVE') {
      return;
    }

    const now = new Date().toISOString();
    const startTime = new Date(session.startTime).getTime();
    const currentTime = new Date(now).getTime();
    const elapsed = Math.floor((currentTime - startTime) / 1000);

    session.duration = elapsed;
    session.updatedAt = now;

    this.saveActiveSession(session);
  }

  /**
   * Archive a completed session
   */
  archiveSession(session: Session): void {
    const date = new Date(session.endTime || session.startTime);
    const dateStr = date.toISOString().split('T')[0];
    const dateDir = join(this.getSessionsDir(), dateStr);

    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true });
    }

    const filename = this.getSessionFilename(session);
    const filepath = join(dateDir, filename);

    writeFileSync(filepath, JSON.stringify(session, null, 2), 'utf-8');

    // Delete from active
    const activeFile = join(this.getActiveDir(), filename);
    if (existsSync(activeFile)) {
      unlinkSync(activeFile);
    }
  }

  /**
   * Get archived sessions by date
   */
  getArchivedSessionsByDate(dateStr: string): Session[] {
    const dateDir = join(this.getSessionsDir(), dateStr);
    const files = this.getJsonFiles(dateDir);
    const sessions: Session[] = [];

    for (const filepath of files) {
      try {
        const content = readFileSync(filepath, 'utf-8');
        const data = JSON.parse(content);
        const session = SessionSchema.parse(data);
        sessions.push(session);
      } catch (error) {
        console.error(`Failed to read session file ${basename(filepath)}:`, error);
      }
    }

    return sessions.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }

  /**
   * Get all archived sessions
   */
  getArchivedSessions(): Session[] {
    const sessionsDir = this.getSessionsDir();
    if (!existsSync(sessionsDir)) {
      return [];
    }

    const dateDirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    const allSessions: Session[] = [];
    for (const dateStr of dateDirs) {
      const sessions = this.getArchivedSessionsByDate(dateStr);
      allSessions.push(...sessions);
    }

    return allSessions.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  /**
   * Delete a session by ID
   */
  deleteSession(id: string): boolean {
    const session = this.getSessionById(id);
    if (!session) return false;

    const filename = this.getSessionFilename(session);

    // Try active directory
    const activeFile = join(this.getActiveDir(), filename);
    if (existsSync(activeFile)) {
      unlinkSync(activeFile);
      return true;
    }

    // Try archived directory
    const date = new Date(session.endTime || session.startTime);
    const dateStr = date.toISOString().split('T')[0];
    const archivedFile = join(this.getSessionsDir(), dateStr, filename);
    if (existsSync(archivedFile)) {
      unlinkSync(archivedFile);
      return true;
    }

    return false;
  }

  /**
   * Mark session as synced to Todoist
   */
  markSynced(id: string): void {
    const session = this.getSessionById(id);
    if (!session) return;

    session.todoistSynced = true;
    session.updatedAt = new Date().toISOString();

    if (session.status === 'COMPLETED') {
      this.archiveSession(session);
    } else {
      this.saveActiveSession(session);
    }
  }

  /**
   * Get unsynced completed sessions
   */
  getUnsyncedCompletedSessions(): Session[] {
    return this.getArchivedSessions().filter(
      (s) => s.status === 'COMPLETED' && !s.todoistSynced && s.taskId
    );
  }

  /**
   * Generate filename for session
   */
  private getSessionFilename(session: Session): string {
    return `${session.id}.json`;
  }

  /**
   * Get JSON files from directory
   */
  private getJsonFiles(dir: string): string[] {
    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir, { withFileTypes: true })
      .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.json'))
      .map((dirent) => join(dir, dirent.name));
  }
}
