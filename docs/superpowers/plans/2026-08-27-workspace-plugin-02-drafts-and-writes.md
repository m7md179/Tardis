# Workspace Plugin — Plan 2: Drafts, Ranking & Writes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Describe a task in plain language and get a correctly-parented work item in internal-operation, with points, estimate, due date, priority and assignees — plus the write skills to move it around afterwards.

**Architecture:** A `Draft` object in plugin storage holds the half-built item across turns; the built-in `clarify` pseudo-tool asks the questions. The plugin composes each question deterministically from slot state and the server's own rules, so the *structure* of the conversation never depends on the model — the LLM only parses answers and relays text. Parent candidates come from token-aware fuzzy ranking, then one LLM re-rank.

**Tech Stack:** Bun 1.3.8, TypeScript 5.7, `bun:test`, `PluginAPI.llm.generate`, the `IoClient` from Plan 1.

**Spec:** `docs/specs/2026-08-27-workspace-plugin-design.md`
**Verified server behaviour:** `docs/workspace-plugin-setup.md` — read this before starting; it overrides the spec where they disagree.
**Builds on:** `docs/superpowers/plans/2026-08-27-workspace-plugin-01-foundation.md` (complete)

**Branch:** `feat/workspace-plugin`

## Global Constraints

Everything from Plan 1 still applies (snake_case wire, `{data,status,message}` envelope, `x-api-key` on every request, fail-closed permissions, no changes to `internal-operation-server`). Additionally, all confirmed by live request:

- **`description` is required before an item can leave `BACKLOG`.** `400 A work item needs a description before it can enter To Do`. It is a commit gate, not a nicety.
- **Hierarchy is server-enforced.** `EPIC` no parent; `STORY` parent must be an `EPIC`; `SUB_TASK` parent must be a `STORY`. `400 Epic items cannot have a parent`.
- **Admin accounts cannot be assignees or members.** `400 Admin accounts cannot be added as workspace members or assignees`. Never default an assignee to an admin account.
- **`assignees` is `null` on create/update responses**, `[]` or populated on board/list/detail. Always coalesce.
- **`?q=` is a whole-phrase substring match.** `"rate limit"` returns 0 against `"Rate-limit the login endpoint"`. Never rely on it for "closest to what I described".
- **`fuzzyScore` from `@tardis/shared` returns 0 for a sentence-length needle** — see Task 1. Do not use it directly on a description.
- Status transitions are gated per-member by `allowed_transitions`; `my_settings: null` means unrestricted.
- ESLint enforces explicit return types on exported functions.
- Tests avoid temp SQLite files (146 pre-existing Windows-only `EBUSY` failures).
- Verify with `bunx turbo run typecheck --filter='!@tardis/cli'` — `@tardis/cli` is broken on `main` and unrelated to this work.

## Out of scope

The `remote-select` UI contract field type and the web board — Plan 3. Tardis sessions → `workspace_work_item_time_entry` — not in this project.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `plugins/workspace/ranking.ts` | Token-aware fuzzy prefilter + LLM re-rank. No HTTP. | new |
| `plugins/workspace/draft.ts` | The Draft state machine. No HTTP, no LLM. | new |
| `plugins/workspace/questions.ts` | Deterministic question text from slot state. Pure. | new |
| `plugins/workspace/io-client.ts` | + write methods | modify |
| `plugins/workspace/index.ts` | + draft and write skill dispatch | modify |
| `plugins/workspace/manifest.json` | + 12 skills | modify |

`questions.ts` is split from `draft.ts` deliberately: the state machine answers *what is missing*, the question file answers *how to ask*. They change for different reasons, and keeping the wording out of the state machine keeps its tests about logic rather than copy.

---

## Task 1: Token-aware ranking

**Files:**
- Create: `plugins/workspace/ranking.ts`
- Test: `plugins/workspace/ranking.test.ts`

**Interfaces:**
- Consumes: `fuzzyScore` from `@tardis/shared`; `WorkItem` from `./types.js`
- Produces: `tokenize(text: string): string[]`, `scoreAgainst(query: string, item: { title: string; description: string | null }): number`, `prefilter(query: string, items: WorkItem[], limit?: number): WorkItem[]`

### Why this exists

`@tardis/shared` exports `fuzzyScore(needle, haystack)`, built for short needles like a task name. Handing it a whole description returns **0 for everything**, including the obviously-correct candidate. Measured:

```
needle = "add rate limiting to the login endpoint"
  Authentication hardening -> 0.000
  Billing & Invoicing      -> 0.000
  Login rate limits        -> 0.000      <- the right answer, scored zero
  Performance              -> 0.000

needle = "rate"
  Login rate limits        -> 0.900
```

The subsequence check fails once the needle is longer than the haystack, which it always is here. So the prefilter scores **per token** and aggregates. `fuzzyScore` is still the primitive — this is composition, not replacement.

- [ ] **Step 1: Write the failing tests**

Create `plugins/workspace/ranking.test.ts`.

```ts
import { describe, it, expect } from 'bun:test';
import { tokenize, scoreAgainst, prefilter } from './ranking.js';
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

  it('honours the limit', () => {
    expect(prefilter('login', EPICS, 2)).toHaveLength(2);
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test plugins/workspace/ranking.test.ts`
Expected: FAIL — `Cannot find module './ranking.js'`.

- [ ] **Step 3: Implement the ranking half of `plugins/workspace/ranking.ts`**

```ts
/**
 * Picking the few candidates worth showing.
 *
 * `fuzzyScore` from @tardis/shared is the primitive, but it cannot be used
 * directly here: it walks the needle as a subsequence of the haystack, so a
 * sentence-length needle against a short title scores 0 every time — including
 * for the correct candidate. Measured, with needle "add rate limiting to the
 * login endpoint", every epic including "Login rate limits" scored 0.000.
 *
 * So we score per token and aggregate. Same primitive, used at a size it works at.
 */

import { fuzzyScore } from '@tardis/shared';
import type { WorkItem } from './types.js';

/**
 * Words carrying no signal about which epic something belongs to. Deliberately
 * small — an aggressive list starts eating domain words ("service", "state").
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has',
  'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'was', 'were', 'will', 'with', 'add', 'make', 'need', 'want',
  'should', 'must', 'can', 'new', 'also', 'when', 'then',
]);

const MIN_TOKEN_LENGTH = 3;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
}

/** A description match counts, but a title match counts for more. */
const DESCRIPTION_WEIGHT = 0.4;

export function scoreAgainst(
  query: string,
  item: { title: string; description: string | null }
): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  let total = 0;
  for (const token of tokens) {
    const titleScore = fuzzyScore(token, item.title);
    const descScore =
      item.description === null ? 0 : fuzzyScore(token, item.description) * DESCRIPTION_WEIGHT;
    total += Math.max(titleScore, descScore);
  }

  // Mean per token, so a long description is not penalised for having many
  // words that match nothing.
  return total / tokens.length;
}

export function prefilter(query: string, items: WorkItem[], limit = 10): WorkItem[] {
  // No usable tokens means we have no opinion. Returning [] would strand the
  // user with no options; returning everything lets them choose.
  if (tokenize(query).length === 0) return items.slice(0, Math.max(limit, items.length));

  return items
    .map((item) => ({ item, score: scoreAgainst(query, item) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test plugins/workspace/ranking.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/workspace/ranking.ts plugins/workspace/ranking.test.ts
git commit -m "feat(workspace): token-aware candidate prefilter

fuzzyScore walks the needle as a subsequence of the haystack, so a
sentence-length description scores 0 against every short epic title,
including the correct one. Scoring per token and averaging fixes it while
keeping fuzzyScore as the primitive."
```

---

## Task 2: LLM re-rank, with the failure modes handled first

**Files:**
- Modify: `plugins/workspace/ranking.ts`
- Modify: `plugins/workspace/ranking.test.ts`

**Interfaces:**
- Consumes: `prefilter` from Task 1
- Produces: `interface Candidate { id: number; title: string; reason: string | null }`, `rankCandidates(deps: RankDeps, query: string, items: WorkItem[], topN?: number): Promise<Candidate[]>`, `interface RankDeps { generate(prompt: string): Promise<string>; logger: { debug(m: string): void; warn(m: string): void } }`

Write the degradation tests **before** the happy path. Every one of these has a real cause: local models emit markdown fences, invent ids, return prose, and time out.

- [ ] **Step 1: Add the failing tests**

Append to `plugins/workspace/ranking.test.ts`:

