/**
 * compose.ts — turn a branch name and its commits into a work item's title
 * and description.
 *
 * See docs/specs/2026-09-06-branch-linked-work-items-design.md §11.2.
 *
 * By the time this runs the push has already succeeded, so nothing here may
 * throw: an unreachable model, a model that answers in prose, and a model that
 * wraps its JSON in markdown fences all resolve to the deterministic fallback.
 * Losing the work item over a transient LLM failure would be a worse outcome
 * than a plainly-worded one.
 */

export interface Commit {
  subject: string;
  body: string;
  sha: string;
}

export interface Composition {
  title: string;
  description: string;
}

export interface ComposeDeps {
  generate: (prompt: string) => Promise<string>;
  logger: { debug: (msg: string) => void; warn: (msg: string) => void };
}

/** `feat/`, `fix/`, `chore/`… — the conventional prefix is noise in a title. */
const TYPE_PREFIX = /^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)\//i;

const MAX_COMMITS_IN_PROMPT = 50;

/**
 * Deterministic, never fails. `feat/auto-submit-week-on-build` becomes
 * "Auto submit week on build"; anything that reduces to nothing becomes the
 * branch name verbatim, because the server rejects an empty title.
 */
export function composeFallback(branch: string, commits: Commit[]): Composition {
  const words = branch
    .replace(TYPE_PREFIX, '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const title =
    words === '' ? (branch.trim() === '' ? 'Untitled branch' : branch.trim()) : capitalise(words);

  const description =
    commits.length === 0
      ? `Created from branch \`${branch}\`.`
      : `Created from branch \`${branch}\`.\n\n` +
        commits.map((c) => `- ${c.subject}`).join('\n');

  return { title, description };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Strip a ```json fence, which small models add whether or not you ask. */
function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

export function parseComposition(raw: string): Composition | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
  const description =
    typeof record['description'] === 'string' ? record['description'].trim() : '';
  if (title === '') return null;

  return { title, description };
}

function buildPrompt(branch: string, commits: Commit[]): string {
  const log = commits
    .slice(0, MAX_COMMITS_IN_PROMPT)
    .map((c) => (c.body.trim() === '' ? `- ${c.subject}` : `- ${c.subject}\n  ${c.body.trim()}`))
    .join('\n');

  return [
    'You are naming a work item for a task tracker, from a git branch.',
    '',
    `Branch: ${branch}`,
    commits.length > 0 ? `Commits:\n${log}` : 'No commits yet.',
    '',
    'Reply with JSON only: {"title": "...", "description": "..."}',
    'The title reads as a task someone was asked to do, not as a branch name,',
    'and is at most 90 characters. The description says what changed and why,',
    'in at most three sentences. No markdown fences.',
  ].join('\n');
}

export async function compose(
  deps: ComposeDeps,
  branch: string,
  commits: Commit[]
): Promise<Composition> {
  const fallback = composeFallback(branch, commits);
  try {
    const raw = await deps.generate(buildPrompt(branch, commits));
    const parsed = parseComposition(raw);
    if (parsed === null) {
      deps.logger.warn(`compose: unusable model output for ${branch}, using the branch name`);
      return fallback;
    }
    return {
      title: parsed.title,
      description: parsed.description === '' ? fallback.description : parsed.description,
    };
  } catch (err) {
    deps.logger.warn(`compose: model unavailable for ${branch} (${String(err)}), using the branch name`);
    return fallback;
  }
}
