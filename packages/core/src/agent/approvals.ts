import type { PendingApproval } from './agent-loop.js';

/**
 * Saying yes to something TARDIS offered to do.
 *
 * This lived in the Telegram bot, which meant a workflow skill was simply
 * unreachable from the web app, the mobile app and the terminal: `/api/chat`
 * returned a `pendingApproval` and nothing stored it, so the next message
 * started a fresh turn, the model proposed the same delete again, and round it
 * went. Observed live as a soft lock — "do it" three times, three identical
 * offers to run `workspace.delete-item`.
 *
 * The vocabulary was also too small to survive a real person. "do it",
 * "go ahead" and "sure" were all rejected.
 */

const APPROVAL_WORDS = new Set([
  'y',
  'yes',
  'yep',
  'yeah',
  'yup',
  'ok',
  'okay',
  'sure',
  'confirm',
  'confirmed',
  'approve',
  'approved',
  'proceed',
  'go',
  'do it',
  'go ahead',
  'yes please',
  'run it',
  'go for it',
  'please do',
]);

const DENIAL_WORDS = new Set([
  'n',
  'no',
  'nope',
  'cancel',
  'stop',
  'nevermind',
  'never mind',
  'dont',
  "don't",
  'do not',
  'abort',
  'no thanks',
]);

/** Normalises the trailing punctuation people type without thinking about it. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/[.!,]+$/, '');
}

export function isApprovalText(text: string): boolean {
  return APPROVAL_WORDS.has(normalise(text));
}

export function isDenialText(text: string): boolean {
  return DENIAL_WORDS.has(normalise(text));
}

/**
 * Where a paused action waits for an answer.
 *
 * Deliberately not persisted. A pending delete surviving a restart is a
 * surprise waiting to happen, and losing one costs nothing — the user simply
 * asks again.
 */
export interface PendingApprovalStore {
  get(chatId: string): PendingApproval | undefined;
  set(chatId: string, approval: PendingApproval): void;
  delete(chatId: string): void;
}

export function createPendingApprovalStore(): PendingApprovalStore {
  const byChat = new Map<string, PendingApproval>();
  return {
    get: (chatId) => byChat.get(chatId),
    set: (chatId, approval) => {
      byChat.set(chatId, approval);
    },
    delete: (chatId) => {
      byChat.delete(chatId);
    },
  };
}

/**
 * What to do with a message that arrived while something was pending.
 *
 * Anything that is not a clear yes cancels. That is the safe direction: a
 * destructive action should never run because a reply was ambiguous, and the
 * user can always ask again.
 */
export type ApprovalDecision = 'approve' | 'cancel';

export function decideApproval(text: string): ApprovalDecision {
  return isApprovalText(text) ? 'approve' : 'cancel';
}

/** How a cancellation is worded, so every surface says the same thing. */
export function cancellationMessage(toolName: string, denied: boolean): string {
  return denied
    ? `Cancelled — I have not run ${toolName}.`
    : `Cancelled ${toolName}, since that was not a yes. Ask again if you did mean to run it.`;
}