```ts
import { rankCandidates } from './ranking.js';

const EPICS3 = [
  epic(1, 'Authentication hardening'),
  epic(2, 'Billing & Invoicing'),
  epic(3, 'Login rate limits'),
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
    // The same hallucination guard skill-router uses for plugin names. Without
    // it the plugin will happily POST against a parent id that does not exist.
    const out = await rankCandidates(
      { generate: async () => '[{"id":999,"reason":"made up"},{"id":3,"reason":"real"}]', logger: noopLog },
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test plugins/workspace/ranking.test.ts`
Expected: 11 pass, 9 fail — `rankCandidates is not a function`.

- [ ] **Step 3: Append the re-rank to `plugins/workspace/ranking.ts`**

```ts
export interface Candidate {
  id: number;
  title: string;
  reason: string | null;
}

export interface RankDeps {
  generate(prompt: string): Promise<string>;
  logger: { debug(message: string): void; warn(message: string): void };
}

/** Small models wrap JSON in fences even when told not to. */
function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function buildPrompt(query: string, items: WorkItem[], topN: number): string {
  const list = items
    .map((i) => `${i.id}: ${i.title}${i.description === null ? '' : ` — ${i.description}`}`)
    .join('\n');

  return [
    `A user described a task: "${query}"`,
    '',
    'Which of these existing items is it most likely to belong under?',
    list,
    '',
    `Reply with JSON only: an array of at most ${topN} objects, each {"id": <number>, "reason": "<six words or fewer>"},`,
    'best first. Use only ids from the list above. No prose, no code fences.',
  ].join('\n');
}

export async function rankCandidates(
  deps: RankDeps,
  query: string,
  items: WorkItem[],
  topN = 3
): Promise<Candidate[]> {
  if (items.length === 0) return [];

  const shortlist = prefilter(query, items);
  const pool = shortlist.length > 0 ? shortlist : items;

  const asCandidates = (list: WorkItem[]): Candidate[] =>
    list.slice(0, topN).map((i) => ({ id: i.id, title: i.title, reason: null }));

  // Nothing to choose between — asking the model would cost a call and could
  // only make it worse.
  if (pool.length === 1) return asCandidates(pool);

  let raw: string;
  try {
    raw = await deps.generate(buildPrompt(query, pool, topN));
  } catch (err) {
    deps.logger.warn(
      `Workspace: candidate re-rank failed (${err instanceof Error ? err.message : String(err)}), using fuzzy order`
    );
    return asCandidates(pool);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    deps.logger.debug('Workspace: re-rank response was not JSON, using fuzzy order');
    return asCandidates(pool);
  }

  if (!Array.isArray(parsed)) return asCandidates(pool);

  const byId = new Map(pool.map((i) => [i.id, i]));
  const picked: Candidate[] = [];

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'number') continue;
    const hit = byId.get(id);
    // Hallucination guard — the same defence skill-router uses for plugin
    // names. Without it the plugin POSTs against a parent id that never existed.
    if (hit === undefined) {
      deps.logger.debug(`Workspace: re-rank invented id ${id}, discarded`);
      continue;
    }
    const reason = (entry as { reason?: unknown }).reason;
    picked.push({
      id: hit.id,
      title: hit.title,
      reason: typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null,
    });
    if (picked.length === topN) break;
  }

  return picked.length > 0 ? picked : asCandidates(pool);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test plugins/workspace/ranking.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `bunx turbo run typecheck --filter='!@tardis/cli' && bunx eslint plugins/workspace --ext .ts`
Expected: typecheck PASS, 0 lint errors.

```bash
git add plugins/workspace/ranking.ts plugins/workspace/ranking.test.ts
git commit -m "feat(workspace): LLM candidate re-rank that degrades instead of failing

Fences stripped, invented ids discarded, and every failure path falls back
to the fuzzy order — a worse answer beats an error in the middle of a draft."
```

---

## Task 3: The Draft state machine

**Files:**
- Create: `plugins/workspace/draft.ts`
- Test: `plugins/workspace/draft.test.ts`

**Interfaces:**
- Consumes: `WorkItemType`, `WorkItemStatus`, `WorkItemPriority` from `./types.js`
- Produces: `SlotName`, `SlotSource`, `Draft`, `createDraft(p)`, `setSlots(draft, patch, source, now)`, `blockingSlots(draft)`, `optionalSlots(draft)`, `validateForCommit(draft)`, `toCreatePayload(draft)`

### Why the plugin owns this

`clarify` is deliberately stateless — its own docstring says *"the user's next message is an ordinary turn, so no extra state is carried between them."* That is right for a question and exactly why something else must hold the half-built item. The Draft is also what makes the AI path and your manual commands the same thing: both mutate one object.

- [ ] **Step 1: Write the failing tests**

Create `plugins/workspace/draft.test.ts`.

```ts
import { describe, it, expect } from 'bun:test';
import {
  createDraft,
  setSlots,
  blockingSlots,
  optionalSlots,
  validateForCommit,
  toCreatePayload,
} from './draft.js';

const NOW = '2026-08-27T10:00:00.000Z';

function base() {
  return createDraft({
    id: 'd_1',
    workspaceId: 1,
    sourceText: 'rate limit the login endpoint',
    myAccountId: 42,
    now: NOW,
  });
}

describe('createDraft', () => {
  it('starts OPEN with the source text kept', () => {
    const d = base();
    expect(d.status).toBe('OPEN');
    expect(d.sourceText).toBe('rate limit the login endpoint');
  });

  it('defaults priority, status and assignees, marked as defaults not user choices', () => {
    const d = base();
    expect(d.slots.priority).toEqual({ value: 'MEDIUM', source: 'default' });
    expect(d.slots.status).toEqual({ value: 'BACKLOG', source: 'default' });
    expect(d.slots.assignee_account_ids).toEqual({ value: [42], source: 'default' });
  });

  it('leaves everything else unset', () => {
    const d = base();
    expect(d.slots.title).toEqual({ value: null, source: 'unset' });
    expect(d.slots.parent_id).toEqual({ value: null, source: 'unset' });
  });
});

describe('setSlots', () => {
  it('records the source so a default can be told from a choice', () => {
    const d = setSlots(base(), { priority: 'HIGH' }, 'user', NOW);
    expect(d.slots.priority).toEqual({ value: 'HIGH', source: 'user' });
  });

  it('does not let an inference overwrite something the user said', () => {
    const said = setSlots(base(), { title: 'What I said' }, 'user', NOW);
    const guessed = setSlots(said, { title: 'What it guessed' }, 'inferred', NOW);
    expect(guessed.slots.title.value).toBe('What I said');
  });

  it('lets the user overwrite an inference', () => {
    const guessed = setSlots(base(), { title: 'Guess' }, 'inferred', NOW);
    const said = setSlots(guessed, { title: 'Correction' }, 'user', NOW);
    expect(said.slots.title.value).toBe('Correction');
  });

  it('does not mutate the draft it was given', () => {
    const before = base();
    setSlots(before, { title: 'X' }, 'user', NOW);
    expect(before.slots.title.value).toBeNull();
  });
});

describe('blockingSlots', () => {
  it('wants type and title first', () => {
    expect(blockingSlots(base())).toEqual(['type', 'title']);
  });

  it('wants a parent for a STORY', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual(['parent_id']);
  });

  it('wants a parent for a SUB_TASK', () => {
    const d = setSlots(base(), { type: 'SUB_TASK', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual(['parent_id']);
  });

  it('never wants a parent for an EPIC', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual([]);
  });

  it('requires a description once the target status leaves BACKLOG', () => {
    // Server: 400 "A work item needs a description before it can enter To Do".
    const d = setSlots(base(), { type: 'EPIC', title: 'T', status: 'TODO' }, 'user', NOW);
    expect(blockingSlots(d)).toEqual(['description']);
  });

  it('does not require a description while the item stays in BACKLOG', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(blockingSlots(d)).not.toContain('description');
  });
});

describe('optionalSlots', () => {
  it('offers the fields worth asking about, in order', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(optionalSlots(d)).toEqual([
      'description',
      'story_points',
      'estimate_hours',
      'due_date',
      'priority',
      'assignee_account_ids',
    ]);
  });

  it('stops offering a field once the user has set it', () => {
    const d = setSlots(
      base(),
      { type: 'EPIC', title: 'T', story_points: 5, priority: 'HIGH' },
      'user',
      NOW
    );
    expect(optionalSlots(d)).not.toContain('story_points');
    expect(optionalSlots(d)).not.toContain('priority');
  });

  it('still offers a field that only holds a default', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(optionalSlots(d)).toContain('priority');
  });
});

