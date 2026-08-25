import { describe, it, expect } from 'bun:test';
import { PluginManifestSchema } from './plugin.js';

// ─── Manifest normalization (Phase B, see SKILLS.md) ─────────────────────────
//
// A manifest may be authored with the canonical `summary`/`skills` names or the
// deprecated `skillSummary`/`tools` aliases. Both must normalize to the same
// canonical shape, or old plugins break on load and new ones behave differently.

const BASE = {
  name: 'reminders',
  version: '1.0.0',
  displayName: 'Reminders',
  description: 'Set reminders',
  tier: 1 as const,
  main: 'index.ts',
  permissions: [],
};

const LEGACY_TOOL = {
  name: 'reminders.set-reminder',
  description: 'Set a reminder',
  parameters: { type: 'object', properties: {} },
  actionType: 'direct' as const,
};

describe('PluginManifestSchema: canonical form', () => {
  it('accepts skills + summary and derives tools from them', () => {
    const m = PluginManifestSchema.parse({
      ...BASE,
      summary: 'Set timed reminders',
      skills: [
        {
          id: 'reminders.set-reminder',
          description: 'Set a reminder',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    expect(m.summary).toBe('Set timed reminders');
    expect(m.skills).toHaveLength(1);
    expect(m.tools).toHaveLength(1);
    expect(m.tools[0]!.name).toBe('reminders.set-reminder');
  });

  it('defaults aiInvocable to true and actionType to direct', () => {
    const m = PluginManifestSchema.parse({
      ...BASE,
      summary: 'x',
      skills: [
        { id: 'reminders.ping', description: 'Ping', parameters: { type: 'object' } },
      ],
    });
    expect(m.skills[0]!.aiInvocable).toBe(true);
    expect(m.skills[0]!.actionType).toBe('direct');
  });

  it('omits non-AI-invocable skills from the derived tools', () => {
    const m = PluginManifestSchema.parse({
      ...BASE,
      summary: 'x',
      skills: [
        { id: 'reminders.set-reminder', description: 'Set', parameters: { type: 'object' } },
        {
          id: 'reminders.raw-toggle',
          description: 'Internal toggle',
          aiInvocable: false,
          parameters: { type: 'object' },
        },
      ],
    });

    // Both are registered Skills…
    expect(m.skills).toHaveLength(2);
    // …but the agent loop only ever sees the AI-invocable one. This is also the
    // token lever: tool schemas dominate the fixed prompt cost.
    expect(m.tools).toHaveLength(1);
    expect(m.tools[0]!.name).toBe('reminders.set-reminder');
  });

  it('preserves the ui descriptor untouched', () => {
    const ui = {
      block: 'timer' as const,
      label: 'Pending reminders',
      mode: 'countdown' as const,
      resultPath: 'reminders',
      item: { id: 'id', title: 'message', deadline: 'fireAtMs' },
    };
    const m = PluginManifestSchema.parse({
      ...BASE,
      summary: 'x',
      skills: [
        { id: 'reminders.set-reminder', description: 'Set', parameters: { type: 'object' }, ui },
      ],
    });
    expect(m.skills[0]!.ui).toEqual(ui);
  });
});

describe('PluginManifestSchema: deprecated aliases', () => {
  it('accepts skillSummary and normalizes it to summary', () => {
    const m = PluginManifestSchema.parse({
      ...BASE,
      skillSummary: 'Set timed reminders',
      tools: [LEGACY_TOOL],
    });
    expect(m.summary).toBe('Set timed reminders');
    expect(m).not.toHaveProperty('skillSummary');
  });

  it('accepts tools and normalizes them into aiInvocable skills', () => {
    const m = PluginManifestSchema.parse({
      ...BASE,
      skillSummary: 'x',
      tools: [LEGACY_TOOL],
    });
    expect(m.skills).toHaveLength(1);
    expect(m.skills[0]!.id).toBe('reminders.set-reminder');
    expect(m.skills[0]!.aiInvocable).toBe(true);
  });

  it('produces an identical canonical result from either spelling', () => {
    const legacy = PluginManifestSchema.parse({
      ...BASE,
      skillSummary: 'Set timed reminders',
      tools: [LEGACY_TOOL],
    });
    const modern = PluginManifestSchema.parse({
      ...BASE,
      summary: 'Set timed reminders',
      skills: [
        {
          id: 'reminders.set-reminder',
          description: 'Set a reminder',
          aiInvocable: true,
          actionType: 'direct',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    expect(legacy).toEqual(modern);
  });

  it('rejects a manifest with neither summary nor skillSummary', () => {
    expect(() => PluginManifestSchema.parse({ ...BASE, tools: [LEGACY_TOOL] })).toThrow(
      /summary/
    );
  });

  it('rejects a manifest with neither skills nor tools', () => {
    expect(() => PluginManifestSchema.parse({ ...BASE, summary: 'x' })).toThrow(/skills/);
  });

  it('rejects a skill id that is not plugin-qualified', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...BASE,
        summary: 'x',
        skills: [{ id: 'setreminder', description: 'Set', parameters: {} }],
      })
    ).toThrow();
  });
});

// ─── UI descriptors (Phase C, see UI-CONTRACT.md) ────────────────────────────

const uiManifest = (ui: unknown) => ({
  ...BASE,
  summary: 'x',
  skills: [
    { id: 'reminders.set-reminder', description: 'Set', parameters: { type: 'object' }, ui },
  ],
});

describe('SkillUiDescriptorSchema: block requirements', () => {
  it('accepts a form with fields', () => {
    const m = PluginManifestSchema.parse(
      uiManifest({
        block: 'form',
        label: 'Set reminder',
        fields: [{ name: 'message', type: 'text', label: 'Remind me to' }],
      })
    );
    expect(m.skills[0]!.ui!.block).toBe('form');
    expect(m.skills[0]!.ui!.fields).toHaveLength(1);
  });

  it('accepts an action block with no extra config', () => {
    expect(() =>
      PluginManifestSchema.parse(uiManifest({ block: 'action', label: 'Status' }))
    ).not.toThrow();
  });

  it('rejects a list without an item descriptor', () => {
    expect(() =>
      PluginManifestSchema.parse(uiManifest({ block: 'list', label: 'Tasks' }))
    ).toThrow(/requires an .*item.* descriptor/);
  });

  it('rejects a timer without a mode', () => {
    expect(() =>
      PluginManifestSchema.parse(
        uiManifest({ block: 'timer', label: 'T', item: { title: 'message', deadline: 'fireAtMs' } })
      )
    ).toThrow(/Timer block requires/);
  });

  it('rejects a countdown timer whose item has no deadline', () => {
    expect(() =>
      PluginManifestSchema.parse(
        uiManifest({ block: 'timer', label: 'T', mode: 'countdown', item: { title: 'message' } })
      )
    ).toThrow(/deadline/);
  });

  it('rejects an elapsed timer whose item has no since', () => {
    expect(() =>
      PluginManifestSchema.parse(
        uiManifest({ block: 'timer', label: 'T', mode: 'elapsed', item: { title: 'taskName' } })
      )
    ).toThrow(/since/);
  });

  it('defaults an item action style to secondary and args to empty', () => {
    const m = PluginManifestSchema.parse(
      uiManifest({
        block: 'list',
        label: 'Tasks',
        item: { title: 'content' },
        actions: [{ skill: 'todoist.complete-task', label: 'Complete' }],
      })
    );
    expect(m.skills[0]!.ui!.actions![0]!.style).toBe('secondary');
    expect(m.skills[0]!.ui!.actions![0]!.args).toEqual({});
  });

  it('rejects an item action pointing at a non-qualified skill id', () => {
    expect(() =>
      PluginManifestSchema.parse(
        uiManifest({
          block: 'list',
          label: 'Tasks',
          item: { title: 'content' },
          actions: [{ skill: 'complete', label: 'Complete' }],
        })
      )
    ).toThrow();
  });
});

describe('SkillUiDescriptorSchema: the escape hatch', () => {
  it('accepts custom UI when a standard block fallback is present', () => {
    const m = PluginManifestSchema.parse(
      uiManifest({
        block: 'form',
        label: 'Log a meal',
        fields: [{ name: 'message', type: 'text', label: 'What did you eat?' }],
        custom: { mobile: 'screens/MealLogger.tsx' },
      })
    );
    expect(m.skills[0]!.ui!.custom).toEqual({ mobile: 'screens/MealLogger.tsx' });
    expect(m.skills[0]!.ui!.block).toBe('form');
  });

  it('rejects custom UI with no standard fallback — the TUI cannot run custom code', () => {
    expect(() =>
      PluginManifestSchema.parse(uiManifest({ label: 'Log a meal', custom: { mobile: 'x.tsx' } }))
    ).toThrow();
  });

  it('still enforces block completeness when custom UI is present', () => {
    // A custom mobile screen must not excuse an unrenderable TUI fallback.
    expect(() =>
      PluginManifestSchema.parse(
        uiManifest({ block: 'list', label: 'Meals', custom: { mobile: 'x.tsx' } })
      )
    ).toThrow(/requires an .*item.* descriptor/);
  });
});
