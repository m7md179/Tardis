import type { ActionType, Permission } from '@tardis/shared';

/**
 * What a tool is allowed to do, and who decides.
 *
 * TARDIS shipped with two states: a skill declared itself `direct` (runs) or
 * `workflow` (asks). That cannot express the thing you actually want most —
 * *never do this, not even if I approve it*. Deleting a savings goal is not
 * something to be careful about; for most setups it is something to forbid.
 *
 * So a skill's declaration becomes a **baseline**, and configuration grades it:
 *
 *   direct   → allow   (may be raised to ask or deny)
 *   workflow → ask     (may be raised to deny, never lowered to allow)
 *
 * The one-way rule is inherited from the original design and is the whole point
 * of the baseline: a plugin author marking something as needing approval is
 * making a safety claim, and configuration may tighten that claim but never
 * void it. A `budget.*: allow` rule cannot turn `budget.delete-goal` into a
 * silent delete.
 */

const RANK: Record<Permission, number> = { allow: 0, ask: 1, deny: 2 };

/** What a skill's own declaration means before any configuration is applied. */
export function baselineFor(declared: ActionType): Permission {
  return declared === 'workflow' ? 'ask' : 'allow';
}

/**
 * Reads a configured value, accepting the pre-grading vocabulary.
 *
 * Configs written before this existed hold `direct`/`workflow`. Rejecting them
 * would turn an upgrade into a broken deployment for a rename.
 */
function asPermission(value: string): Permission | null {
  if (value === 'allow' || value === 'ask' || value === 'deny') return value;
  if (value === 'direct') return 'allow';
  if (value === 'workflow') return 'ask';
  return null;
}

/**
 * Glob → anchored regex. `*` matches any run, `?` exactly one character.
 *
 * Everything else is escaped, so a `.` in `budget.delete-entry` matches a literal
 * dot rather than any character — which matters when every tool name contains one.
 */
export function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*';
      if (ch === '?') return '.';
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`);
}

export function matchesGlob(pattern: string, toolName: string): boolean {
  return globToRegExp(pattern).test(toolName);
}

/**
 * What is known about this call beyond the rules — the second axis.
 *
 * `mutates` answers *does it change anything*, which the glob rules cannot:
 * `direct` covers both `budget.this-month` and `budget.add-entry`, so the
 * obvious read-only preset `{ '*': 'deny' }` silences reading too. Skills
 * declare the answer; see `resolveMutates` in the manifest schema.
 *
 * `mutates` is deliberately compared against `false` rather than truthiness.
 * A tool nobody has classified is treated as mutating, because the cost of
 * being wrong runs one way: refusing a harmless read is an inconvenience,
 * running an unclassified write in read-only mode is the bug read-only exists
 * to prevent.
 */
export interface PermissionContext {
  /** Whether the skill changes state. Undefined means unclassified. */
  mutates?: boolean | undefined;
  /** Global read-only mode: nothing that changes state may run. */
  readOnly?: boolean | undefined;
}

/**
 * The effective permission for one tool call.
 *
 * Rules are walked in the order they appear and **the last match wins**, so a
 * broad rule can be written first and narrowed afterwards:
 *
 *   { "budget.*": "ask", "budget.this-month": "allow" }
 *
 * Object key order in JS is insertion order for non-numeric keys, which is what
 * makes "last wins" mean "last as written in the config file".
 */
export function resolvePermission(
  toolName: string,
  declared: ActionType,
  overrides: Record<string, string> = {},
  context: PermissionContext = {}
): Permission {
  const baseline = baselineFor(declared);
  let resolved = baseline;

  for (const [pattern, raw] of Object.entries(overrides)) {
    if (!matchesGlob(pattern, toolName)) continue;
    const candidate = asPermission(raw);
    if (candidate) resolved = candidate;
  }

  // Never weaker than the skill declared for itself.
  const graded = RANK[resolved] >= RANK[baseline] ? resolved : baseline;

  // Read-only is a floor, not a rule, so it is applied after grading and a
  // per-tool `allow` cannot punch through it. A switch that some other line of
  // config can quietly cancel is not a switch worth having.
  if (context.readOnly && context.mutates !== false) return 'deny';

  return graded;
}