describe('validateForCommit', () => {
  it('reports every blocking slot at once, not one at a time', () => {
    const errors = validateForCommit(base());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('type');
  });

  it('rejects an EPIC that somehow acquired a parent', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', parent_id: 5 }, 'user', NOW);
    expect(validateForCommit(d).join(' ')).toContain('Epic');
  });

  it('passes a complete BACKLOG epic', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(validateForCommit(d)).toEqual([]);
  });

  it('passes a complete TODO sub-task', () => {
    const d = setSlots(
      base(),
      { type: 'SUB_TASK', title: 'T', parent_id: 2, description: 'why', status: 'TODO' },
      'user',
      NOW
    );
    expect(validateForCommit(d)).toEqual([]);
  });
});

describe('toCreatePayload', () => {
  it('emits only the fields that are set', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    const p = toCreatePayload(d);
    expect(p['type']).toBe('EPIC');
    expect(p['title']).toBe('T');
    expect(p).not.toHaveProperty('due_date');
    expect(p).not.toHaveProperty('parent_id');
  });

  it('never sends a parent_id for an EPIC even if one is set', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', parent_id: 9 }, 'user', NOW);
    expect(toCreatePayload(d)).not.toHaveProperty('parent_id');
  });

  it('sends assignee_account_ids as an array', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(toCreatePayload(d)['assignee_account_ids']).toEqual([42]);
  });

  it('omits an empty assignee list rather than sending []', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', assignee_account_ids: [] }, 'user', NOW);
    expect(toCreatePayload(d)).not.toHaveProperty('assignee_account_ids');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test plugins/workspace/draft.test.ts`
Expected: FAIL — `Cannot find module './draft.js'`.

- [ ] **Step 3: Implement `plugins/workspace/draft.ts`**

```ts
/**
 * The half-built work item, between turns.
 *
 * `clarify` ends a turn to ask a question and carries no state forward — that
 * is its design, and it is why this exists. The Draft holds the answers so a
 * four-question conversation does not depend on the model remembering.
 *
 * Pure: no HTTP, no LLM, no clock of its own. `now` is passed in so the tests
 * are about logic rather than timing.
 */

import type { WorkItemPriority, WorkItemStatus, WorkItemType } from './types.js';

export type SlotSource = 'unset' | 'inferred' | 'user' | 'default';

export type SlotName =
  | 'type'
  | 'title'
  | 'description'
  | 'parent_id'
  | 'story_points'
  | 'estimate_hours'
  | 'due_date'
  | 'priority'
  | 'assignee_account_ids'
  | 'sprint_id'
  | 'status';

export interface Slot<T> {
  value: T | null;
  source: SlotSource;
}

export interface DraftSlots {
  type: Slot<WorkItemType>;
  title: Slot<string>;
  description: Slot<string>;
  parent_id: Slot<number>;
  story_points: Slot<number>;
  estimate_hours: Slot<number>;
  due_date: Slot<string>;
  priority: Slot<WorkItemPriority>;
  assignee_account_ids: Slot<number[]>;
  sprint_id: Slot<number>;
  status: Slot<WorkItemStatus>;
}

export interface Draft {
  id: string;
  workspaceId: number;
  status: 'OPEN' | 'COMMITTED' | 'CANCELLED';
  sourceText: string;
  slots: DraftSlots;
  createdAt: string;
  updatedAt: string;
}

/** How much authority a value carries. A weaker source may not overwrite a stronger one. */
const SOURCE_RANK: Record<SlotSource, number> = {
  unset: 0,
  default: 1,
  inferred: 2,
  user: 3,
};

const unset = <T,>(): Slot<T> => ({ value: null, source: 'unset' });

export function createDraft(p: {
  id: string;
  workspaceId: number;
  sourceText: string;
  myAccountId: number;
  now: string;
}): Draft {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    status: 'OPEN',
    sourceText: p.sourceText,
    slots: {
      type: unset<WorkItemType>(),
      title: unset<string>(),
      description: unset<string>(),
      parent_id: unset<number>(),
      story_points: unset<number>(),
      estimate_hours: unset<number>(),
      due_date: unset<string>(),
      priority: { value: 'MEDIUM', source: 'default' },
      // You, unless told otherwise. Putting work on someone else is
      // workspace.assign, which is approval-gated.
      assignee_account_ids: { value: [p.myAccountId], source: 'default' },
      sprint_id: unset<number>(),
      status: { value: 'BACKLOG', source: 'default' },
    },
    createdAt: p.now,
    updatedAt: p.now,
  };
}

export type SlotPatch = Partial<{
  type: WorkItemType;
  title: string;
  description: string;
  parent_id: number;
  story_points: number;
  estimate_hours: number;
  due_date: string;
  priority: WorkItemPriority;
  assignee_account_ids: number[];
  sprint_id: number;
  status: WorkItemStatus;
}>;

/**
 * Apply a patch. A weaker source never overwrites a stronger one, so a later
 * inference cannot quietly undo something you said.
 */
export function setSlots(
  draft: Draft,
  patch: SlotPatch,
  source: Exclude<SlotSource, 'unset'>,
  now: string
): Draft {
  const slots: DraftSlots = { ...draft.slots };

  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const key = name as keyof DraftSlots;
    const current = slots[key];
    if (SOURCE_RANK[source] < SOURCE_RANK[current.source]) continue;
    // The union of Slot<T> types makes a precise assignment impossible here
    // without a per-key switch that adds nothing; the patch type already
    // constrains value to the right shape for each key.
    (slots as Record<string, Slot<unknown>>)[name] = { value, source };
  }

  return { ...draft, slots, updatedAt: now };
}

function isSet(slot: Slot<unknown>): boolean {
  return slot.source !== 'unset' && slot.value !== null;
}

/** A description is only required once the item leaves BACKLOG. */
function needsDescription(draft: Draft): boolean {
  const status = draft.slots.status.value ?? 'BACKLOG';
  return status !== 'BACKLOG';
}

/**
 * What the server would reject the draft for, in the order worth asking.
 * Returns at most one "stage" at a time so the conversation stays one question
 * deep rather than dumping a form at the user.
 */
export function blockingSlots(draft: Draft): SlotName[] {
  const missing: SlotName[] = [];
  if (!isSet(draft.slots.type)) missing.push('type');
  if (!isSet(draft.slots.title)) missing.push('title');
  if (missing.length > 0) return missing;

  const type = draft.slots.type.value;
  if (type !== 'EPIC' && !isSet(draft.slots.parent_id)) return ['parent_id'];
  if (needsDescription(draft) && !isSet(draft.slots.description)) return ['description'];
  return [];
}

const OPTIONAL_ORDER: SlotName[] = [
  'description',
  'story_points',
  'estimate_hours',
  'due_date',
  'priority',
  'assignee_account_ids',
];

/** Worth offering, but never blocking. A slot holding only a default still counts as unanswered. */
export function optionalSlots(draft: Draft): SlotName[] {
  return OPTIONAL_ORDER.filter((name) => {
    const slot = draft.slots[name as keyof DraftSlots];
    return slot.source === 'unset' || slot.source === 'default';
  });
}

export function validateForCommit(draft: Draft): string[] {
  const errors: string[] = [];

  for (const name of blockingSlots(draft)) {
    if (name === 'description') {
      errors.push(
        'A work item needs a description before it can enter any status other than Backlog.'
      );
    } else {
      errors.push(`Missing ${name}.`);
    }
  }

  const type = draft.slots.type.value;
  if (type === 'EPIC' && isSet(draft.slots.parent_id)) {
    errors.push('Epic items cannot have a parent.');
  }

  return errors;
}

