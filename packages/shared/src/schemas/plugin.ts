import { z } from 'zod';

export const PluginTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const ActionTypeSchema = z.enum(['direct', 'workflow']);

export const ToolDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, {
      message: 'Tool name must follow "plugin-name.tool-name" format',
    }),
  description: z.string().min(1),
  parameters: z.record(z.unknown()),
  actionType: ActionTypeSchema,
});

export const ProactiveTriggerSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  defaultSchedule: z.string().min(1),
  defaultEnabled: z.boolean(),
  handler: z.string().min(1),
});

export const PluginManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, {
      message: 'Plugin name must be lowercase letters, numbers, and hyphens only',
    }),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, { message: 'Version must be semver (e.g. 1.0.0)' }),
  displayName: z.string().min(1),
  description: z.string().min(1),
  tier: PluginTierSchema,
  main: z.string().min(1),
  skillSummary: z.string().min(1).max(500),
  permissions: z.array(z.string()),
  tools: z.array(ToolDefinitionSchema),
  proactive: z.array(ProactiveTriggerSchema).optional(),
  llm: z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1),
      temperature: z.number().min(0).max(2).optional(),
      systemPrompt: z.string().optional(),
    })
    .optional(),
  config: z.record(z.unknown()).optional(),
  dependencies: z.array(z.string()).optional(),
});
