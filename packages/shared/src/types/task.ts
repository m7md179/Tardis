import { z } from 'zod';

/**
 * Todoist task due date schema
 */
export const TodoistDueDateSchema = z.object({
  date: z.string(), // YYYY-MM-DD format
  string: z.string(), // Human-readable format (e.g., "tomorrow", "next Monday")
  datetime: z.string().optional(), // ISO 8601 datetime if time is specified
  timezone: z.string().optional(),
  recurring: z.boolean().default(false),
});
export type TodoistDueDate = z.infer<typeof TodoistDueDateSchema>;

/**
 * Todoist task priority levels
 * 1 = Normal (lowest)
 * 2 = Medium
 * 3 = High
 * 4 = Urgent (highest)
 */
export const TodoistPrioritySchema = z.number().int().min(1).max(4).default(1);
export type TodoistPriority = z.infer<typeof TodoistPrioritySchema>;

/**
 * Todoist task schema
 * Based on Todoist REST API v2
 */
export const TodoistTaskSchema = z.object({
  id: z.string(),
  content: z.string(),
  description: z.string().default(''),
  labels: z.array(z.string()).default([]),
  priority: TodoistPrioritySchema,
  due: TodoistDueDateSchema.nullish(),
  project_id: z.string(),
  section_id: z.string().nullish(),
  parent_id: z.string().nullish(),
  order: z.number().int().default(0),
  url: z.string().url(),
  created_at: z.string().datetime(),
  creator_id: z.string().nullish(),
  assignee_id: z.string().nullish(),
  assigner_id: z.string().nullish(),
  comment_count: z.number().int().default(0),
  is_completed: z.boolean().default(false),
  completed_at: z.string().datetime().nullish(),
});
export type TodoistTask = z.infer<typeof TodoistTaskSchema>;

/**
 * Todoist task creation request
 */
export const CreateTodoistTaskSchema = z.object({
  content: z.string().min(1, 'Task content is required'),
  description: z.string().optional(),
  project_id: z.string().optional(),
  section_id: z.string().optional(),
  parent_id: z.string().optional(),
  order: z.number().int().optional(),
  labels: z.array(z.string()).optional(),
  priority: TodoistPrioritySchema.optional(),
  due_string: z.string().optional(),
  due_date: z.string().optional(),
  due_datetime: z.string().optional(),
  due_lang: z.string().optional(),
  assignee_id: z.string().optional(),
});
export type CreateTodoistTask = z.infer<typeof CreateTodoistTaskSchema>;

/**
 * Todoist task update request
 */
export const UpdateTodoistTaskSchema = CreateTodoistTaskSchema.partial();
export type UpdateTodoistTask = z.infer<typeof UpdateTodoistTaskSchema>;

/**
 * Task match result from fuzzy matching
 */
export const TaskMatchSchema = z.object({
  task: TodoistTaskSchema,
  matchType: z.enum(['exact', 'prefix', 'contains']),
  confidence: z.number().min(0).max(1), // 0.0 to 1.0
});
export type TaskMatch = z.infer<typeof TaskMatchSchema>;