/** The POST body. Only set slots appear; the server applies its own defaults. */
export function toCreatePayload(draft: Draft): Record<string, unknown> {
  const s = draft.slots;
  const out: Record<string, unknown> = {};

  const put = (key: SlotName, slot: Slot<unknown>): void => {
    if (isSet(slot)) out[key] = slot.value;
  };

  put('type', s.type);
  put('title', s.title);
  put('description', s.description);
  put('story_points', s.story_points);
  put('estimate_hours', s.estimate_hours);
  put('due_date', s.due_date);
  put('priority', s.priority);
  put('sprint_id', s.sprint_id);
  put('status', s.status);

  // An EPIC must never carry one, whatever the slot says.
  if (s.type.value !== 'EPIC') put('parent_id', s.parent_id);

  const assignees = s.assignee_account_ids.value;
  if (assignees !== null && assignees.length > 0) out['assignee_account_ids'] = assignees;

  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test plugins/workspace/draft.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bunx turbo run typecheck --filter='!@tardis/cli'
git add plugins/workspace/draft.ts plugins/workspace/draft.test.ts
git commit -m "feat(workspace): the Draft state machine

Slot provenance is what stops a later inference undoing something you said,
and what lets the plugin tell 'you chose MEDIUM' from 'I assumed MEDIUM' —
only the second is worth asking about."
```

---

## Task 4: Questions the plugin writes itself

**Files:**
- Create: `plugins/workspace/questions.ts`
- Test: `plugins/workspace/questions.test.ts`

**Interfaces:**
- Consumes: `Draft`, `SlotName`, `blockingSlots`, `optionalSlots` from `./draft.js`; `Candidate` from `./ranking.js`
- Produces: `nextQuestion(draft: Draft, candidates?: Candidate[]): string | null`, `describeDraft(draft: Draft): string`

### Why the plugin writes the questions

This is the main defence against model quality. The plugin knows the slot order, the hierarchy rules and the candidate list, so it composes the question deterministically and the model's only job is to relay it through `clarify`. The *structure* of the conversation does not depend on the LLM at all — only its parsing of your answers.

- [ ] **Step 1: Write the failing tests**

Create `plugins/workspace/questions.test.ts`.

```ts
import { describe, it, expect } from 'bun:test';
import { nextQuestion, describeDraft } from './questions.js';
import { createDraft, setSlots } from './draft.js';
import type { Draft } from './draft.js';

const NOW = '2026-08-27T10:00:00.000Z';
const base = (): Draft =>
  createDraft({
    id: 'd_1',
    workspaceId: 1,
    sourceText: 'rate limit the login endpoint',
    myAccountId: 42,
    now: NOW,
  });

describe('nextQuestion', () => {
  it('asks for the type first', () => {
    const q = nextQuestion(base());
    expect(q).toContain('epic');
    expect(q).toContain('story');
    expect(q).toContain('sub-task');
  });

  it('asks for a title once the type is known', () => {
    const q = nextQuestion(setSlots(base(), { type: 'SUB_TASK' }, 'user', NOW));
    expect(q?.toLowerCase()).toContain('call it');
  });

  it('names the parent kind correctly for a STORY', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    expect(nextQuestion(d)).toContain('epic');
  });

  it('names the parent kind correctly for a SUB_TASK', () => {
    const d = setSlots(base(), { type: 'SUB_TASK', title: 'T' }, 'user', NOW);
    expect(nextQuestion(d)).toContain('story');
  });

  it('lists candidates with reasons when it has them', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    const q = nextQuestion(d, [
      { id: 3, title: 'Login rate limits', reason: 'about login' },
      { id: 1, title: 'Authentication hardening', reason: null },
    ]);
    expect(q).toContain('Login rate limits');
    expect(q).toContain('about login');
    expect(q).toContain('Authentication hardening');
  });

  it('always offers an escape from the candidate list', () => {
    const d = setSlots(base(), { type: 'STORY', title: 'T' }, 'user', NOW);
    const q = nextQuestion(d, [{ id: 3, title: 'Login rate limits', reason: null }]);
    expect(q?.toLowerCase()).toContain('none of these');
  });

  it('demands a description when the status has left BACKLOG', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T', status: 'TODO' }, 'user', NOW);
    const q = nextQuestion(d);
    expect(q?.toLowerCase()).toContain('description');
    expect(q).toContain('Backlog');
  });

  it('moves on to optional fields once nothing is blocking', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'T' }, 'user', NOW);
    expect(nextQuestion(d)?.toLowerCase()).toContain('description');
  });

  it('returns null when there is nothing left worth asking', () => {
    const d = setSlots(
      base(),
      {
        type: 'EPIC',
        title: 'T',
        description: 'why',
        story_points: 3,
        estimate_hours: 4,
        due_date: '2026-09-04',
        priority: 'HIGH',
        assignee_account_ids: [42],
      },
      'user',
      NOW
    );
    expect(nextQuestion(d)).toBeNull();
  });

  it('asks one question, not several', () => {
    const q = nextQuestion(base()) ?? '';
    expect(q.split('?').filter((s) => s.trim() !== '').length).toBe(1);
  });
});

