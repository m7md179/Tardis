/**
 * The internal-operation wire format, mirrored by hand.
 *
 * snake_case throughout, because the server has no camelCase interceptor —
 * `workspace.service.ts` builds `my_settings` literally. The website's
 * camelCase types are its own client-side mapping, not the wire.
 *
 * Renaming anything here to camelCase compiles fine and reads `undefined` at
 * runtime, which `permissions.ts` would otherwise interpret as "no rules".
 */

export type WorkItemStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type WorkItemType = 'EPIC' | 'STORY' | 'SUB_TASK';
export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type WorkspaceRole = 'VIEWER' | 'MEMBER' | 'LEAD';

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
];

export type CapabilityKey =
  | 'create_items'
  | 'edit_items'
  | 'assign'
  | 'apply_labels'
  | 'manage_sprint_items'
  | 'comment'
  | 'log_time'
  | 'manage_checklist'
  | 'manage_attachments'
  | 'delete_items';

export interface TransitionEdge {
  from: WorkItemStatus;
  to: WorkItemStatus;
}

/** null on the workspace payload means ADMIN or LEAD — unrestricted. */
export interface MemberSettings {
  role: WorkspaceRole;
  own_items_only: boolean;
  act_own_only: boolean;
  hidden_tabs: string[];
  revoked_capabilities: CapabilityKey[];
  allowed_transitions: TransitionEdge[];
}

export interface Assignee {
  account_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

export interface Workspace {
  id: number;
  name: string;
  key: string;
  description: string | null;
  status: string;
  color: string | null;
  lead_account_id: number | null;
  project_id: number | null;
  my_role: 'ADMIN' | WorkspaceRole | null;
  my_settings: MemberSettings | null;
}

export interface WorkItem {
  id: number;
  workspace_id: number;
  type: WorkItemType;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  story_points: number | null;
  estimate_hours: number | null;
  start_date: string | null;
  due_date: string | null;
  parent_id: number | null;
  sprint_id: number | null;
  reporter_account_id: number;
  /**
   * null on create/update responses, [] on board/list responses. Verified
   * against a real server — the asymmetry is the server's, not a typo.
   */
  assignees: Assignee[] | null;
  archived_at: string | null;
}

/** GET /workspaces/:id/board — the five fixed columns. */
export type Board = Record<WorkItemStatus, WorkItem[]>;

/** Every internal-operation response is wrapped like this. */
export interface IoEnvelope<T> {
  data: T;
  status: number;
  message: string;
}
