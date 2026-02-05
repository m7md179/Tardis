import { z } from 'zod';

/**
 * Session status enum
 */
export const SessionStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Time window for task scheduling (HH:MM format)
 */
export const TimeWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
});
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

/**
 * Core session schema
 * Represents a time tracking session for a task
 */
export const SessionSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().optional(),
  taskName: z.string().min(1, 'Task name cannot be empty'),
  status: SessionStatusSchema,
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  pausedAt: z.string().datetime().optional(),
  resumedAt: z.string().datetime().optional(),
  duration: z.number().int().nonnegative(), // seconds
  timeWindow: TimeWindowSchema.optional(),
  todoistSynced: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * Pause record for tracking pause periods
 */
export const PauseRecordSchema = z.object({
  pausedAt: z.string().datetime(),
  resumedAt: z.string().datetime().optional(),
  duration: z.number().int().nonnegative().optional(), // seconds
});
export type PauseRecord = z.infer<typeof PauseRecordSchema>;

/**
 * Extended session with pause history
 */
export const SessionWithPausesSchema = SessionSchema.extend({
  pauses: z.array(PauseRecordSchema).default([]),
});
export type SessionWithPauses = z.infer<typeof SessionWithPausesSchema>;
