export type SessionStatus = 'active' | 'paused' | 'completed';

export interface Session {
  id: string;
  taskName: string;
  status: SessionStatus;
  startTime: number;               // unix ms
  endTime?: number;
  duration?: number;               // seconds
  pausedAt?: number;
  accumulatedTime: number;         // seconds, tracks time across pauses
  metadata?: Record<string, unknown>;
  createdAt: number;
}
