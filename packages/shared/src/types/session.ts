import type { z } from 'zod';
import type { SessionStatusSchema, SessionSchema } from '../schemas/session.js';

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type Session = z.infer<typeof SessionSchema>;
