import { describe, it, expect } from 'bun:test';
import { isCapabilityQuestion, capabilityDetail, describeCapabilities } from './capabilities.js';
import { PluginManifestSchema } from '@tardis/shared';
import type { PluginManifest } from '@tardis/shared';

// ─── The live transcript ─────────────────────────────────────────────────────
//
// Six real messages from one conversation, none of which the previous matcher
// caught. They are the specification.

describe('isCapabilityQuestion: the messages that were missed', () => {
  const REAL = [
    'hola tardis, what are capable of',
    '/plugins',
    'give me list of the plugins and tools you have',
    'do you have any other tools? and if yes give me there names and what they can do',
  ];

  for (const text of REAL) {
    it(`catches ${JSON.stringify(text)}`, () => {
      expect(isCapabilityQuestion(text)).toBe(true);
    });
  }

  it('still catches the textbook phrasings', () => {
    for (const t of [
      'what can you do',
      'What can you do?',
      'what are you capable of',
      'what can you help me with',
      'help',
      'commands',
      'capabilities',
      '/help',
      'what tools do you have?',
      'which plugins are loaded?',
      'list your skills',
      'show me your tools',
    ]) {
      expect({ t, matched: isCapabilityQuestion(t) }).toMatchObject({ matched: true });
    }
  });

  it('does not hijack an instruction that merely mentions a tool', () => {
    // The failure mode this must not have. An earlier matcher on `help\b`
    // swallowed "help me log lunch"; a naive noun match would swallow these.
    for (const t of [
      'help me log lunch',
      'add a note about the plugins I want to build',
      'remind me to buy new tools for the garage',
      'search the web for plugin architecture',
      'save a note titled tools',
      'I need to fix the budget plugin tomorrow',
      'delete my note about commands',
    ]) {
      expect({ t, matched: isCapabilityQuestion(t) }).toMatchObject({ matched: false });
    }
  });

  it('does not answer a question about the user rather than about TARDIS', () => {
    for (const t of ['what can I do with my budget?', 'what do I have left to spend?']) {
      expect({ t, matched: isCapabilityQuestion(t) }).toMatchObject({ matched: false });
    }
  });

  it('survives a typo in the verb', () => {
    // Live: "what arre capable of" fell through to the model, which answered
    // with the handful of tools it happened to be holding rather than the nine
    // plugins actually installed.
    for (const t of ['what arre capable of', 'what are u capable of', 'whats your capabilities']) {
      expect({ t, matched: isCapabilityQuestion(t) }).toMatchObject({ matched: true });
    }
  });

  it('does not treat the user\'s own capability as a question about TARDIS', () => {
    expect(isCapabilityQuestion('am I capable of finishing this today?')).toBe(false);
  });

  it('ignores an empty message', () => {
    expect(isCapabilityQuestion('   ')).toBe(false);
  });

  it('does not catch a bare follow-up, and that is the right call', () => {
    // "can you give me there names and what they can do?" — turn 4 of the live
    // transcript. "their" refers to the plugins named a moment earlier, and
    // nothing in the sentence itself is about capabilities: the same words
    // could ask about notes, reminders or calendar events.
    //
    // Matching it would mean guessing, and the guess would sometimes hijack a
    // real request. It is also a question that only got asked because turn 3
    // answered badly — which it no longer does, since "give me list of the
    // plugins and tools you have" now returns the full list first time.
    expect(isCapabilityQuestion('can you give me there names and what they can do?')).toBe(false);
  });
});

describe('capabilityDetail', () => {
  it('gives the summary for an open question', () => {
    expect(capabilityDetail('what can you do')).toBe('overview');
    expect(capabilityDetail('hola tardis, what are capable of')).toBe('overview');
  });

  it('gives the full list when they asked for one', () => {
    // Twice in the live transcript, and twice answered with a blurb instead.
    for (const t of [
      'give me list of the plugins and tools you have',
      'can you give me there names and what they can do?',
      '/plugins',
      'list every skill',
      'what are all the tools you have?',
    ]) {
      expect({ t, level: capabilityDetail(t) }).toMatchObject({ level: 'detail' });
    }
  });
});

// ─── The answer ──────────────────────────────────────────────────────────────

function manifest(name: string, displayName: string, skills: [string, string][]): PluginManifest {
  return PluginManifestSchema.parse({
    name,
    version: '1.0.0',
    displayName,
    description: `${displayName} plugin`,
    summary: `Does ${displayName} things. Second sentence that should not appear in the overview.`,
    tier: 1,
    main: 'index.ts',
    permissions: [],
    skills: skills.map(([id, description]) => ({
      id: `${name}.${id}`,
      description,
      parameters: { type: 'object', properties: {} },
    })),
  });
}

const MANIFESTS = [
  manifest('budget', 'Budget', [
    ['add-entry', 'Record a spend the user has already made. Extra detail here.'],
    ['this-month', "List this month's spending"],
  ]),
  manifest('notes', 'Notes', [['save-note', 'Save a note']]),
  manifest('test-plugin', 'Test Plugin', [['ping', 'Ping']]),
];

describe('describeCapabilities', () => {
  it('counts every skill, and names every plugin', () => {
    const out = describeCapabilities(MANIFESTS, 'overview');
    expect(out).toContain('Budget');
    expect(out).toContain('Notes');
    // 3 skills across 2 plugins — test-plugin is not a capability.
    expect(out).toContain('3 things');
    expect(out).toContain('2 plugins');
  });

  it('hides the test plugin', () => {
    expect(describeCapabilities(MANIFESTS, 'overview')).not.toContain('Test Plugin');
    expect(describeCapabilities(MANIFESTS, 'detail')).not.toContain('Test Plugin');
  });

  it('trims a summary to its first sentence', () => {
    // Manifest summaries are written for the plugin router, and run long.
    expect(describeCapabilities(MANIFESTS, 'overview')).not.toContain('should not appear');
  });

  it('names each skill when the full list was asked for', () => {
    const out = describeCapabilities(MANIFESTS, 'detail');
    expect(out).toContain('add-entry');
    expect(out).toContain('this-month');
    expect(out).toContain('save-note');
  });

  it('drops the plugin prefix from a skill name, since the plugin is the heading', () => {
    const out = describeCapabilities(MANIFESTS, 'detail');
    expect(out).toContain('• add-entry');
    expect(out).not.toContain('budget.add-entry');
  });

  it('emits no markup, because only one of four surfaces parses Markdown', () => {
    // The Telegram path that already reached this answer replied without
    // parse_mode, so its asterisks rendered literally.
    for (const level of ['overview', 'detail'] as const) {
      expect(describeCapabilities(MANIFESTS, level)).not.toMatch(/[*_`]/);
    }
  });

  it('stays inside a message length Telegram will accept', () => {
    // 40 plugins is far past anything real, and the answer must still send.
    const many = Array.from({ length: 40 }, (_, i) =>
      manifest(`p${i}`, `Plugin ${i}`, [
        ['alpha', 'Does the alpha thing with quite a long description attached to it'],
        ['beta', 'Does the beta thing with quite a long description attached to it'],
      ])
    );
    const out = describeCapabilities(many, 'detail');
    expect(out.length).toBeLessThanOrEqual(4096);
    // Still a complete answer: every plugin named, nothing silently dropped.
    expect(out).toContain('Plugin 0');
    expect(out).toContain('Plugin 39');
  });

  it('says so plainly when there is nothing loaded', () => {
    // The AI can only act through plugins, so "I can help with many things"
    // would be a lie here.
    expect(describeCapabilities([], 'overview')).toContain('nothing I can do');
  });
});
