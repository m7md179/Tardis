/**
 * What the current user is allowed to do in one workspace.
 *
 * Mirrors the server's own rules (`workspace-membership.service.ts`) so the
 * plugin never offers an action that is about to 403. This is a UX layer, not
 * a security boundary — the server enforces regardless.
 *
 * Fails CLOSED. A settings object missing its arrays is treated as maximally
 * restricted rather than unrestricted, because the realistic way that happens
 * is a client type drifting to camelCase against a snake_case wire, and
 * "silently allow everything" is the wrong direction to be wrong in.
 */

import type {
  CapabilityKey,
  MemberSettings,
  TransitionEdge,
  WorkItemStatus,
  Workspace,
} from './types.js';
import { WORK_ITEM_STATUSES } from './types.js';

export interface Permissions {
  can(cap: CapabilityKey): boolean;
  canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean;
  allowedTargets(from: WorkItemStatus): WorkItemStatus[];
  canActOnItem(item: {
    assignees: { account_id: number }[] | null;
    reporter_account_id: number;
  }): boolean;
}

const UNRESTRICTED: Permissions = {
  can: () => true,
  canTransition: (from, to) => from !== to,
  allowedTargets: (from) => WORK_ITEM_STATUSES.filter((s) => s !== from),
  canActOnItem: () => true,
};

const DENY_ALL: Permissions = {
  can: () => false,
  canTransition: () => false,
  allowedTargets: () => [],
  canActOnItem: () => false,
};

/** A settings object we can actually reason about, or null if it is malformed. */
function validated(s: MemberSettings): MemberSettings | null {
  if (
    !Array.isArray(s.revoked_capabilities) ||
    !Array.isArray(s.allowed_transitions) ||
    typeof s.act_own_only !== 'boolean'
  ) {
    return null;
  }
  return s;
}

export function resolvePermissions(workspace: Workspace, myAccountId: number): Permissions {
  const raw = workspace.my_settings;

  // null = ADMIN or LEAD. Not "not a member".
  if (raw === null || raw === undefined) return UNRESTRICTED;

  const s = validated(raw);
  if (s === null) return DENY_ALL;
  if (s.role === 'VIEWER') return DENY_ALL;

  const revoked = new Set<CapabilityKey>(s.revoked_capabilities);
  const edges: TransitionEdge[] = s.allowed_transitions;

  return {
    can: (cap) => !revoked.has(cap),
    canTransition: (from, to) => edges.some((e) => e.from === from && e.to === to),
    allowedTargets: (from) => edges.filter((e) => e.from === from).map((e) => e.to),
    canActOnItem: (item) =>
      !s.act_own_only || (item.assignees ?? []).some((a) => a.account_id === myAccountId),
  };
}

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
  // -1 is the "not logged in yet" sentinel. It must never match anything.
  if (myAccountId < 0) return false;
  if (item.reporter_account_id === myAccountId) return true;
  return (item.assignees ?? []).some((a) => a.account_id === myAccountId);
}
