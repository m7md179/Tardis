import type { z } from 'zod';
import type { MemoryTypeSchema, MemoryEntrySchema } from '../schemas/memory.js';

export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
