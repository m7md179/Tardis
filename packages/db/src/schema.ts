import { blob, sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ─── Conversation History ───
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(), // uuid
  chatId: text('chat_id').notNull(), // identifies the chat (e.g. Telegram chat ID)
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  toolName: text('tool_name'), // if role === 'tool'
  toolCalls: text('tool_calls'), // JSON string for assistant tool_calls array
  timestamp: integer('timestamp').notNull(), // unix ms
}, (t) => [
  index('conversations_chat_ts').on(t.chatId, t.timestamp),
]);

// ─── Memory Store ───
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'user_fact' | 'project' | 'preference' | 'plugin'
  key: text('key').notNull(), // searchable label, e.g. "ahmad_email"
  value: text('value').notNull(), // the actual memory content
  source: text('source'), // 'user' | 'agent' | plugin name
  pluginName: text('plugin_name'), // if type === 'plugin'
  path: text('path'), // optional hierarchy, e.g. "finance/goals"
  embedding: blob('embedding', { mode: 'buffer' }), // Float32 vector of `value`
  embeddingModel: text('embedding_model'), // which model produced it
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
  schedule: text('schedule').notNull(), // cron expression or RRULE
  config: text('config'), // JSON — plugin-specific settings
  quietHoursStart: text('quiet_hours_start'), // "22:00"
  quietHoursEnd: text('quiet_hours_end'), // "08:00"
  nextRunAt: integer('next_run_at'), // epoch ms; derived from schedule + quiet hours
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

// ─── Proactive Execution Logs ───
export const proactiveLogs = sqliteTable('proactive_logs', {
  id: text('id').primaryKey(),
  pluginName: text('plugin_name').notNull(),
  triggerName: text('trigger_name').notNull(),
  status: text('status').notNull(), // 'success' | 'error'
  message: text('message'), // optional detail or error message
  timestamp: integer('timestamp').notNull(), // unix ms
  durationMs: integer('duration_ms'), // execution time in milliseconds
});
