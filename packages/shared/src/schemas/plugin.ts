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

/**
 * A Skill: one capability a plugin registers. See SKILLS.md.
 *
 * This is the concept the manifest's `tools` array always described — it gains
 * an explicit id, an opt-out from LLM exposure, and a slot for the UI
 * descriptor that clients render from.
 */
export const SkillDefinitionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, {
      message: 'Skill id must follow "plugin-name.skill-name" format',
    }),
  description: z.string().min(1),
  /** When false the agent loop never sees this skill — it is invocable only directly. */
  aiInvocable: z.boolean().default(true),
  actionType: ActionTypeSchema.default('direct'),
  /** JSON Schema. The single argument contract shared by the LLM and the UI. */
  parameters: z.record(z.unknown()),
  /** Additive to the plugin's own permissions. */
  permissions: z.array(z.string()).optional(),
  /** How a client renders/invokes this without an LLM. Vocabulary defined in Phase C. */
  ui: z.record(z.unknown()).optional(),
});

export const ProactiveTriggerSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  defaultSchedule: z.string().min(1),
  defaultEnabled: z.boolean(),
  handler: z.string().min(1),
});

/**
 * Raw manifest as authored on disk.
 *
 * `summary`/`skills` are canonical; `skillSummary`/`tools` are accepted as
 * deprecated aliases so existing manifests keep loading unchanged. Exactly one
 * of each pair must be present — enforced below, since Zod cannot express it.
 */
export const PluginManifestInputSchema = z.object({
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
  /** One-line blurb the PluginRouter selects on. */
  summary: z.string().min(1).max(500).optional(),
  /** @deprecated renamed to `summary` — it summarises the plugin, not its skills. */
  skillSummary: z.string().min(1).max(500).optional(),
  permissions: z.array(z.string()),
  skills: z.array(SkillDefinitionSchema).optional(),
  /** @deprecated renamed to `skills`. Entries normalize to aiInvocable skills. */
  tools: z.array(ToolDefinitionSchema).optional(),
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

/**
 * Canonical manifest: `summary`, `skills` and `tools` are always present.
 *
 * `tools` is derived from the AI-invocable skills so every existing consumer
 * (agent loop, router, tool router) keeps working untouched.
 */
export const PluginManifestSchema = PluginManifestInputSchema.superRefine((m, ctx) => {
  if (!m.summary && !m.skillSummary) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['summary'],
      message: 'Manifest must define "summary" (or the deprecated "skillSummary")',
    });
  }
  if (!m.skills && !m.tools) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['skills'],
      message: 'Manifest must define "skills" (or the deprecated "tools")',
    });
  }
}).transform((m) => {
  const skills: z.infer<typeof SkillDefinitionSchema>[] =
    m.skills ??
    (m.tools ?? []).map((t) => ({
      id: t.name,
      description: t.description,
      aiInvocable: true,
      actionType: t.actionType,
      parameters: t.parameters,
    }));

  const summary = m.summary ?? m.skillSummary ?? '';

  const tools = skills
    .filter((s) => s.aiInvocable)
    .map((s) => ({
      name: s.id,
      description: s.description,
      parameters: s.parameters,
      actionType: s.actionType,
    }));

  const { skillSummary: _deprecatedSummary, ...rest } = m;
  return { ...rest, summary, skills, tools };
});
