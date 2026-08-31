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
    (slots as unknown as Record<string, Slot<unknown>>)[name] = { value, source };
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
