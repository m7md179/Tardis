import { describe, it, expect } from 'bun:test';
import { compose, composeFallback, parseComposition } from './compose.js';
import type { Commit } from './compose.js';

const noopLog = { debug: (): void => {}, warn: (): void => {} };

function commit(subject: string, body = ''): Commit {
  return { subject, body, sha: 'abc1234' };
}

describe('composeFallback', () => {
  it('turns a branch name into words, dropping the type prefix', () => {
    const out = composeFallback('feat/auto-submit-week-on-build', []);
    expect(out.title).toBe('Auto submit week on build');
  });

  it('keeps a branch name that has no prefix', () => {
    expect(composeFallback('auto-submit-week', []).title).toBe('Auto submit week');
  });

  it('lists the commit subjects as the description', () => {
    const out = composeFallback('fix/x', [commit('Stop the nag firing twice'), commit('Add a test')]);
    expect(out.description).toContain('Stop the nag firing twice');
    expect(out.description).toContain('Add a test');
  });

  it('never returns an empty title, whatever the branch name was', () => {
    // A title is required by the server; an empty one fails creation outright.
    expect(composeFallback('---', []).title.length).toBeGreaterThan(0);
    expect(composeFallback('', []).title.length).toBeGreaterThan(0);
  });
});

describe('parseComposition', () => {
  it('reads clean JSON', () => {
    expect(parseComposition('{"title":"T","description":"D"}')).toEqual({
      title: 'T',
      description: 'D',
    });
  });

  it('strips markdown fences, which small models add unprompted', () => {
    // Same failure the parent re-ranker hit against a real model.
    expect(parseComposition('```json\n{"title":"T","description":"D"}\n```')?.title).toBe('T');
  });

  it('rejects prose', () => {
    expect(parseComposition('I think the title should be T!')).toBeNull();
  });

  it('rejects an object with no usable title', () => {
    expect(parseComposition('{"title":"","description":"D"}')).toBeNull();
    expect(parseComposition('{"description":"D"}')).toBeNull();
  });
});

describe('compose', () => {
  const commits = [commit('Stop the nag firing twice')];

  it('uses the model when it answers cleanly', async () => {
    const out = await compose(
      { generate: async () => '{"title":"Fix duplicate nag","description":"D"}', logger: noopLog },
      'fix/nag',
      commits
    );
    expect(out.title).toBe('Fix duplicate nag');
  });

  it('falls back rather than throwing when the model is unreachable', async () => {
    // A push already succeeded by the time this runs. Throwing here would
    // lose the item entirely over a transient LLM failure.
    const out = await compose(
      {
        generate: async () => {
          throw new Error('ollama unreachable');
        },
        logger: noopLog,
      },
      'fix/nag',
      commits
    );
    expect(out.title).toBe('Nag');
    expect(out.description).toContain('Stop the nag firing twice');
  });

  it('falls back when the model answers with prose', async () => {
    const out = await compose(
      { generate: async () => 'Sure! Here is a nice title.', logger: noopLog },
      'fix/nag',
      commits
    );
    expect(out.title).toBe('Nag');
  });
});
