import { z } from 'zod';
import { ActionTypeSchema, PermissionSchema } from './plugin.js';

export const AgentStepSchema = z.object({
  type: z.enum([
    'reasoning',
    'tool_call',
    'tool_result',
    'approval_request',
    'user_response',
    'error',
  ]),
  timestamp: z.number().int().positive(),
  content: z.string(),
  toolName: z.string().optional(),
  toolArgs: z.record(z.unknown()).optional(),
  toolResult: z.unknown().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const ThoughtTraceSchema = z.object({
  id: z.string().uuid(),
  userMessage: z.string(),
  steps: z.array(AgentStepSchema),
  finalResponse: z.string().nullable(),
  totalDurationMs: z.number().int().nonnegative(),
  modelUsed: z.string(),
  tokenCount: z.number().int().nonnegative().optional(),
  timestamp: z.number().int().positive(),
});

export const AgentConfigSchema = z.object({
  maxSteps: z.number().int().min(1).max(50).default(10),
  conversationHistoryLength: z.number().int().min(1).max(100).default(10),
  memoryTokenBudget: z.number().int().min(0).default(2000),
  enableFallbackIntent: z.boolean().default(true),
  /**
   * Per-tool permission rules, keyed by glob. Last matching rule wins, and no
   * rule may make a tool weaker than the skill declared for itself.
   *
   * The legacy `direct`/`workflow` values are still accepted so an existing
   * config keeps working: they read as `allow` and `ask`.
   */
  actionOverrides: z.record(z.union([PermissionSchema, ActionTypeSchema])).default({}),
  /**
   * Nothing that changes state may run. Applied after the rules above, so no
   * per-tool `allow` can cancel it.
   *
   * This needs the `mutates` axis on skills to mean anything — grading ceremony
   * cannot distinguish `budget.this-month` from `budget.add-entry`.
   */
  readOnly: z.boolean().default(false),
});
