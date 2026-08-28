import { describe, it, expect } from 'bun:test';
import { tokenize, scoreAgainst, prefilter, rankCandidates } from './ranking.js';
import type { WorkItem } from './types.js';

function epic(id: number, title: string, description: string | null = null): WorkItem {
  return {
    id,
    workspace_id: 1,
    type: 'EPIC',
    title,
    description,
    status: 'BACKLOG',
    priority: 'MEDIUM',
    story_points: null,
    estimate_hours: null,
    start_date: null,
    due_date: null,
    parent_id: null,
    sprint_id: null,
    reporter_account_id: 1,
    assignees: [],
    archived_at: null,
  };
}

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Rate-limit the LOGIN endpoint')).toContain('rate');
    expect(tokenize('Rate-limit the LOGIN endpoint')).toContain('login');
  });

  it('drops stopwords and very short tokens', () => {
    const t = tokenize('add a rate limit to the login endpoint');
    expect(t).not.toContain('a');
    expect(t).not.toContain('to');
    expect(t).not.toContain('the');
    expect(t).not.toContain('add');
  });

  it('returns an empty list for text with nothing meaningful in it', () => {
    expect(tokenize('a to the and of')).toEqual([]);
  });
});

describe('scoreAgainst', () => {
  const DESC = 'add rate limiting to the login endpoint';

  it('scores the obviously-right epic above zero — the thing fuzzyScore alone cannot do', () => {
    expect(scoreAgainst(DESC, { title: 'Login rate limits', description: null })).toBeGreaterThan(0);
  });

  it('ranks the right epic above unrelated ones', () => {
    const right = scoreAgainst(DESC, { title: 'Login rate limits', description: null });
    const wrong = scoreAgainst(DESC, { title: 'Billing & Invoicing', description: null });
    expect(right).toBeGreaterThan(wrong);
  });

  it('lets a description contribute, but less than a title', () => {
    const inTitle = scoreAgainst(DESC, { title: 'Login hardening', description: null });
    const inDesc = scoreAgainst(DESC, { title: 'Platform', description: 'Login hardening work' });
    expect(inDesc).toBeGreaterThan(0);
    expect(inTitle).toBeGreaterThan(inDesc);
  });

  it('returns 0 when the query has no usable tokens, instead of dividing by zero', () => {
    expect(scoreAgainst('a to the', { title: 'Anything', description: null })).toBe(0);
  });
});

describe('prefilter', () => {
  const EPICS = [
    epic(1, 'Authentication hardening'),
    epic(2, 'Billing & Invoicing'),
    epic(3, 'Login rate limits'),
    epic(4, 'Performance'),
    epic(5, 'Rate limiting and throttling'),
  ];

  it('puts the best match first', () => {
    const out = prefilter('add rate limiting to the login endpoint', EPICS);
    expect([3, 5]).toContain(out[0]!.id);
  });

  it('honours the limit by truncating, not by padding', () => {
    // "rate limiting login" scores 0.600 on both epic 3 and epic 5 and 0 on the
    // rest, so a limit of 1 has something real to cut.
    expect(prefilter('rate limiting login', EPICS)).toHaveLength(2);
    expect(prefilter('rate limiting login', EPICS, 1)).toHaveLength(1);
  });

  it('scores only the relevant epics, leaving unrelated ones at zero', () => {
    // The measured shape this whole file exists for: the full description
    // scores 0.450 on both correct epics and 0.000 on everything else.
    const out = prefilter('add rate limiting to the login endpoint', EPICS);
    expect(out.map((e) => e.id).sort()).toEqual([3, 5]);
  });

  it('drops zero-scoring items rather than padding the list', () => {
    const out = prefilter('quantum entanglement', EPICS);
    expect(out).toHaveLength(0);
  });

  it('falls back to every item when the query is unusable, rather than returning nothing', () => {
    // "a to the" has no tokens. Returning [] would strand the user with no
    // options at all; returning everything lets them pick.
    const out = prefilter('a to the', EPICS);
    expect(out).toHaveLength(5);
  });
});

