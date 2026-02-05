import { z } from 'zod';

/**
 * Generic API error response
 */
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().int(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Generic API success response
 */
export const ApiSuccessSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});
export type ApiSuccess = z.infer<typeof ApiSuccessSchema>;

/**
 * Pagination metadata
 */
export const PaginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * Paginated response wrapper
 */
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: z.array(dataSchema),
    meta: PaginationMetaSchema,
  });

/**
 * HTTP methods enum
 */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/**
 * Request options for API calls
 */
export const RequestOptionsSchema = z.object({
  method: HttpMethodSchema.default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeout: z.number().int().positive().default(30000), // 30 seconds
  retries: z.number().int().nonnegative().default(3),
  retryDelay: z.number().int().positive().default(1000), // 1 second
});
export type RequestOptions = z.infer<typeof RequestOptionsSchema>;

/**
 * Validation error detail
 */
export const ValidationErrorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
  value: z.unknown().optional(),
});
export type ValidationErrorDetail = z.infer<typeof ValidationErrorDetailSchema>;

/**
 * Validation error response
 */
export const ValidationErrorSchema = ApiErrorSchema.extend({
  error: z.literal('VALIDATION_ERROR'),
  details: z.array(ValidationErrorDetailSchema),
});
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