describe('describeDraft', () => {
  it('shows what is set and marks what was assumed', () => {
    const d = setSlots(base(), { type: 'EPIC', title: 'Rate limiting' }, 'user', NOW);
    const out = describeDraft(d);
    expect(out).toContain('Rate limiting');
    expect(out).toContain('EPIC');
    expect(out.toLowerCase()).toContain('assumed');
  });

  it('does not print null for unset fields', () => {
    expect(describeDraft(base())).not.toContain('null');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test plugins/workspace/questions.test.ts`
Expected: FAIL — `Cannot find module './questions.js'`.

- [ ] **Step 3: Implement `plugins/workspace/questions.ts`**

```ts
/**
 * What to ask next, and how to show the draft.
 *
 * Split from draft.ts so the state machine's tests are about logic and this
 * file's are about wording. They change for different reasons.
 */

import type { Candidate } from './ranking.js';
import type { Draft, SlotName } from './draft.js';
import { blockingSlots, optionalSlots } from './draft.js';

const PARENT_KIND: Record<string, string> = {
  STORY: 'epic',
  SUB_TASK: 'story',
};

function candidateList(candidates: Candidate[]): string {
  const lines = candidates.map((c, i) => {
    const why = c.reason === null ? '' : ` — ${c.reason}`;
    return `${i + 1}. ${c.title}${why}`;
  });
  // Never a dead end. Ranking will sometimes be wrong.
  lines.push(`${candidates.length + 1}. none of these — show me all of them`);
  return lines.join('\n');
}

function askFor(name: SlotName, draft: Draft, candidates: Candidate[]): string {
  switch (name) {
    case 'type':
      return 'Is this an epic, a story, or a sub-task?';
    case 'title':
      return 'What should I call it?';
    case 'parent_id': {
      const kind = PARENT_KIND[draft.slots.type.value ?? ''] ?? 'parent';
      if (candidates.length === 0) return `Which ${kind} does this belong under?`;
      return `Which ${kind} does this belong under?\n${candidateList(candidates)}`;
    }
    case 'description':
      return 'What is this for? A description is required before it can leave Backlog.';
    case 'story_points':
      return 'How many story points?';
    case 'estimate_hours':
      return 'Roughly how many hours will it take?';
    case 'due_date':
      return 'When is it due?';
    case 'priority':
      return 'What priority — low, medium, high or urgent?';
    case 'assignee_account_ids':
      return 'Is anyone else working on this, or just you?';
    case 'sprint_id':
      return 'Which sprint should it go in?';
    case 'status':
      return 'What status should it start in?';
  }
}

export function nextQuestion(draft: Draft, candidates: Candidate[] = []): string | null {
  const blocking = blockingSlots(draft);
  if (blocking.length > 0) return askFor(blocking[0]!, draft, candidates);

  const optional = optionalSlots(draft);
  if (optional.length > 0) return askFor(optional[0]!, draft, candidates);

  return null;
}

const LABELS: Partial<Record<SlotName, string>> = {
  type: 'Type',
  title: 'Title',
  description: 'Description',
  parent_id: 'Parent',
  story_points: 'Points',
  estimate_hours: 'Estimate',
  due_date: 'Due',
  priority: 'Priority',
  assignee_account_ids: 'Assignees',
  sprint_id: 'Sprint',
  status: 'Status',
};

export function describeDraft(draft: Draft): string {
  const lines: string[] = [];

  for (const [name, label] of Object.entries(LABELS)) {
    const slot = draft.slots[name as keyof Draft['slots']];
    if (slot.source === 'unset' || slot.value === null) continue;
    const shown = Array.isArray(slot.value) ? slot.value.join(', ') : String(slot.value);
    // Marking assumptions is what makes "is that right?" answerable.
    const note = slot.source === 'default' ? ' (assumed)' : '';
    lines.push(`  ${label}: ${shown}${note}`);
  }

  return lines.length === 0 ? '  (nothing set yet)' : lines.join('\n');
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test plugins/workspace/questions.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/workspace/questions.ts plugins/workspace/questions.test.ts
git commit -m "feat(workspace): the plugin composes its own questions

The model relays them; it does not invent them. That is what keeps the
conversation's structure independent of model quality."
```

---

## Task 5: Write methods on the client

**Files:**
- Modify: `plugins/workspace/io-client.ts`
- Modify: `plugins/workspace/io-client.test.ts`

**Interfaces:**
- Produces on `IoClient`: `createItem(workspaceId, payload)`, `updateItem(itemId, patch)`, `moveItem(itemId, body)`, `addComment(itemId, body)`, `archiveItem(itemId)`, `deleteItem(itemId)`, `assign(itemId, accountIds)`

- [ ] **Step 1: Add the failing tests**

Append to `plugins/workspace/io-client.test.ts`:

```ts
describe('writes', () => {
  const okThen = (payload: unknown) => (_c: Call, n: number) =>
    n === 1 ? jsonResponse(LOGIN_OK) : jsonResponse({ data: payload, status: 200, message: 'ok' });

  it('POSTs a create to the workspace-scoped route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.createItem(7, { type: 'EPIC', title: 'T' });
    expect(calls[1]!.url).toBe('http://io.test/workspaces/7/work-items');
    expect(calls[1]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ type: 'EPIC', title: 'T' });
  });

  it('PATCHes an update to the flat work-item route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.updateItem(9, { title: 'New' });
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9');
    expect(calls[1]!.init?.method).toBe('PATCH');
  });

  it('PATCHes a move to the move sub-route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.moveItem(9, { status: 'TODO' });
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9/move');
    expect(calls[1]!.init?.method).toBe('PATCH');
  });

  it('assigns by PATCHing assignee_account_ids', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.assign(9, [4, 5]);
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ assignee_account_ids: [4, 5] });
  });

  it('DELETEs a soft-delete', async () => {
    const { client, calls } = makeClient(okThen(true));
    await client.deleteItem(9);
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9');
    expect(calls[1]!.init?.method).toBe('DELETE');
  });

  it('POSTs an archive to its own sub-route', async () => {
    const { client, calls } = makeClient(okThen({ id: 9 }));
    await client.archiveItem(9);
    expect(calls[1]!.url).toBe('http://io.test/workspaces/work-items/9/archive');
    expect(calls[1]!.init?.method).toBe('POST');
  });

  it('surfaces the description gate verbatim rather than paraphrasing it', async () => {
    const { client } = makeClient((_c, n) =>
      n === 1
        ? jsonResponse(LOGIN_OK)
        : jsonResponse(
            { message: 'A work item needs a description before it can enter To Do', statusCode: 400 },
            400
          )
    );
    let caught: unknown;
    try {
      await client.createItem(7, { type: 'EPIC', title: 'T', status: 'TODO' });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('needs a description');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test plugins/workspace/io-client.test.ts`
Expected: 16 pass, 7 fail — `createItem is not a function`.

- [ ] **Step 3: Add the methods to `plugins/workspace/io-client.ts`**

Append inside the class, after the reads:

```ts
  // ─── Writes ───

  async createItem(workspaceId: number, payload: Record<string, unknown>): Promise<WorkItem> {
    return this.request<WorkItem>('POST', `/workspaces/${workspaceId}/work-items`, payload);
  }

  async updateItem(itemId: number, patch: Record<string, unknown>): Promise<WorkItem> {
    return this.request<WorkItem>('PATCH', `/workspaces/work-items/${itemId}`, patch);
  }

  /** Board move: { status, board_order } — or backlog reorder: { backlog_order }. */
  async moveItem(itemId: number, body: Record<string, unknown>): Promise<WorkItem> {
    return this.request<WorkItem>('PATCH', `/workspaces/work-items/${itemId}/move`, body);
  }

  async assign(itemId: number, accountIds: number[]): Promise<WorkItem> {
    return this.updateItem(itemId, { assignee_account_ids: accountIds });
  }

  async addComment(itemId: number, body: string): Promise<unknown> {
    return this.request<unknown>('POST', `/workspaces/work-items/${itemId}/comments`, { body });
  }

  async archiveItem(itemId: number): Promise<WorkItem> {
    return this.request<WorkItem>('POST', `/workspaces/work-items/${itemId}/archive`, {});
  }

  async deleteItem(itemId: number): Promise<unknown> {
    return this.request<unknown>('DELETE', `/workspaces/work-items/${itemId}`);
  }
```

- [ ] **Step 4: Note what the comment DTO actually accepts**

`CreateCommentDto` (`src/workspaces/dto/create-comment.dto.ts:18`) is:

| Field | Required | Notes |
|---|---|---|
| `body` | yes | the comment text |
| `mention_account_ids` | no | `number[]`, drives @-mention notifications |

`addComment` sends only `body`, which is correct and sufficient. Mentions are
out of scope for this plan — if you add them later, they belong on the same
call rather than a second one.

- [ ] **Step 5: Run to verify they pass**

Run: `bun test plugins/workspace/io-client.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 6: Commit**

```bash
git add plugins/workspace/io-client.ts plugins/workspace/io-client.test.ts
git commit -m "feat(workspace): write methods on the IO client"
```

---

## Task 6: Draft skills

**Files:**
- Modify: `plugins/workspace/manifest.json`
- Modify: `plugins/workspace/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: `workspace.draft-start`, `workspace.draft-set`, `workspace.draft-show`, `workspace.draft-commit`, `workspace.draft-cancel`

Each draft skill returns the same envelope so every surface can render it
identically:

```ts
{ draft: Draft, summary: string, blocking: SlotName[], optional: SlotName[],
  candidates: Candidate[], nextQuestion: string | null }
```

- [ ] **Step 1: Add the five skills to `manifest.json`**

```json
{
  "id": "workspace.draft-start",
  "description": "Begin drafting a new work item from a plain-language description. Returns what is still needed and the next question to ask. Use this when the user describes work they want captured, rather than creating an item immediately.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "text": { "type": "string", "description": "The user's description of the work, in their own words." },
      "workspaceKey": { "type": "string", "description": "Optional workspace key; defaults to the current one." }
    },
    "required": ["text"]
  },
  "ui": {
    "block": "form",
    "label": "New work item",
    "icon": "plus",
    "submitLabel": "Start",
    "fields": [{ "name": "text", "type": "textarea", "label": "Describe the work", "required": true }]
  }
},
{
  "id": "workspace.draft-set",
  "description": "Fill in one or more fields on the current draft. Pass only the fields the user just told you. Returns the updated draft and the next question.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "description": "EPIC, STORY or SUB_TASK" },
      "title": { "type": "string", "description": "Short title" },
      "description": { "type": "string", "description": "Longer description" },
      "parent_id": { "type": "number", "description": "Numeric id of the parent epic or story" },
      "story_points": { "type": "number", "description": "Story points" },
      "estimate_hours": { "type": "number", "description": "Estimated hours to finish" },
      "due_date": { "type": "string", "description": "Due date, ISO 8601" },
      "priority": { "type": "string", "description": "LOW, MEDIUM, HIGH or URGENT" },
      "assignee_account_ids": { "type": "array", "description": "Account ids to assign" },
      "status": { "type": "string", "description": "BACKLOG, TODO, IN_PROGRESS, IN_REVIEW or DONE" }
    }
  },
  "ui": {
    "block": "form",
    "label": "Edit draft",
    "icon": "edit",
    "submitLabel": "Save"
  }
},
{
  "id": "workspace.draft-show",
  "description": "Show the current draft and what is still missing.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": { "type": "object", "properties": {} },
  "ui": {
    "block": "detail",
    "label": "Draft",
    "icon": "file",
    "item": { "title": "title", "body": "summary", "meta": ["stillNeeded"] }
  }
},
{
  "id": "workspace.draft-commit",
  "description": "Create the real work item from the current draft. Fails with a list of what is missing if the draft is incomplete.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": { "type": "object", "properties": {} },
  "ui": { "block": "action", "label": "Create it", "icon": "check", "args": {} }
},
{
  "id": "workspace.draft-cancel",
  "description": "Discard the current draft.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": { "type": "object", "properties": {} },
  "ui": { "block": "action", "label": "Discard draft", "icon": "x", "args": {} }
}
```

- [ ] **Step 2: Add draft helpers to `index.ts`**

```ts
import { createDraft, setSlots, blockingSlots, optionalSlots, validateForCommit, toCreatePayload } from './draft.js';
import type { Draft, SlotPatch } from './draft.js';
import { nextQuestion, describeDraft } from './questions.js';
import { rankCandidates } from './ranking.js';
import type { Candidate } from './ranking.js';
```

```ts
const DRAFT_KEY = 'draft:active';

async function loadDraft(): Promise<Draft> {
  const d = await api.storage.get<Draft>(DRAFT_KEY);
  if (d === null || d.status !== 'OPEN') {
    throw new Error('Workspace: no draft in progress. Start one by describing the work.');
  }
  return d;
}

/** Parent candidates for the draft's current type, or [] when none apply. */
async function parentCandidates(io: IoClient, draft: Draft): Promise<Candidate[]> {
  const type = draft.slots.type.value;
  if (type === null || type === 'EPIC') return [];
  const parentType = type === 'STORY' ? 'EPIC' : 'STORY';

  const all = await io.searchItemsByType(draft.workspaceId, parentType);
  return rankCandidates(
    { generate: (prompt) => api.llm.generate(prompt), logger: api.logger },
    draft.sourceText,
    all
  );
}

