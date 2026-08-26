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

// ─── UI descriptors (Phase C — see UI-CONTRACT.md) ───────────────────────────

/**
 * Widget vocabulary. Every surface must implement all of these.
 *
 * `image` captures a photo and submits it as a data URI — the same shape
 * PluginAPI.llm.analyzeImage expects. A surface without a camera falls back to
 * a file picker; the TUI cannot capture one at all and should render the field
 * as unavailable rather than pretending.
 */
export const SkillUiFieldTypeSchema = z.enum([
  'text',
  'textarea',
  'number',
  'date',
  'time',
  'datetime',
  'select',
  'tags',
  'checkbox',
  'image',
]);

export const SkillUiFieldSchema = z.object({
  /** Must name a parameter the skill actually accepts. */
  name: z.string().min(1),
  type: SkillUiFieldTypeSchema,
  label: z.string().min(1),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z
    .array(z.object({ value: z.union([z.string(), z.number()]), label: z.string().min(1) }))
    .optional(),
});

/** How to read one element of a result collection. Values are field paths, not literals. */
export const SkillUiItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  meta: z.array(z.string()).optional(),
  /** timer/countdown: a timestamp to count down to. */
  deadline: z.string().optional(),
  /** timer/elapsed: a start timestamp to count up from. */
  since: z.string().optional(),
  /** timer/elapsed: seconds already banked before the current run. */
  accumulated: z.string().optional(),
});

/** A per-item action: invoke another skill, mapping its params to item fields. */
export const SkillUiActionSchema = z.object({
  skill: z
    .string()
    .regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, { message: 'Action skill must be "plugin.skill"' }),
  label: z.string().min(1),
  style: z.enum(['primary', 'secondary', 'danger']).default('secondary'),
  /** skill parameter name -> field on the selected item. */
  args: z.record(z.string()).default({}),
});

export const SkillUiDescriptorSchema = z
  .object({
    block: z.enum(['action', 'form', 'list', 'timer', 'detail']),
    label: z.string().min(1),
    icon: z.string().optional(),
    /** action: fixed arguments to invoke with. */
    args: z.record(z.unknown()).optional(),
    /** form */
    submitLabel: z.string().optional(),
    fields: z.array(SkillUiFieldSchema).optional(),
    /** list / timer */
    resultPath: z.string().optional(),
    emptyText: z.string().optional(),
    item: SkillUiItemSchema.optional(),
    actions: z.array(SkillUiActionSchema).optional(),
    /** timer */
    mode: z.enum(['countdown', 'elapsed']).optional(),
    /**
     * Escape hatch: bespoke UI per surface, keyed by surface name.
     * Never a substitute for the standard block above — see the refinement.
     */
    custom: z.record(z.string()).optional(),
  })
  .superRefine((d, ctx) => {
    const needsItem = d.block === 'list' || d.block === 'timer' || d.block === 'detail';
    if (needsItem && !d.item) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['item'],
        message: `Block "${d.block}" requires an "item" descriptor`,
      });
    }
    if (d.block === 'timer') {
      if (!d.mode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mode'],
          message: 'Timer block requires "mode" ("countdown" or "elapsed")',
        });
      }
      if (d.mode === 'countdown' && d.item && !d.item.deadline) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['item', 'deadline'],
          message: 'Countdown timer requires item.deadline',
        });
      }
      if (d.mode === 'elapsed' && d.item && !d.item.since) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['item', 'since'],
          message: 'Elapsed timer requires item.since',
        });
      }
    }
    // The escape hatch's hard requirement, enforced here rather than in review:
    // custom UI without a standard fallback silently breaks the TUI, which
    // cannot execute custom code. `block` is required above, so a custom-only
    // descriptor cannot parse at all; this makes the reason legible when it fails.
    if (d.custom && Object.keys(d.custom).length > 0 && !d.block) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['block'],
        message:
          'A descriptor with "custom" UI must still declare a standard block fallback — the TUI cannot run custom code',
      });
    }
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
  /** How a client renders/invokes this without an LLM. See UI-CONTRACT.md. */
  ui: SkillUiDescriptorSchema.optional(),
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
