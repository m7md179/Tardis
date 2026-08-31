/**
 * What to ask next, and how to show the draft.
 *
 * Split from draft.ts so the state machine's tests are about logic and this
 * file's are about wording. They change for different reasons.
 *
 * The plugin composes the question, not the model. The model's only job is to
 * relay it through `clarify` and parse the answer — which is what keeps the
 * structure of the conversation independent of model quality.
 */

import type { Candidate } from './ranking.js';
import type { Draft, DraftSlots, SlotName } from './draft.js';
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
    const slot = draft.slots[name as keyof DraftSlots];
    if (slot.source === 'unset' || slot.value === null) continue;
    const shown = Array.isArray(slot.value) ? slot.value.join(', ') : String(slot.value);
    // Marking assumptions is what makes "is that right?" answerable.
    const note = slot.source === 'default' ? ' (assumed)' : '';
    lines.push(`  ${label}: ${shown}${note}`);
  }

  return lines.length === 0 ? '  (nothing set yet)' : lines.join('\n');
}
