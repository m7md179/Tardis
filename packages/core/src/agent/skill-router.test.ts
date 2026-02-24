import { describe, it, expect } from 'bun:test';
import { selectPluginSkills } from './skill-router.js';
import type { LLMProvider } from '../llm/provider.js';
import type { PluginManifest } from '@tardis/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePlugin(name: string, skillSummary: string, toolCount = 1): PluginManifest {
  return {
    name,
    version: '1.0.0',
    displayName: name,
    description: `${name} plugin`,
    tier: 1,
    main: 'index.ts',
    skillSummary,
    permissions: [],
    tools: Array.from({ length: toolCount }, (_, i) => ({
      name: `${name}.tool-${i + 1}`,
      description: `Tool ${i + 1}`,
      parameters: { type: 'object', properties: {} },
      actionType: 'direct' as const,
    })),
  };
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

describe('selectPluginSkills: empty plugin list', () => {
  it('returns empty result when no plugins are loaded', async () => {
    const llm = makeLLM('[]');
    const result = await selectPluginSkills('hello', [], llm);

    expect(result.selectedPlugins).toHaveLength(0);
    expect(result.tools).toHaveLength(0);
    expect(result.method).toBe('empty');
    expect(result.selectionDurationMs).toBe(0);
  });
});

// ─── LLM selection ────────────────────────────────────────────────────────────

describe('selectPluginSkills: LLM selection', () => {
  it('selects the correct plugins from LLM response', async () => {
    const llm = makeLLM('["google-calendar", "todoist"]');
    const result = await selectPluginSkills('What do I have tomorrow?', ALL_PLUGINS, llm);

    expect(result.method).toBe('llm');
    expect(result.selectedPlugins).toContain('google-calendar');
    expect(result.selectedPlugins).toContain('todoist');
  });

  it('returns full tool schemas for selected plugins only', async () => {
    const llm = makeLLM('["time-tracker"]');
    const result = await selectPluginSkills('Start a timer', ALL_PLUGINS, llm);

    // time-tracker has 2 tools, no other plugin's tools should be included
    expect(result.tools).toHaveLength(2);
    expect(result.tools.every((t) => t.name.startsWith('time-tracker.'))).toBe(true);
  });

  it('returns empty tools when LLM selects no plugins (chatbot mode)', async () => {
    const llm = makeLLM('[]');
    const result = await selectPluginSkills('Hello! How are you?', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toHaveLength(0);
    expect(result.tools).toHaveLength(0);
    expect(result.method).toBe('llm');
  });

  it('filters out hallucinated plugin names', async () => {
    const llm = makeLLM('["time-tracker", "nonexistent-plugin"]');
    const result = await selectPluginSkills('Start a timer', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toContain('time-tracker');
    expect(result.selectedPlugins).not.toContain('nonexistent-plugin');
  });

  it('handles LLM response wrapped in markdown code fences', async () => {
    const llm = makeLLM('```json\n["notes"]\n```');
    const result = await selectPluginSkills('Save a note', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toContain('notes');
    expect(result.method).toBe('llm');
  });

  it('handles LLM response in plain code fences', async () => {
    const llm = makeLLM('```\n["reminders"]\n```');
    const result = await selectPluginSkills('Set a reminder', ALL_PLUGINS, llm);

    expect(result.selectedPlugins).toContain('reminders');
  });

  it('includes selectionDurationMs in the result', async () => {
    const llm = makeLLM('["notes"]');
    const result = await selectPluginSkills('Note something', ALL_PLUGINS, llm);

    expect(typeof result.selectionDurationMs).toBe('number');
    expect(result.selectionDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Fallback: malformed LLM response ────────────────────────────────────────

describe('selectPluginSkills: fallback on malformed response', () => {
  it('falls back to all plugins when LLM returns invalid JSON', async () => {
    const llm = makeLLM('not valid json at all');
    const result = await selectPluginSkills('Do something', ALL_PLUGINS, llm);

    expect(result.method).toBe('fallback');
    expect(result.selectedPlugins).toHaveLength(ALL_PLUGINS.length);
  });

  it('falls back to all plugins when LLM returns a JSON object instead of array', async () => {
    const llm = makeLLM('{"plugins": ["time-tracker"]}');
    const result = await selectPluginSkills('Start timer', ALL_PLUGINS, llm);

    expect(result.method).toBe('fallback');
  });

  it('falls back to all plugins when LLM returns an array of non-strings', async () => {
    const llm = makeLLM('[1, 2, 3]');
    const result = await selectPluginSkills('Do something', ALL_PLUGINS, llm);

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
    const result = await selectPluginSkills('Do something', ALL_PLUGINS, failingLlm);

    expect(result.method).toBe('fallback');
    expect(result.selectedPlugins).toHaveLength(ALL_PLUGINS.length);
  });

  it('fallback includes all tools from all plugins', async () => {
    const llm = makeLLM('{broken}');
    const result = await selectPluginSkills('Do something', ALL_PLUGINS, llm);

    const totalTools = ALL_PLUGINS.reduce((sum, p) => sum + p.tools.length, 0);
    expect(result.tools).toHaveLength(totalTools);
  });
});

// ─── Explicit plugin mention ──────────────────────────────────────────────────

describe('selectPluginSkills: explicit plugin mention', () => {
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

    const result = await selectPluginSkills('use todoist to add a task', ALL_PLUGINS, llm);

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

    const result = await selectPluginSkills('I am using time-tracker for this', ALL_PLUGINS, llm);

    expect(llmCalled).toBe(false);
    expect(result.method).toBe('explicit');
    expect(result.selectedPlugins).toEqual(['time-tracker']);
  });

  it('explicit match returns tools only for that plugin', async () => {
    const llm = makeLLM('[]');
    const result = await selectPluginSkills('use notes to save this', ALL_PLUGINS, llm);

    expect(result.tools).toHaveLength(1);
    expect(result.tools.every((t) => t.name.startsWith('notes.'))).toBe(true);
  });

  it('case-insensitive matching for explicit plugin name', async () => {
    const llm = makeLLM('[]');
    const result = await selectPluginSkills('Use TODOIST to create a task', ALL_PLUGINS, llm);

    expect(result.method).toBe('explicit');
    expect(result.selectedPlugins).toContain('todoist');
  });
});
