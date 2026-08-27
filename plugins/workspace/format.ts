/**
 * Payloads to text.
 *
 * Chat surfaces get a string; structured surfaces get the raw object and bind
 * through the UI descriptor. Keeping composition here rather than in a
 * descriptor is what lets UI-CONTRACT.md keep its "no expressions" rule.
 */

import type { Board, WorkItem, Workspace } from './types.js';
import { WORK_ITEM_STATUSES } from './types.js';

function present(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
}

export function displayName(p: {
  first_name: string | null;
  last_name: string | null;
  email: string;
}): string {
  const parts = [present(p.first_name), present(p.last_name)].filter(
    (x): x is string => x !== null
  );
  return parts.length > 0 ? parts.join(' ') : p.email;
}

/** ISO timestamp to a bare date. Times on due dates are noise. */
function asDate(iso: string | null): string | null {
  if (iso === null) return null;
  return iso.slice(0, 10);
}

export function formatWorkItem(item: WorkItem): string {
  const bits: string[] = [item.priority, item.status];
  if (item.story_points !== null) bits.push(`${item.story_points} pts`);
  if (item.estimate_hours !== null) bits.push(`${item.estimate_hours}h`);
  const due = asDate(item.due_date);
  if (due !== null) bits.push(`due ${due}`);
  if (item.assignees.length > 0) bits.push(item.assignees.map(displayName).join(', '));

  return `#${item.id} ${item.title}\n  ${bits.join(' · ')}`;
}

export function formatBoard(board: Board): string {
  return WORK_ITEM_STATUSES.map((status) => {
    const items = board[status] ?? [];
    const body = items.length === 0 ? '  (empty)' : items.map((i) => `  #${i.id} ${i.title}`).join('\n');
    return `${status} (${items.length})\n${body}`;
  }).join('\n\n');
}

export function formatWorkspaceSummary(w: Workspace): string {
  const role = w.my_role ?? 'MEMBER';
  return `${w.key} — ${w.name} (${role})`;
}