// Two of these survive the prefilter for QUERY (both score 0.450), which is
// what makes the model actually get consulted. With only one survivor
// rankCandidates short-circuits and never calls generate — correct behaviour,
// but it makes the re-rank tests below pass without testing anything.
const EPICS3 = [
  epic(1, 'Authentication hardening'),
  epic(2, 'Billing & Invoicing'),
  epic(3, 'Login rate limits'),
  epic(5, 'Rate limiting and throttling'),
];
const noopLog = { debug: (): void => {}, warn: (): void => {} };
const QUERY = 'add rate limiting to the login endpoint';

describe('rankCandidates', () => {
  it('returns the LLM ordering when the response is clean', async () => {
    const out = await rankCandidates(
      { generate: async () => '[{"id":3,"reason":"about login rate limits"}]', logger: noopLog },
      QUERY,
      EPICS3
    );
    expect(out[0]!.id).toBe(3);
    expect(out[0]!.title).toBe('Login rate limits');
    expect(out[0]!.reason).toBe('about login rate limits');
  });

  it('strips markdown fences, which small models add unprompted', async () => {
    const out = await rankCandidates(
      { generate: async () => '```json\n[{"id":3,"reason":"x"}]\n```', logger: noopLog },
      QUERY,
      EPICS3
    );
    expect(out[0]!.id).toBe(3);
  });

  it('discards ids the model invented', async () => {
    const out = await rankCandidates(
      {
        generate: async () => '[{"id":999,"reason":"made up"},{"id":3,"reason":"real"}]',
        logger: noopLog,
      },
      QUERY,
      EPICS3
    );
    expect(out.map((c) => c.id)).toEqual([3]);
  });

  it('falls back to the fuzzy order when the response is not JSON', async () => {
    const out = await rankCandidates(
      { generate: async () => 'I think it is probably the login one!', logger: noopLog },
      QUERY,
      EPICS3
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.reason).toBeNull();
  });

  it('falls back when the LLM throws, rather than failing the whole draft', async () => {
    const out = await rankCandidates(
      {
        generate: async () => {
          throw new Error('ollama unreachable');
        },
        logger: noopLog,
      },
      QUERY,
      EPICS3
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it('falls back when every id was invented, rather than returning nothing', async () => {
    const out = await rankCandidates(
      { generate: async () => '[{"id":999,"reason":"nope"}]', logger: noopLog },
      QUERY,
      EPICS3
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it('never asks the model when there is nothing to choose between', async () => {
    let called = false;
    const out = await rankCandidates(
      {
        generate: async () => {
          called = true;
          return '[]';
        },
        logger: noopLog,
      },
      QUERY,
      [epic(3, 'Login rate limits')]
    );
    expect(called).toBe(false);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(3);
  });

  it('does consult the model when there is a real choice to make', async () => {
    // Guards the fixture above: if the prefilter ever narrows QUERY to one
    // epic again, every re-rank test silently stops testing the re-rank.
    let called = false;
    await rankCandidates(
      {
        generate: async () => {
          called = true;
          return '[{"id":3,"reason":"x"}]';
        },
        logger: noopLog,
      },
      QUERY,
      EPICS3
    );
    expect(called).toBe(true);
  });

  it('returns nothing when there are no items at all', async () => {
    const out = await rankCandidates({ generate: async () => '[]', logger: noopLog }, QUERY, []);
    expect(out).toEqual([]);
  });

  it('caps the result at topN', async () => {
    const many = Array.from({ length: 8 }, (_, i) => epic(i + 1, `Login thing ${i + 1}`));
    const out = await rankCandidates(
      { generate: async () => 'not json', logger: noopLog },
      'login',
      many,
      3
    );
    expect(out.length).toBeLessThanOrEqual(3);
  });
});
