import { z } from 'zod';

export const MemoryTypeSchema = z.enum(['user_fact', 'project', 'preference', 'plugin']);

export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  type: MemoryTypeSchema,
  key: z.string().min(1),
  value: z.string(),
  source: z.string().min(1),
  pluginName: z.string().optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  accessedAt: z.number().int().positive().optional(),
});
