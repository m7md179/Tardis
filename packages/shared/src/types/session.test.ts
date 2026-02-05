import { describe, test, expect } from 'bun:test';
import {
  SessionStatusSchema,
  TimeWindowSchema,
  SessionSchema,
  PauseRecordSchema,
  SessionWithPausesSchema,
} from './session';

describe('SessionStatusSchema', () => {
  test('validates correct status values', () => {
    expect(SessionStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
    expect(SessionStatusSchema.parse('PAUSED')).toBe('PAUSED');
    expect(SessionStatusSchema.parse('COMPLETED')).toBe('COMPLETED');
  });

  test('rejects invalid status values', () => {
    expect(() => SessionStatusSchema.parse('INVALID')).toThrow();
    expect(() => SessionStatusSchema.parse('')).toThrow();
  });
});

describe('TimeWindowSchema', () => {
  test('validates correct time window', () => {
    const timeWindow = {
      start: '09:00',
      end: '17:00',
      date: '2024-01-15',
    };
    expect(TimeWindowSchema.parse(timeWindow)).toEqual(timeWindow);
  });

  test('rejects invalid time format', () => {
    expect(() =>
      TimeWindowSchema.parse({
        start: '9:00',
        end: '17:00',
        date: '2024-01-15',
      })
    ).toThrow();

    expect(() =>
      TimeWindowSchema.parse({
        start: '09:00',
        end: '25:00',
        date: '2024-01-15',
      })
    ).toThrow();
  });

  test('rejects invalid date format', () => {
    expect(() =>
      TimeWindowSchema.parse({
        start: '09:00',
        end: '17:00',
        date: '2024-1-15',
      })
    ).toThrow();

    expect(() =>
      TimeWindowSchema.parse({
        start: '09:00',
        end: '17:00',
        date: '01/15/2024',
      })
    ).toThrow();
  });
});

describe('SessionSchema', () => {
  test('validates complete session', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      taskId: 'task-123',
      taskName: 'Write documentation',
      status: 'COMPLETED',
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:30:00Z',
      duration: 5400,
      timeWindow: {
        start: '09:00',
        end: '17:00',
        date: '2024-01-15',
      },
      todoistSynced: true,
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T10:30:00Z',
    };

    expect(SessionSchema.parse(session)).toEqual(session);
  });

  test('validates minimal session', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      taskName: 'Quick task',
      status: 'ACTIVE',
      startTime: '2024-01-15T09:00:00Z',
      duration: 0,
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T09:00:00Z',
    };

    const parsed = SessionSchema.parse(session);
    expect(parsed.taskName).toBe('Quick task');
    expect(parsed.todoistSynced).toBe(false); // Default value
  });

  test('rejects invalid UUID', () => {
    expect(() =>
      SessionSchema.parse({
        id: 'not-a-uuid',
        taskName: 'Task',
        status: 'ACTIVE',
        startTime: '2024-01-15T09:00:00Z',
        duration: 0,
        createdAt: '2024-01-15T09:00:00Z',
        updatedAt: '2024-01-15T09:00:00Z',
      })
    ).toThrow();
  });

  test('rejects empty task name', () => {
    expect(() =>
      SessionSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        taskName: '',
        status: 'ACTIVE',
        startTime: '2024-01-15T09:00:00Z',
        duration: 0,
        createdAt: '2024-01-15T09:00:00Z',
        updatedAt: '2024-01-15T09:00:00Z',
      })
    ).toThrow();
  });

  test('rejects negative duration', () => {
    expect(() =>
      SessionSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        taskName: 'Task',
        status: 'ACTIVE',
        startTime: '2024-01-15T09:00:00Z',
        duration: -100,
        createdAt: '2024-01-15T09:00:00Z',
        updatedAt: '2024-01-15T09:00:00Z',
      })
    ).toThrow();
  });
});

describe('PauseRecordSchema', () => {
  test('validates pause record', () => {
    const pause = {
      pausedAt: '2024-01-15T10:00:00Z',
      resumedAt: '2024-01-15T10:15:00Z',
      duration: 900,
    };

    expect(PauseRecordSchema.parse(pause)).toEqual(pause);
  });

  test('validates pause without resume', () => {
    const pause = {
      pausedAt: '2024-01-15T10:00:00Z',
    };

    expect(PauseRecordSchema.parse(pause)).toEqual(pause);
  });
});

describe('SessionWithPausesSchema', () => {
  test('validates session with multiple pauses', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      taskName: 'Complex task',
      status: 'COMPLETED',
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T12:00:00Z',
      duration: 9000, // 2.5 hours minus breaks
      pauses: [
        {
          pausedAt: '2024-01-15T10:00:00Z',
          resumedAt: '2024-01-15T10:15:00Z',
          duration: 900,
        },
        {
          pausedAt: '2024-01-15T11:00:00Z',
          resumedAt: '2024-01-15T11:30:00Z',
          duration: 1800,
        },
      ],
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T12:00:00Z',
    };

    expect(SessionWithPausesSchema.parse(session)).toEqual(session);
  });

  test('defaults to empty pauses array', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      taskName: 'No pauses',
      status: 'ACTIVE',
      startTime: '2024-01-15T09:00:00Z',
      duration: 3600,
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    };

    const parsed = SessionWithPausesSchema.parse(session);
    expect(parsed.pauses).toEqual([]);
  });
});
