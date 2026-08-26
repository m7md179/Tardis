import { describe, it, expect } from 'bun:test';
import { selectPlugins } from './plugin-router.js';
import type { LLMProvider } from '../llm/provider.js';
import { PluginManifestSchema } from '@tardis/shared';
import type { PluginManifest } from '@tardis/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePlugin(name: string, summary: string, toolCount = 1): PluginManifest {
  return PluginManifestSchema.parse({
    name,
    version: '1.0.0',
    displayName: name,
    description: `${name} plugin`,
    tier: 1,
    main: 'index.ts',
    summary,
    permissions: [],
    tools: Array.from({ length: toolCount }, (_, i) => ({
      name: `${name}.tool-${i + 1}`,
      description: `Tool ${i + 1}`,
      parameters: { type: 'object', properties: {} },
      actionType: 'direct' as const,
    })),
  });
}

const TIME_TRACKER = makePlugin(
  'time-tracker',
  'Track time spent working on tasks. Start, stop, pause, and resume timers.',
  2
);
const TODOIST = makePlugin(
  'todoist',
  'Manage tasks in Todoist. Create, complete, update, and delete tasks.',
  3
);
const CALENDAR = makePlugin(
  'google-calendar',
  'Manage Google Calendar events. List schedule and create events.',
  2
);
const NOTES = makePlugin('notes', 'Save and recall quick notes and personal facts.', 1);
const REMINDERS = makePlugin('reminders', 'Set timed reminders and notifications.', 1);

const ALL_PLUGINS = [TIME_TRACKER, TODOIST, CALENDAR, NOTES, REMINDERS];

// ─── Mock LLM ─────────────────────────────────────────────────────────────────

function makeLLM(response: string): LLMProvider {
  return {
    name: 'mock',
    async chat() {
      return { type: 'text' as const, text: response };
    },
    async generate() {
      return response;
    },
  };
}

// ─── Empty plugin list ────────────────────────────────────────────────────────

describe('selectPlugins: empty plugin list', () => {
  it('returns empty result when no plugins are loaded', async () => {
    const llm = makeLLM('[]');
    const result = await selectPlugins('hello', [], llm);

    expect(result.selectedPlugins).toHaveLength(0);
    expect(result.tools).toHaveLength(0);
    expect(result.method).toBe('empty');
    expect(result.selectionDurationMs).toBe(0);
  });
});

// ─── LLM selection ────────────────────────────────────────────────────────────

