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
