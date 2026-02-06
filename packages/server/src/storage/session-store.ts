import { JsonStore } from './json-store';
import { Session, SessionSchema } from '@tardis/shared';

/**
 * Session storage for server
 */
export class SessionStore {
  private store: JsonStore<Session>;
  private activeDir: string;
  private archiveDir: string;

  constructor(dataDir: string = '/var/lib/tardis/users/default') {
    this.store = new JsonStore<Session>(dataDir);
    this.activeDir = 'active_sessions';
    this.archiveDir = 'sessions';
  }

  /**
   * Save active session
   */
  saveActive(session: Session): void {
    const validated = SessionSchema.parse(session);
    const filepath = `${this.activeDir}/${session.id}.json`;
    this.store.write(filepath, validated);
  }

  /**
   * Get all active sessions
   */
  getActive(): Session[] {
    const files = this.store.list(this.activeDir);
    const sessions: Session[] = [];

    for (const filepath of files) {
      const data = this.store.read(filepath);
      if (data) {
        try {
          const session = SessionSchema.parse(data);
          sessions.push(session);
        } catch (error) {
          console.error(`Invalid session file ${filepath}:`, error);
        }
      }
    }

    return sessions.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  /**
   * Get session by ID (checks both active and archived)
   */
  getById(id: string): Session | null {
    // Check active first
    const activeFile = `${this.activeDir}/${id}.json`;
    const active = this.store.read(activeFile);
    if (active) {
      return SessionSchema.parse(active);
    }

    // Check archived (search all date directories)
    const dates = this.store.listDirectories(this.archiveDir);
    for (const date of dates) {
      const archivedFile = `${this.archiveDir}/${date}/${id}.json`;
      const archived = this.store.read(archivedFile);
      if (archived) {
        return SessionSchema.parse(archived);
      }
    }

    return null;
  }

  /**
   * Archive a session
   */
  archive(session: Session): void {
    const date = new Date(session.endTime || session.startTime);
    const dateStr = date.toISOString().split('T')[0];
    const archivePath = `${this.archiveDir}/${dateStr}/${session.id}.json`;
    
    this.store.write(archivePath, session);

    // Delete from active
    const activeFile = `${this.activeDir}/${session.id}.json`;
    this.store.delete(activeFile);
  }

  /**
   * Get archived sessions by date
   */
  getByDate(dateStr: string): Session[] {
    const dateDir = `${this.archiveDir}/${dateStr}`;
    const files = this.store.list(dateDir);
    const sessions: Session[] = [];

    for (const filepath of files) {
      const data = this.store.read(filepath);
      if (data) {
        try {
          const session = SessionSchema.parse(data);
          sessions.push(session);
        } catch (error) {
          console.error(`Invalid session file ${filepath}:`, error);
        }
      }
    }

    return sessions.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }

  /**
   * Get all archived sessions
   */
  getAllArchived(): Session[] {
    const dates = this.store.listDirectories(this.archiveDir);
    const allSessions: Session[] = [];

    for (const date of dates) {
      const sessions = this.getByDate(date);
      allSessions.push(...sessions);
    }

    return allSessions.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  /**
   * Delete session
   */
  delete(id: string): boolean {
    // Try active
    const activeFile = `${this.activeDir}/${id}.json`;
    if (this.store.delete(activeFile)) {
      return true;
    }

    // Try archived
    const dates = this.store.listDirectories(this.archiveDir);
    for (const date of dates) {
      const archivedFile = `${this.archiveDir}/${date}/${id}.json`;
      if (this.store.delete(archivedFile)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Delete all sessions (both active and archived)
   */
  deleteAll(): number {
    let count = 0;

    // Delete active sessions
    const activeFiles = this.store.list(this.activeDir);
    for (const file of activeFiles) {
      if (this.store.delete(file)) {
        count++;
      }
    }

    // Delete archived sessions
    const dates = this.store.listDirectories(this.archiveDir);
    for (const date of dates) {
      const archivedFiles = this.store.list(`${this.archiveDir}/${date}`);
      for (const file of archivedFiles) {
        if (this.store.delete(file)) {
          count++;
        }
      }
    }

    return count;
  }
}
