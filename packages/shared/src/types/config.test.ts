import { describe, test, expect } from 'bun:test';
import { ConfigSchema, TodoistConfigSchema, PartialConfigSchema } from './config';

describe('TodoistConfigSchema', () => {
  test('validates todoist config with required fields', () => {
    const config = {
      apiToken: 'abc123xyz',
    };

    const parsed = TodoistConfigSchema.parse(config);
    expect(parsed.apiToken).toBe('abc123xyz');
    expect(parsed.syncInterval).toBe(300); // Default
  });

  test('validates todoist config with all fields', () => {
    const config = {
      apiToken: 'abc123xyz',
      syncInterval: 600,
      projectId: 'project-123',
      labelFilter: ['work', 'urgent'],
    };

    expect(TodoistConfigSchema.parse(config)).toEqual(config);
  });

  test('rejects empty API token', () => {
    expect(() =>
      TodoistConfigSchema.parse({
        apiToken: '',
      })
    ).toThrow();
  });
});

describe('ConfigSchema', () => {
  test('validates complete config', () => {
    const config = {
      todoist: {
        apiToken: 'abc123xyz',
        syncInterval: 300,
      },
      notifications: {
        enabled: true,
        channels: {
          telegram: {
            enabled: true,
            botToken: 'bot-token',
            chatId: 'chat-id',
          },
        },
        events: {
          timeWindowStart: true,
          timeWindowEnd: true,
          taskOverdue: true,
        },
      },
      storage: {
        type: 'json',
        archiveAfterDays: 30,
      },
    };

    expect(ConfigSchema.parse(config)).toMatchObject(config);
  });

  test('validates minimal config with defaults', () => {
    const config = {
      todoist: {
        apiToken: 'abc123xyz',
      },
      notifications: {
        enabled: false,
        channels: {},
        events: {
          timeWindowStart: true,
          timeWindowEnd: true,
          taskOverdue: true,
        },
      },
      storage: {
        type: 'json',
        archiveAfterDays: 30,
      },
    };

    const parsed = ConfigSchema.parse(config);
    expect(parsed.todoist.syncInterval).toBe(300);
    expect(parsed.storage.type).toBe('json');
  });

  test('rejects invalid storage type', () => {
    expect(() =>
      ConfigSchema.parse({
        todoist: { apiToken: 'abc123xyz' },
        notifications: {
          enabled: false,
          channels: {},
          events: {
            timeWindowStart: true,
            timeWindowEnd: true,
            taskOverdue: true,
          },
        },
        storage: { type: 'postgres', archiveAfterDays: 30 },
      })
    ).toThrow();
  });
});

describe('PartialConfigSchema', () => {
  test('validates partial config updates', () => {
    const partial = {
      todoist: {
        syncInterval: 600,
      },
    };

    expect(PartialConfigSchema.parse(partial)).toEqual(partial);
  });

  test('validates empty partial config', () => {
    expect(PartialConfigSchema.parse({})).toEqual({});
  });
});
