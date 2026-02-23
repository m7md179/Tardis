import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ─── Conversation History ───
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(), // uuid
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  toolName: text('tool_name'), // if role === 'tool'
  toolArgs: text('tool_args'), // JSON string
  toolResult: text('tool_result'), // JSON string
  timestamp: integer('timestamp').notNull(), // unix ms
});

// ─── Memory Store ───
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'user_fact' | 'project' | 'preference' | 'plugin'
  key: text('key').notNull(), // searchable label, e.g. "ahmad_email"
  value: text('value').notNull(), // the actual memory content
  source: text('source'), // 'user' | 'agent' | plugin name
  pluginName: text('plugin_name'), // if type === 'plugin'
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  accessedAt: integer('accessed_at'), // last time agent retrieved this
});

// ─── Thought Traces ───
export const thoughtTraces = sqliteTable('thought_traces', {
  id: text('id').primaryKey(),
  userMessage: text('user_message').notNull(),
  steps: text('steps').notNull(), // JSON array of AgentStep[]
  finalResponse: text('final_response'),
  totalDurationMs: integer('total_duration_ms'),
  modelUsed: text('model_used'),
  tokenCount: integer('token_count'), // approximate
  timestamp: integer('timestamp').notNull(),
});

// ─── Plugin Storage (per-plugin key-value) ───
export const pluginStorage = sqliteTable('plugin_storage', {
  id: text('id').primaryKey(),
  pluginName: text('plugin_name').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(), // JSON string
  updatedAt: integer('updated_at').notNull(),
});

// ─── Proactive Trigger Settings ───
export const proactiveSettings = sqliteTable('proactive_settings', {
  id: text('id').primaryKey(),
  pluginName: text('plugin_name').notNull(),
  triggerName: text('trigger_name').notNull(),
  enabled: integer('enabled').notNull().default(0), // boolean (0/1)
  schedule: text('schedule').notNull(), // cron expression
  config: text('config'), // JSON — plugin-specific settings
  quietHoursStart: text('quiet_hours_start'), // "22:00"
  quietHoursEnd: text('quiet_hours_end'), // "08:00"
});

// ─── Sessions (for time-tracker plugin) ───
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  taskName: text('task_name').notNull(),
  status: text('status').notNull(), // 'active' | 'paused' | 'completed'
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time'),
  duration: integer('duration'), // seconds
  pausedAt: integer('paused_at'),
  accumulatedTime: integer('accumulated_time').notNull().default(0),
  metadata: text('metadata'), // JSON — plugin can attach extra data
  createdAt: integer('created_at').notNull(),
});