describe('selectPlugins: LLM selection', () => {
  it('selects the correct plugins from LLM response', async () => {
    const llm = makeLLM('["google-calendar", "todoist"]');
    const result = await selectPlugins('What do I have tomorrow?', ALL_PLUGINS, llm);

    expect(result.method).toBe('llm');
    expect(result.selectedPlugins).toContain('google-calendar');
    expect(result.selectedPlugins).toContain('todoist');
  });

  it('returns full tool schemas for selected plugins only', async () => {
    const llm = makeLLM('["time-tracker"]');
    const result = await selectPlugins('Start a timer', ALL_PLUGINS, llm);

    // time-tracker has 2 tools, no other plugin's tools should be included
    expect(result.tools).toHaveLength(2);
    expect(result.tools.every((t) => t.name.startsWith('time-tracker.'))).toBe(true);
  });

  it('returns empty tools when LLM selects no plugins (chatbot mode)', async () => {
    const llm = makeLLM('[]');
    const result = await selectPlugins('Hello! How are you?', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toHaveLength(0);
    expect(result.tools).toHaveLength(0);
    expect(result.method).toBe('llm');
  });

  it('filters out hallucinated plugin names', async () => {
    const llm = makeLLM('["time-tracker", "nonexistent-plugin"]');
    const result = await selectPlugins('Start a timer', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toContain('time-tracker');
    expect(result.selectedPlugins).not.toContain('nonexistent-plugin');
  });

  it('handles LLM response wrapped in markdown code fences', async () => {
    const llm = makeLLM('```json\n["notes"]\n```');
    const result = await selectPlugins('Save a note', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toContain('notes');
    expect(result.method).toBe('llm');
  });

  it('handles LLM response in plain code fences', async () => {
    const llm = makeLLM('```\n["reminders"]\n```');
    const result = await selectPlugins('Set a reminder', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toContain('reminders');
  });

  it('includes selectionDurationMs in the result', async () => {
    const llm = makeLLM('["notes"]');
    const result = await selectPlugins('Note something', ALL_PLUGINS, llm);

    expect(typeof result.selectionDurationMs).toBe('number');
    expect(result.selectionDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Fallback: malformed LLM response ────────────────────────────────────────

describe('selectPlugins: fallback on malformed response', () => {
  it('falls back to all plugins when LLM returns invalid JSON', async () => {
    const llm = makeLLM('not valid json at all');
    const result = await selectPlugins('Do something', ALL_PLUGINS, llm);

    expect(result.method).toBe('fallback');
    expect(result.selectedPlugins).toHaveLength(ALL_PLUGINS.length);
  });

  it('recovers the plugin from a JSON object instead of falling back to everything', async () => {
    // Previously this fell back and loaded ALL plugins. The model plainly said
    // time-tracker; honouring that beats sending it 37 tools it did not ask for.
    const llm = makeLLM('{"plugins": ["time-tracker"]}');
    const result = await selectPlugins('Start timer', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toEqual(['time-tracker']);
  });

  it('falls back to all plugins when LLM returns an array of non-strings', async () => {
    const llm = makeLLM('[1, 2, 3]');
    const result = await selectPlugins('Do something', ALL_PLUGINS, llm);

    expect(result.method).toBe('fallback');
  });

  it('falls back to all plugins when LLM call throws', async () => {
    const failingLlm: LLMProvider = {
      name: 'mock',
      async chat() {
        return { type: 'text' as const, text: '' };
      },
      async generate() {
        throw new Error('LLM unavailable');
      },
    };
    const result = await selectPlugins('Do something', ALL_PLUGINS, failingLlm);

    expect(result.method).toBe('fallback');
    expect(result.selectedPlugins).toHaveLength(ALL_PLUGINS.length);
  });

  it('fallback includes all tools from all plugins', async () => {
    const llm = makeLLM('{broken}');
    const result = await selectPlugins('Do something', ALL_PLUGINS, llm);

    const totalTools = ALL_PLUGINS.reduce((sum, p) => sum + p.tools.length, 0);
    expect(result.tools).toHaveLength(totalTools);
  });
});

// ─── Explicit plugin mention ──────────────────────────────────────────────────

describe('selectPlugins: explicit plugin mention', () => {
  it('bypasses LLM when message contains "use <plugin-name>"', async () => {
    let llmCalled = false;
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        return { type: 'text' as const, text: '[]' };
      },
      async generate() {
        llmCalled = true;
        return '[]';
      },
    };

    const result = await selectPlugins('use todoist to add a task', ALL_PLUGINS, llm);

    expect(llmCalled).toBe(false);
    expect(result.method).toBe('explicit');
    expect(result.selectedPlugins).toEqual(['todoist']);
  });

  it('bypasses LLM when message contains "using <plugin-name>"', async () => {
    let llmCalled = false;
    const llm: LLMProvider = {
      name: 'mock',
      async chat() {
        return { type: 'text' as const, text: '[]' };
      },
      async generate() {
        llmCalled = true;
        return '[]';
      },
    };

    const result = await selectPlugins('I am using time-tracker for this', ALL_PLUGINS, llm);

    expect(llmCalled).toBe(false);
    expect(result.method).toBe('explicit');
    expect(result.selectedPlugins).toEqual(['time-tracker']);
  });

  it('explicit match returns tools only for that plugin', async () => {
    const llm = makeLLM('[]');
    const result = await selectPlugins('use notes to save this', ALL_PLUGINS, llm);

    expect(result.tools).toHaveLength(1);
    expect(result.tools.every((t) => t.name.startsWith('notes.'))).toBe(true);
  });

  it('case-insensitive matching for explicit plugin name', async () => {
    const llm = makeLLM('[]');
    const result = await selectPlugins('Use TODOIST to create a task', ALL_PLUGINS, llm);

    expect(result.method).toBe('explicit');
    expect(result.selectedPlugins).toContain('todoist');
  });
});

// ─── Tolerating the model's actual output shape ──────────────────────────────
//
// gemma-4-E2B routinely answers `[time-tracker]` — the correct plugin, but
// unquoted, so JSON.parse throws. That sent the router to its fallback and
// loaded every plugin's schemas: 2 of 3 realistic queries once eight plugins
// were installed, ~3,000 wasted tokens and 37 tools where six were needed.

describe('selectPlugins: malformed-but-recognisable responses', () => {
  it('accepts an unquoted single name', async () => {
    const llm = makeLLM('[time-tracker]');
    const result = await selectPlugins('what am I tracking?', ALL_PLUGINS, llm);
    expect(result.selectedPlugins).toEqual(['time-tracker']);
    expect(result.method).toBe('llm');
  });

  it('accepts unquoted names with prose around them', async () => {
    const llm = makeLLM('The relevant plugin is [notes].');
    const result = await selectPlugins('save a note', ALL_PLUGINS, llm);
    expect(result.selectedPlugins).toEqual(['notes']);
  });

  it('picks up several unquoted names', async () => {
    const llm = makeLLM('[time-tracker, notes]');
    const result = await selectPlugins('track and note', ALL_PLUGINS, llm);
    expect(result.selectedPlugins).toContain('time-tracker');
    expect(result.selectedPlugins).toContain('notes');
  });

  it('still prefers strict JSON when the model gets it right', async () => {
    const llm = makeLLM('["notes"]');
    expect((await selectPlugins('note', ALL_PLUGINS, llm)).selectedPlugins).toEqual(['notes']);
  });

  it('treats an empty array as "no plugins", not as unparseable', async () => {
    // Otherwise casual conversation would load every tool schema.
    const llm = makeLLM('[]');
    const result = await selectPlugins('hello there', ALL_PLUGINS, llm);
    expect(result.selectedPlugins).toEqual([]);
    expect(result.tools).toEqual([]);
  });

  it('ignores names the model invented', async () => {
    const llm = makeLLM('[weather, stocks]');
    const result = await selectPlugins('what is the weather', ALL_PLUGINS, llm);
    // Nothing recognisable — falling back to everything is correct here.
    expect(result.method).toBe('fallback');
  });

  it('does not match a plugin name embedded in a longer word', async () => {
    const llm = makeLLM('[notesapp]');
    expect((await selectPlugins('x', ALL_PLUGINS, llm)).method).toBe('fallback');
  });
});
