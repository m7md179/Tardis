import type { z } from 'zod';
import type {
  PluginTierSchema,
  ActionTypeSchema,
  ToolDefinitionSchema,
  SkillDefinitionSchema,
  SkillUiDescriptorSchema,
  SkillUiFieldSchema,
  SkillUiActionSchema,
  ProactiveTriggerSchema,
  PluginManifestSchema,
  PluginManifestInputSchema,
} from '../schemas/plugin.js';

// Types derived from Zod schemas to ensure exactOptionalPropertyTypes compatibility
export type PluginTier = z.infer<typeof PluginTierSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
/** One capability a plugin registers. See SKILLS.md. */
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
/** How a client renders and invokes a Skill without an LLM. See UI-CONTRACT.md. */
export type SkillUiDescriptor = z.infer<typeof SkillUiDescriptorSchema>;
export type SkillUiField = z.infer<typeof SkillUiFieldSchema>;
export type SkillUiAction = z.infer<typeof SkillUiActionSchema>;
export type ProactiveTrigger = z.infer<typeof ProactiveTriggerSchema>;
/** Canonical manifest — `summary`, `skills` and `tools` are always present. */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
/** Manifest as authored on disk, before normalization. */
export type PluginManifestInput = z.input<typeof PluginManifestInputSchema>;

// PluginInstance is not schema-validated (has function members), so typed manually
export interface PluginInstance {
  manifest: PluginManifest;
  onActivate: (api: unknown) => Promise<void>;
  onDeactivate?: () => Promise<void>;
  executeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}
