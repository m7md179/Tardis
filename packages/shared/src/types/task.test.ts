import { describe, test, expect } from 'bun:test';
import {
  TodoistTaskSchema,
  CreateTodoistTaskSchema,
  TaskMatchSchema,
  TodoistPrioritySchema,
} from './task';

describe('TodoistPrioritySchema', () => {
  test('validates valid priorities', () => {
    expect(TodoistPrioritySchema.parse(1)).toBe(1);
    expect(TodoistPrioritySchema.parse(2)).toBe(2);
    expect(TodoistPrioritySchema.parse(3)).toBe(3);
    expect(TodoistPrioritySchema.parse(4)).toBe(4);
  });

  test('rejects invalid priorities', () => {
    expect(() => TodoistPrioritySchema.parse(0)).toThrow();
    expect(() => TodoistPrioritySchema.parse(5)).toThrow();
  });

  test('defaults to priority 1', () => {
    expect(TodoistPrioritySchema.parse(undefined)).toBe(1);
  });
});

describe('TodoistTaskSchema', () => {
  test('validates complete task', () => {
    const task = {
      id: 'task-123',
      content: 'Write documentation',
      description: 'Complete the API documentation',
      labels: ['work', 'docs'],
      priority: 3,
      due: {
        date: '2024-01-20',
        string: 'next Friday',
        datetime: '2024-01-20T17:00:00Z',
        recurring: false,
      },
      project_id: 'project-456',
      section_id: 'section-789',
      order: 1,
      url: 'https://todoist.com/showTask?id=task-123',
      created_at: '2024-01-15T09:00:00Z',
      comment_count: 2,
      is_completed: false,
    };

    expect(TodoistTaskSchema.parse(task)).toEqual(task);
  });

  test('validates minimal task', () => {
    const task = {
      id: 'task-123',
      content: 'Simple task',
      project_id: 'project-456',
      url: 'https://todoist.com/showTask?id=task-123',
      created_at: '2024-01-15T09:00:00Z',
    };

    const parsed = TodoistTaskSchema.parse(task);
    expect(parsed.description).toBe('');
    expect(parsed.labels).toEqual([]);
    expect(parsed.priority).toBe(1);
    expect(parsed.comment_count).toBe(0);
    expect(parsed.is_completed).toBe(false);
  });

  test('rejects invalid URL', () => {
    expect(() =>
      TodoistTaskSchema.parse({
        id: 'task-123',
        content: 'Task',
        project_id: 'project-456',
        url: 'not-a-url',
        created_at: '2024-01-15T09:00:00Z',
      })
    ).toThrow();
  });
});

describe('CreateTodoistTaskSchema', () => {
  test('validates task creation with required fields', () => {
    const task = {
      content: 'New task',
    };

    expect(CreateTodoistTaskSchema.parse(task)).toEqual(task);
  });

  test('validates task creation with all fields', () => {
    const task = {
      content: 'New task',
      description: 'Task description',
      project_id: 'project-123',
      labels: ['work'],
      priority: 4,
      due_string: 'tomorrow',
    };

    expect(CreateTodoistTaskSchema.parse(task)).toEqual(task);
  });

  test('rejects empty content', () => {
    expect(() =>
      CreateTodoistTaskSchema.parse({
        content: '',
      })
    ).toThrow();
  });
});

describe('TaskMatchSchema', () => {
  test('validates task match', () => {
    const match = {
      task: {
        id: 'task-123',
        content: 'Write docs',
        project_id: 'project-456',
        url: 'https://todoist.com/showTask?id=task-123',
        created_at: '2024-01-15T09:00:00Z',
      },
      matchType: 'exact',
      confidence: 1.0,
    };

    const parsed = TaskMatchSchema.parse(match);
    expect(parsed.matchType).toBe('exact');
    expect(parsed.confidence).toBe(1.0);
  });

  test('validates different match types', () => {
    const task = {
      id: 'task-123',
      content: 'Task',
      project_id: 'project-456',
      url: 'https://todoist.com/showTask?id=task-123',
      created_at: '2024-01-15T09:00:00Z',
    };

    expect(
      TaskMatchSchema.parse({
        task,
        matchType: 'prefix',
        confidence: 0.8,
      })
    ).toBeTruthy();

    expect(
      TaskMatchSchema.parse({
        task,
        matchType: 'contains',
        confidence: 0.6,
      })
    ).toBeTruthy();
  });

  test('rejects invalid confidence values', () => {
    const task = {
      id: 'task-123',
      content: 'Task',
      project_id: 'project-456',
      url: 'https://todoist.com/showTask?id=task-123',
      created_at: '2024-01-15T09:00:00Z',
    };

    expect(() =>
      TaskMatchSchema.parse({
        task,
        matchType: 'exact',
        confidence: 1.5,
      })
    ).toThrow();

    expect(() =>
      TaskMatchSchema.parse({
        task,
        matchType: 'exact',
        confidence: -0.1,
      })
    ).toThrow();
  });
});
