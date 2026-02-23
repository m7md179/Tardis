import { z } from 'zod';

export const SessionStatusSchema = z.enum(['active', 'paused', 'completed']);

export const SessionSchema = z.object({
  id: z.string().uuid(),
  taskName: z.string().min(1),
  status: SessionStatusSchema,
  startTime: z.number().int().positive(),
  endTime: z.number().int().positive().optional(),
  duration: z.number().int().nonnegative().optional(),
  pausedAt: z.number().int().positive().optional(),
  accumulatedTime: z.number().int().nonnegative().default(0),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.number().int().positive(),
});
