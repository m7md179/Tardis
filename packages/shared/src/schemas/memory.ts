import { z } from 'zod';

export const MemoryTypeSchema = z.enum(['user_fact', 'project', 'preference', 'plugin']);

export const MemoryEntrySchema = z.object({
  id: z.string().uuid(),
  type: MemoryTypeSchema,
  key: z.string().min(1),
  value: z.string(),
  source: z.string().min(1),
  pluginName: z.string().optional(),
  /** Optional hierarchy, e.g. "finance/goals". Nothing reads it yet; it is here
   *  because a nullable column is cheap now and painful to retrofit later. */
  path: z.string().optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  accessedAt: z.number().int().positive().optional(),
});
