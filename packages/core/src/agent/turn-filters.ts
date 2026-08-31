import type { AgentStep } from '@tardis/shared';

/**
 * Plugin hooks that see a whole turn, rather than being called as a tool.
 *
 * Until now a plugin could only be *invoked*. Anything cross-cutting had to be
 * hardcoded in `agent-loop.ts` — the claim-vs-reality guard, the completion
 * guard, the unrecorded-amount check, the textual-tool-call recovery. Four
 * special cases in one file, with no way to add a fifth without editing core.
 *
 * A filter is discovered from a plugin's module exports, the same way proactive
 * handlers are: export `onTurnStart` and/or `onTurnEnd` and they are picked up
 * at load.
 *
 * ## The rewrite is total
 *
 * A message rewritten by `onTurnStart` is the message for the rest of the turn:
 * plugin selection, memory retrieval, the agent loop, the thought trace and the
 * stored history all see the rewritten text, and the original is not kept.
 *
 * That is deliberate. The alternative — model sees one thing, history records
 * another — means the next turn replays a conversation that never happened, and
 * makes a trace a record of something other than what ran. It does mean a
 * filter must not rewrite into anything the user would be startled to find in
 * their own transcript.
 *
 * ## No short-circuit
 *
 * `onTurnStart` cannot end a turn early with a canned reply. It would be useful
 * — a blocklist, a rate limiter — but it is a larger contract than this needs
 * (what does the trace contain? is it persisted?), and nothing queued wants it
 * yet. Adding it later is additive.
 */
export interface TurnStartContext {
  chatId: string;
  userMessage: string;
}

export interface TurnEndContext {
  chatId: string;
  /** The message the loop actually ran on — post-`onTurnStart`. */
  userMessage: string;
  response: string;
  steps: AgentStep[];
}

export interface TurnFilter {
  /** Owning plugin. Used only to name the culprit when a filter throws. */
  plugin: string;
  onTurnStart?: ((ctx: TurnStartContext) => Promise<{ userMessage?: string } | void>) | undefined;
  onTurnEnd?: ((ctx: TurnEndContext) => Promise<{ response?: string } | void>) | undefined;
}

/** Where a filter failure is reported. Defaults to console. */
export interface FilterLogger {
  error: (message: string, err: unknown) => void;
}

const defaultLogger: FilterLogger = {
  error: (message, err) => console.error(message, err),
};

/**
 * Runs every `onTurnStart` in order, threading the message through them.
 *
 * **A filter that can rewrite a turn can break every turn**, so a throwing
 * filter is skipped and logged and the previous message stands. The same
 * isolation every other plugin call already gets.
 *
 * A filter that returns nothing, or an empty/blank message, leaves the message
 * alone — returning `{}` is the natural way to say "no change", and a filter
 * that blanks the message would otherwise send an empty turn to the model.
 */
export async function applyTurnStart(
  filters: TurnFilter[],
  ctx: TurnStartContext,
  logger: FilterLogger = defaultLogger
): Promise<string> {
  let userMessage = ctx.userMessage;

  for (const filter of filters) {
    if (!filter.onTurnStart) continue;
    try {
      const out = await filter.onTurnStart({ ...ctx, userMessage });
      const next = out?.userMessage;
      if (typeof next === 'string' && next.trim()) userMessage = next;
    } catch (err) {
      logger.error(`[turn-filter] ${filter.plugin}.onTurnStart failed — skipped:`, err);
    }
  }

  return userMessage;
}

/**
 * Runs every `onTurnEnd` in order, threading the response through them.
 *
 * Same isolation, and the same reason an empty rewrite is ignored: Telegram
 * rejects empty message text outright, so a filter must not be able to produce
 * a turn that cannot be delivered.
 */
export async function applyTurnEnd(
  filters: TurnFilter[],
  ctx: TurnEndContext,
  logger: FilterLogger = defaultLogger
): Promise<string> {
  let response = ctx.response;

  for (const filter of filters) {
    if (!filter.onTurnEnd) continue;
    try {
      const out = await filter.onTurnEnd({ ...ctx, response });
      const next = out?.response;
      if (typeof next === 'string' && next.trim()) response = next;
    } catch (err) {
      logger.error(`[turn-filter] ${filter.plugin}.onTurnEnd failed — skipped:`, err);
    }
  }

  return response;
}