/** The one shape every draft skill returns. */
async function draftEnvelope(io: IoClient, draft: Draft): Promise<Record<string, unknown>> {
  const blocking = blockingSlots(draft);
  const candidates = blocking[0] === 'parent_id' ? await parentCandidates(io, draft) : [];
  return {
    draft,
    title: draft.slots.title.value ?? '(untitled draft)',
    summary: describeDraft(draft),
    blocking,
    optional: optionalSlots(draft),
    stillNeeded: blocking.join(', ') || 'nothing — ready to create',
    candidates,
    nextQuestion: nextQuestion(draft, candidates),
  };
}
```

- [ ] **Step 3: Add `searchItemsByType` to `io-client.ts`**

`parentCandidates` needs every epic or story, not a text search.

```ts
  async searchItemsByType(workspaceId: number, type: string): Promise<WorkItem[]> {
    const query = `?type=${encodeURIComponent(type)}&archived=exclude`;
    return this.request<WorkItem[]>('GET', `/workspaces/${workspaceId}/work-items${query}`);
  }
```

- [ ] **Step 4: Add the five cases to `executeTool`**

```ts
case 'workspace.draft-start': {
  const io = assertConfigured();
  const workspaceId = await currentWorkspaceId(io, optionalKey(args));
  const text = typeof args['text'] === 'string' ? args['text'] : '';
  if (text.trim() === '') throw new Error('Workspace: describe the work you want captured.');

  const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
  const now = new Date().toISOString();
  const draft = createDraft({
    id: `d_${now}`,
    workspaceId,
    sourceText: text,
    myAccountId,
    now,
  });
  await api.storage.set(DRAFT_KEY, draft);
  return draftEnvelope(io, draft);
}

case 'workspace.draft-set': {
  const io = assertConfigured();
  const draft = await loadDraft();
  const patch: SlotPatch = {};
  const str = (k: string): string | undefined =>
    typeof args[k] === 'string' && args[k] !== '' ? (args[k] as string) : undefined;
  const num = (k: string): number | undefined =>
    typeof args[k] === 'number' ? (args[k] as number) : undefined;

  if (str('type') !== undefined) patch.type = str('type') as SlotPatch['type'];
  if (str('title') !== undefined) patch.title = str('title');
  if (str('description') !== undefined) patch.description = str('description');
  if (str('due_date') !== undefined) patch.due_date = str('due_date');
  if (str('priority') !== undefined) patch.priority = str('priority') as SlotPatch['priority'];
  if (str('status') !== undefined) patch.status = str('status') as SlotPatch['status'];
  if (num('parent_id') !== undefined) patch.parent_id = num('parent_id');
  if (num('story_points') !== undefined) patch.story_points = num('story_points');
  if (num('estimate_hours') !== undefined) patch.estimate_hours = num('estimate_hours');
  if (Array.isArray(args['assignee_account_ids'])) {
    patch.assignee_account_ids = (args['assignee_account_ids'] as unknown[]).filter(
      (v): v is number => typeof v === 'number'
    );
  }

  const updated = setSlots(draft, patch, 'user', new Date().toISOString());
  await api.storage.set(DRAFT_KEY, updated);
  return draftEnvelope(io, updated);
}

case 'workspace.draft-show': {
  const io = assertConfigured();
  return draftEnvelope(io, await loadDraft());
}

case 'workspace.draft-commit': {
  const io = assertConfigured();
  const draft = await loadDraft();
  const errors = validateForCommit(draft);
  if (errors.length > 0) {
    return {
      created: false,
      errors,
      summary: describeDraft(draft),
      nextQuestion: nextQuestion(draft),
    };
  }

  const item = await io.createItem(draft.workspaceId, toCreatePayload(draft));
  await api.storage.set(DRAFT_KEY, { ...draft, status: 'COMMITTED' });

  const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
  const wanted = draft.slots.assignee_account_ids.value ?? [];
  const others = wanted.filter((id) => id !== myAccountId);

  return {
    created: true,
    id: item.id,
    text: formatWorkItem(item),
    // Putting work on a colleague is workspace.assign, which is approval-gated.
    // draft-commit is direct, so it must not be the thing that does it.
    followUp:
      others.length > 0
        ? `The draft named other assignees (${others.join(', ')}). Call workspace.assign to put it on them.`
        : null,
  };
}

case 'workspace.draft-cancel': {
  const draft = await api.storage.get<Draft>(DRAFT_KEY);
  await api.storage.delete(DRAFT_KEY);
  return { cancelled: draft !== null, message: 'Draft discarded.' };
}
```

- [ ] **Step 5: Verify the manifest and types**

Run: `bun test packages/core/src/plugins/manifest-conformance.test.ts && bunx turbo run typecheck --filter='!@tardis/cli'`
Expected: PASS both. The conformance test now covers 14 skills.

- [ ] **Step 6: Commit**

```bash
git add plugins/workspace
git commit -m "feat(workspace): draft skills

draft-commit assigns only to you and hands back a follow-up naming
workspace.assign for anyone else, because commit is direct and putting work
on a colleague is not."
```

---

## Task 7: Direct write skills, with the ownership guard

**Files:**
- Modify: `plugins/workspace/manifest.json`
- Modify: `plugins/workspace/index.ts`
- Test: `plugins/workspace/ownership.test.ts`

**Interfaces:**
- Produces: `isMine(item, myAccountId): boolean`, exported from `plugins/workspace/permissions.ts` — it sits beside `canActOnItem` because it answers the same kind of question about the same shape.
- Skills: `workspace.create-item`, `workspace.edit-item`, `workspace.move-item`, `workspace.comment`

### The guard, and why it is a skill boundary

D7 wants approval for writes to other people's items, but `actionType` is static
and `resolvePermission` grades by tool name only — neither can express "ask, but
only when the target belongs to someone else". So the condition becomes the skill
boundary: these `direct` skills **refuse** an item that is not yours and name
`workspace.edit-any-item` (Task 8) in the refusal.

- [ ] **Step 1: Write the failing tests**

Create `plugins/workspace/ownership.test.ts`.

```ts
import { describe, it, expect } from 'bun:test';
import { isMine } from './permissions.js';

const ME = 42;

