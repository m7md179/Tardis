import type { z } from 'zod';
import type {
  PluginTierSchema,
  ActionTypeSchema,
  ToolDefinitionSchema,
  ProactiveTriggerSchema,
  PluginManifestSchema,
} from '../schemas/plugin.js';

// Types derived from Zod schemas to ensure exactOptionalPropertyTypes compatibility
export type PluginTier = z.infer<typeof PluginTierSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ProactiveTrigger = z.infer<typeof ProactiveTriggerSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// PluginInstance is not schema-validated (has function members), so typed manually
export interface PluginInstance {
  manifest: PluginManifest;
  onActivate: (api: unknown) => Promise<void>;
  onDeactivate?: () => Promise<void>;
  executeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}
