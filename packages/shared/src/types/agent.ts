import type { z } from 'zod';
import type { AgentStepSchema, ThoughtTraceSchema, AgentConfigSchema } from '../schemas/agent.js';

export type AgentStep = z.infer<typeof AgentStepSchema>;
export type ThoughtTrace = z.infer<typeof ThoughtTraceSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