describe('isMine', () => {
  it('is mine when I am an assignee', () => {
    expect(
      isMine({ assignees: [{ account_id: ME }], reporter_account_id: 7 }, ME)
    ).toBe(true);
  });

  it('is mine when I reported it', () => {
    expect(isMine({ assignees: [{ account_id: 9 }], reporter_account_id: ME }, ME)).toBe(true);
  });

  it('is not mine when I am neither', () => {
    expect(isMine({ assignees: [{ account_id: 9 }], reporter_account_id: 7 }, ME)).toBe(false);
  });

  it('handles a null assignee list, which is what create returns', () => {
    expect(isMine({ assignees: null, reporter_account_id: ME }, ME)).toBe(true);
    expect(isMine({ assignees: null, reporter_account_id: 7 }, ME)).toBe(false);
  });

  it('is not mine when the account id is unknown', () => {
    // -1 is the "not logged in yet" sentinel. It must never match a real item.
    expect(isMine({ assignees: [{ account_id: 9 }], reporter_account_id: 7 }, -1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test plugins/workspace/ownership.test.ts`
Expected: FAIL — `isMine is not a function`.

- [ ] **Step 3: Add `isMine` to `plugins/workspace/permissions.ts`**

```ts
/**
 * Whether an item is yours, for the purposes of the direct-vs-approval split.
 *
 * Separate from `canActOnItem`, which answers what the *server* will allow.
 * This answers what we are willing to do without asking, and it deliberately
 * counts the reporter: an item you filed is yours to correct even before
 * anyone picks it up.
 */
export function isMine(
  item: { assignees: { account_id: number }[] | null; reporter_account_id: number },
  myAccountId: number
): boolean {
  if (myAccountId < 0) return false;
  if (item.reporter_account_id === myAccountId) return true;
  return (item.assignees ?? []).some((a) => a.account_id === myAccountId);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test plugins/workspace/ownership.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the four skills to `manifest.json`**

```json
{
  "id": "workspace.create-item",
  "description": "Create a work item directly, without drafting. Use only when every field is already known; otherwise prefer workspace.draft-start.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "description": "EPIC, STORY or SUB_TASK" },
      "title": { "type": "string", "description": "Short title" },
      "description": { "type": "string", "description": "Required unless the status is BACKLOG" },
      "parent_id": { "type": "number", "description": "Parent epic (for a STORY) or story (for a SUB_TASK)" },
      "priority": { "type": "string", "description": "LOW, MEDIUM, HIGH or URGENT" },
      "story_points": { "type": "number", "description": "Story points" },
      "estimate_hours": { "type": "number", "description": "Estimated hours" },
      "due_date": { "type": "string", "description": "Due date, ISO 8601" },
      "status": { "type": "string", "description": "Defaults to BACKLOG" }
    },
    "required": ["type", "title"]
  },
  "ui": { "block": "form", "label": "Create work item", "icon": "plus", "submitLabel": "Create" }
},
{
  "id": "workspace.edit-item",
  "description": "Change fields on a work item you report or are assigned to. Refuses items belonging to someone else.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "itemId": { "type": "number", "description": "Numeric work item id" },
      "title": { "type": "string", "description": "New title" },
      "description": { "type": "string", "description": "New description" },
      "priority": { "type": "string", "description": "LOW, MEDIUM, HIGH or URGENT" },
      "story_points": { "type": "number", "description": "Story points" },
      "estimate_hours": { "type": "number", "description": "Estimated hours" },
      "due_date": { "type": "string", "description": "Due date, ISO 8601" }
    },
    "required": ["itemId"]
  },
  "ui": { "block": "form", "label": "Edit item", "icon": "edit", "submitLabel": "Save" }
},
{
  "id": "workspace.move-item",
  "description": "Move a work item to another status column. Only offers transitions your workspace role permits. Refuses items belonging to someone else.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "itemId": { "type": "number", "description": "Numeric work item id" },
      "status": { "type": "string", "description": "BACKLOG, TODO, IN_PROGRESS, IN_REVIEW or DONE" }
    },
    "required": ["itemId", "status"]
  },
  "ui": { "block": "form", "label": "Move item", "icon": "arrow-right", "submitLabel": "Move" }
},
{
  "id": "workspace.comment",
  "description": "Add a comment to a work item.",
  "aiInvocable": true,
  "actionType": "direct",
  "parameters": {
    "type": "object",
    "properties": {
      "itemId": { "type": "number", "description": "Numeric work item id" },
      "body": { "type": "string", "description": "Comment text" }
    },
    "required": ["itemId", "body"]
  },
  "ui": { "block": "form", "label": "Comment", "icon": "message", "submitLabel": "Post" }
}
```

- [ ] **Step 6: Add the cases to `executeTool`**

```ts
case 'workspace.create-item': {
  const io = assertConfigured();
  const workspaceId = await currentWorkspaceId(io, optionalKey(args));
  const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
  const now = new Date().toISOString();

  // Route through the Draft so create-item and the conversational path share
  // one set of rules. Without this the hierarchy and description gates would
  // exist in two places and drift.
  let draft = createDraft({
    id: `d_${now}`,
    workspaceId,
    sourceText: String(args['title'] ?? ''),
    myAccountId,
    now,
  });
  draft = setSlots(draft, buildPatchFromArgs(args), 'user', now);

  const errors = validateForCommit(draft);
  if (errors.length > 0) throw new Error(`Workspace: ${errors.join(' ')}`);

  const item = await io.createItem(workspaceId, toCreatePayload(draft));
  return { id: item.id, text: formatWorkItem(item) };
}

case 'workspace.edit-item': {
  const io = assertConfigured();
  const itemId = requireItemId(args);
  const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;
  const existing = await io.getItem(itemId);
  assertMine(existing, myAccountId, itemId);

  const patch: Record<string, unknown> = {};
  for (const k of ['title', 'description', 'priority', 'due_date'] as const) {
    if (typeof args[k] === 'string' && args[k] !== '') patch[k] = args[k];
  }
  for (const k of ['story_points', 'estimate_hours'] as const) {
    if (typeof args[k] === 'number') patch[k] = args[k];
  }
  if (Object.keys(patch).length === 0) throw new Error('Workspace: nothing to change.');

  const item = await io.updateItem(itemId, patch);
  return { id: item.id, text: formatWorkItem(item) };
}

case 'workspace.move-item': {
  const io = assertConfigured();
  const itemId = requireItemId(args);
  const status = String(args['status'] ?? '').toUpperCase();
  const myAccountId = (await api.storage.get<number>('accountId')) ?? -1;

  const existing = await io.getItem(itemId);
  assertMine(existing, myAccountId, itemId);

  const workspaces = await io.listWorkspaces();
  const ws = workspaces.find((w) => w.id === existing.workspace_id);
  if (ws !== undefined) {
    const perms = resolvePermissions(ws, myAccountId);
    if (!perms.canTransition(existing.status, status as WorkItemStatus)) {
      const legal = perms.allowedTargets(existing.status);
      throw new Error(
        `Workspace: you cannot move #${itemId} from ${existing.status} to ${status}. ` +
          (legal.length > 0 ? `You can move it to: ${legal.join(', ')}.` : 'You have no transitions from this column.')
      );
    }
  }

  const item = await io.moveItem(itemId, { status });
  return { id: item.id, text: formatWorkItem(item) };
}

case 'workspace.comment': {
  const io = assertConfigured();
  const itemId = requireItemId(args);
  const body = String(args['body'] ?? '').trim();
  if (body === '') throw new Error('Workspace: the comment is empty.');
  await io.addComment(itemId, body);
  return { message: `Commented on #${itemId}.` };
}
```

With these helpers above `executeTool`:

```ts
function requireItemId(args: Record<string, unknown>): number {
  const id = Number(args['itemId']);
  if (!Number.isInteger(id)) throw new Error('Workspace: itemId must be a whole number.');
  return id;
}

function assertMine(item: WorkItem, myAccountId: number, itemId: number): void {
  if (isMine(item, myAccountId)) return;
  throw new Error(
    `Workspace: #${itemId} is not yours — you neither reported it nor are assigned to it. ` +
      `Use workspace.edit-any-item if you mean to change someone else's work.`
  );
}

function buildPatchFromArgs(args: Record<string, unknown>): SlotPatch {
  const patch: SlotPatch = {};
  if (typeof args['type'] === 'string') patch.type = args['type'] as SlotPatch['type'];
  if (typeof args['title'] === 'string') patch.title = args['title'];
  if (typeof args['description'] === 'string') patch.description = args['description'];
  if (typeof args['priority'] === 'string') patch.priority = args['priority'] as SlotPatch['priority'];
  if (typeof args['status'] === 'string') patch.status = args['status'] as SlotPatch['status'];
  if (typeof args['due_date'] === 'string') patch.due_date = args['due_date'];
  if (typeof args['parent_id'] === 'number') patch.parent_id = args['parent_id'];
  if (typeof args['story_points'] === 'number') patch.story_points = args['story_points'];
  if (typeof args['estimate_hours'] === 'number') patch.estimate_hours = args['estimate_hours'];
  return patch;
}
```

Add `import { isMine, resolvePermissions } from './permissions.js';` and
`import type { WorkItemStatus } from './types.js';`.

- [ ] **Step 7: Verify**

Run: `bun test plugins/workspace/ packages/core/src/plugins/manifest-conformance.test.ts && bunx turbo run typecheck --filter='!@tardis/cli'`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/workspace
git commit -m "feat(workspace): direct writes, refusing other people's items

actionType is static and resolvePermission grades by tool name, so 'ask only
when the item is someone else's' cannot be configuration. It becomes the
skill boundary instead: these refuse and name the workflow-gated twin."
```

---

## Task 8: The approval-gated skills

**Files:**
- Modify: `plugins/workspace/manifest.json`
- Modify: `plugins/workspace/index.ts`

**Interfaces:**
- Produces: `workspace.edit-any-item`, `workspace.assign`, `workspace.archive-item`, `workspace.delete-item` — all `actionType: "workflow"`

- [ ] **Step 1: Add the four skills to `manifest.json`**

All four carry `"actionType": "workflow"`, so `POST /api/skills/:id/invoke` returns
`APPROVAL_REQUIRED` and the agent loop pauses. Config can tighten them to `deny`
but never loosen them to `allow`.

```json
{
  "id": "workspace.edit-any-item",
  "description": "Change fields on any work item, including one belonging to someone else. Requires approval.",
  "aiInvocable": true,
  "actionType": "workflow",
  "parameters": {
    "type": "object",
    "properties": {
      "itemId": { "type": "number", "description": "Numeric work item id" },
      "title": { "type": "string", "description": "New title" },
      "description": { "type": "string", "description": "New description" },
      "priority": { "type": "string", "description": "LOW, MEDIUM, HIGH or URGENT" },
      "status": { "type": "string", "description": "Target status" },
      "due_date": { "type": "string", "description": "Due date, ISO 8601" }
    },
    "required": ["itemId"]
  },
  "ui": { "block": "form", "label": "Edit any item", "icon": "edit", "submitLabel": "Save" }
},
{
  "id": "workspace.assign",
  "description": "Assign a work item to one or more people. This is the only way to put work on someone other than yourself. Requires approval.",
  "aiInvocable": true,
  "actionType": "workflow",
  "parameters": {
    "type": "object",
    "properties": {
      "itemId": { "type": "number", "description": "Numeric work item id" },
      "accountIds": { "type": "array", "description": "Account ids to assign the item to" }
    },
    "required": ["itemId", "accountIds"]
  },
  "ui": { "block": "form", "label": "Assign", "icon": "users", "submitLabel": "Assign" }
},
{
  "id": "workspace.archive-item",
  "description": "Archive a work item, removing it from the board without deleting it. Requires approval.",
  "aiInvocable": true,
  "actionType": "workflow",
  "parameters": {
    "type": "object",
    "properties": { "itemId": { "type": "number", "description": "Numeric work item id" } },
    "required": ["itemId"]
  },
  "ui": { "block": "form", "label": "Archive", "icon": "archive", "submitLabel": "Archive" }
},
{
  "id": "workspace.delete-item",
  "description": "Delete a work item. The server blocks this if the item has children. Requires approval.",
  "aiInvocable": true,
  "actionType": "workflow",
  "parameters": {
    "type": "object",
    "properties": { "itemId": { "type": "number", "description": "Numeric work item id" } },
    "required": ["itemId"]
  },
  "ui": { "block": "form", "label": "Delete", "icon": "trash", "submitLabel": "Delete" }
}
```

- [ ] **Step 2: Add the cases to `executeTool`**

```ts
case 'workspace.edit-any-item': {
  const io = assertConfigured();
  const itemId = requireItemId(args);
  const patch: Record<string, unknown> = {};
  for (const k of ['title', 'description', 'priority', 'status', 'due_date'] as const) {
    if (typeof args[k] === 'string' && args[k] !== '') patch[k] = args[k];
  }
  if (Object.keys(patch).length === 0) throw new Error('Workspace: nothing to change.');
  const item = await io.updateItem(itemId, patch);
  return { id: item.id, text: formatWorkItem(item) };
}

case 'workspace.assign': {
  const io = assertConfigured();
  const itemId = requireItemId(args);
  const ids = Array.isArray(args['accountIds'])
    ? (args['accountIds'] as unknown[]).filter((v): v is number => typeof v === 'number')
    : [];
  if (ids.length === 0) throw new Error('Workspace: name at least one account id to assign.');
  // The server rejects admin accounts as assignees with a clear 400; let it,
  // rather than duplicating the rule here where it would drift.
  const item = await io.assign(itemId, ids);
  return { id: item.id, text: formatWorkItem(item) };
}

case 'workspace.archive-item': {
  const io = assertConfigured();
  const itemId = requireItemId(args);
  await io.archiveItem(itemId);
  return { message: `Archived #${itemId}.` };
}

case 'workspace.delete-item': {
  const io = assertConfigured();
  const itemId = requireItemId(args);
  await io.deleteItem(itemId);
  return { message: `Deleted #${itemId}.` };
}
```

- [ ] **Step 3: Document the permission config in `docs/workspace-plugin-setup.md`**

Add a section showing how to tighten the defaults, and stating the one-way rule:

```jsonc
"actionOverrides": {
  "workspace.*": "allow",
  "workspace.assign": "ask",
  "workspace.archive-item": "ask",
  "workspace.edit-any-item": "ask",
  "workspace.delete-item": "deny"
}
```

Note that `workspace.*: allow` **cannot** turn `delete-item` into a silent
delete — `resolvePermission` only ever tightens a `workflow` baseline.

- [ ] **Step 4: Verify**

Run: `bun test plugins/workspace/ packages/core/src/plugins/manifest-conformance.test.ts && bunx turbo run typecheck --filter='!@tardis/cli' && bunx eslint plugins/workspace --ext .ts`
Expected: PASS, 0 lint errors, conformance covering 22 skills.

- [ ] **Step 5: Commit**

```bash
git add plugins/workspace docs/workspace-plugin-setup.md
git commit -m "feat(workspace): approval-gated writes for destructive and cross-person changes"
```

---

## Task 9: Prove the whole loop against a real server

**Files:**
- Modify: `docs/workspace-plugin-setup.md`

Use the local server from Plan 1: `http://localhost:3080`, workspace `TARDIS`,
EPIC 1 → STORY 2 → SUB_TASK 3.

**Configure the plugin with a non-admin account.** An admin cannot be an
assignee, so the default assignee is invalid and `my-items` is always empty —
half of this plan cannot be exercised from an admin login.

- [ ] **Step 1: Draft a sub-task end to end, without an LLM in the path**

```bash
curl -s -X POST localhost:<tardis-port>/api/skills/workspace.draft-start/invoke \
  -H 'Content-Type: application/json' \
  -d '{"args":{"text":"add rate limiting to the login endpoint"}}'
```

Expected: `nextQuestion` asks for the type. Then `draft-set` `{"type":"SUB_TASK"}`,
`{"title":"..."}`, and confirm the next question asks which **story** it belongs
under and carries ranked `candidates`.

- [ ] **Step 2: Confirm the description gate fires before the server does**

Set `{"status":"TODO"}` without a description, then call `draft-commit`.
Expected: `created: false` and an error mentioning the description — produced
locally by `validateForCommit`, not by a 400 from the server. Confirm no POST
was made (the item count in the workspace is unchanged).

- [ ] **Step 3: Commit the draft and verify the row**

Expected: `created: true` with an id. Then `workspace.get-item` on that id
returns the title, points, estimate, due date and priority you set.

- [ ] **Step 4: Confirm the ownership guard refuses someone else's item**

Call `workspace.edit-item` against an item assigned to another account.
Expected: a refusal naming `workspace.edit-any-item`. No request reaches the
server — the guard runs after `getItem` but before `updateItem`.

- [ ] **Step 5: Confirm a workflow skill actually pauses**

```bash
curl -s -X POST localhost:<tardis-port>/api/skills/workspace.delete-item/invoke \
  -H 'Content-Type: application/json' -d '{"args":{"itemId":<id>}}'
```

Expected: `{"success":false,"code":"APPROVAL_REQUIRED","preview":...}` and the
item still present. This is the one check that proves D7 is real rather than
declared.

- [ ] **Step 6: Confirm the hierarchy guard matches the server's**

Try `workspace.create-item` with `{"type":"EPIC","parent_id":2,...}`.
Expected: a local refusal mentioning Epic parents, with no request sent. Compare
the wording to the server's own `400 Epic items cannot have a parent`.

- [ ] **Step 7: Exercise the ranking against real epics**

Call `draft-start` with wording that does **not** appear verbatim in any epic
title — e.g. *"stop people brute-forcing the sign-in"* against an epic named
*"Authentication hardening"*. Record whether the right epic appears in
`candidates`.

This is the honest test of D4. `?q=` would return nothing here, and the fuzzy
prefilter alone may too — if the LLM re-rank is what saves it, say so in the
doc; if nothing saves it, that is a finding worth writing down rather than
hiding.

- [ ] **Step 8: Note whether an LLM was actually available**

If no LLM provider is configured, `rankCandidates` falls back to the fuzzy order
and Step 7 measures the prefilter alone. Record which happened — a green result
from the fallback path is not evidence the re-rank works.

- [ ] **Step 9: Write up the results and commit**

Append a "Plan 2 verification" section to `docs/workspace-plugin-setup.md` with
the observed behaviour of each step, especially Step 7.

```bash
git add docs/workspace-plugin-setup.md
git commit -m "docs(workspace): verify the draft loop and write guards against a real server"
```

---

## Definition of done

- [ ] `bun test plugins/workspace/` passes — 113 tests across 8 files (45 from Plan 1, plus ranking 20, draft 24, questions 12, ownership 5, io-client +7)
- [ ] `bunx turbo run typecheck --filter='!@tardis/cli'` passes
- [ ] `bunx eslint plugins/workspace --ext .ts` reports 0 errors
- [ ] Manifest conformance passes with 22 skills
- [ ] A plain-language description produces a correctly-parented work item with points, estimate, due date and priority
- [ ] `draft-commit` never assigns to anyone but you
- [ ] `edit-item` and `move-item` refuse items that are not yours and name the workflow twin
- [ ] `delete-item` returns `APPROVAL_REQUIRED` rather than deleting
- [ ] The description gate fires locally, before the server's 400
- [ ] Task 9 Step 7's ranking result is written down honestly, whatever it was

## What Plan 3 picks up

The `remote-select` field type across Tardis and tardis-app, and the custom web
board. Plan 3 is the only one that touches `tardis-app`, and it must ship the
client support **before** Tardis emits the new field type.
