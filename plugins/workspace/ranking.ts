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

import type { WorkItem } from './types.js';

/**
 * A copy of `fuzzyScore` from @tardis/shared, deliberately.
 *
 * This plugin is the only one that ships a `tsconfig.json`, and a tsconfig in a
 * plugin directory anchors Bun's module resolution to that directory — so a
 * bare `@tardis/shared` import can no longer resolve upward to the repo's
 * node_modules once the plugin is copied into $TARDIS_DATA_DIR/plugins, which
 * is how this server holds them.
 *
 * Verified on the box by adding nothing but a tsconfig.json to a plugin that
 * had just loaded:
 *
 *   Failed to activate plugin "probe-sibling": Cannot find module
 *   '@tardis/shared' from '.../plugins/probe-sibling/helper.ts'
 *
 * Deleting the tsconfig would also work, but `workspaces` covers `plugins/*`,
 * so `turbo run typecheck` reaches this plugin — the only one with the script,
 * and the largest in the repo. Twenty lines of duplication is the cheaper side
 * of that trade. `ranking.test.ts` asserts this stays identical to the shared
 * implementation, so the copy cannot drift unnoticed.
 */
export function fuzzyScore(needle: string, haystack: string): number {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();

  if (h === n) return 1;
  if (h.includes(n)) return 0.9;

  let ni = 0;
  let matched = 0;

  for (let hi = 0; hi < h.length && ni < n.length; hi++) {
    if (h[hi] === n[ni]) {
      matched++;
      ni++;
    }
  }

  if (ni < n.length) return 0; // not all needle chars found

  return (matched / h.length) * 0.8;
}

/**
 * Words carrying no signal about which epic something belongs to. Deliberately
 * small — an aggressive list starts eating domain words ("service", "state").
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
  'add',
  'make',
  'need',
  'want',
  'should',
  'must',
  'can',
  'new',
  'also',
  'when',
  'then',
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

/**
 * Below this, a token did not really match.
 *
 * fuzzyScore has three tiers: 1.0 exact, 0.9 substring, and otherwise a
 * subsequence ratio scaled to 0.8. That third tier is noise at this scale —
 * "rate" scores 0.188 against "ContRAcTor modulE" because the letters happen to
 * appear in order. Measured against a real workspace, a query about login rate
 * limiting surfaced Contractor Module, Contractor Agreement and R&D System
 * Development, none of which are related to anything.
 *
 * 0.5 keeps the exact and substring tiers and discards the subsequence one.
 */
const MIN_TOKEN_SCORE = 0.5;

export function scoreAgainst(
  query: string,
  item: { title: string; description: string | null }
): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  const keep = (score: number): number => (score >= MIN_TOKEN_SCORE ? score : 0);

  let total = 0;
  for (const token of tokens) {
    // Threshold BEFORE the description weight, so a genuine substring match in
    // a description is not scaled below the floor and thrown away.
    const titleScore = keep(fuzzyScore(token, item.title));
    const descScore =
      item.description === null ? 0 : keep(fuzzyScore(token, item.description)) * DESCRIPTION_WEIGHT;
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

  // An empty shortlist means the query had real tokens and none of them
  // matched. That is an answer, not a failure — offering the first three items
  // instead would dress unrelated work up as candidates. `prefilter` already
  // returns everything for the genuinely-no-opinion case (a query with no
  // usable tokens), so this only fires when we know nothing fits.
  const pool = prefilter(query, items);
  if (pool.length === 0) return [];

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
      `Workspace: candidate re-rank failed (${
        err instanceof Error ? err.message : String(err)
      }), using fuzzy order`
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
