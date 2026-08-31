import type { AgentConfig, AgentStep, PluginManifest, ThoughtTrace, ToolDefinition } from '@tardis/shared';
import type { LLMMessage, LLMProvider } from '../llm/provider.js';
import type { ToolRouter } from './tool-router.js';
import type { MemoryRetriever } from '../memory/memory-retriever.js';
import type { ConversationStore } from '../memory/conversation-store.js';
import type { ThoughtTracer } from './thought-tracer.js';
import type { MemoryExecutor } from '../memory/memory-tools.js';
import { randomUUID } from 'crypto';
import { runAgentLoop } from './agent-loop.js';
import type { PendingApproval } from './agent-loop.js';
import { selectPlugins } from './plugin-router.js';
import { CLARIFY_TOOL } from './clarify.js';
import { applyTurnEnd, applyTurnStart } from './turn-filters.js';
import type { TurnFilter } from './turn-filters.js';
import { capabilityDetail, describeCapabilities, isCapabilityQuestion } from './capabilities.js';

/**
 * One user message, all the way through TARDIS.
 *
 * This used to live inside the Telegram handler, which meant Telegram was the
 * only way to reach the agent at all — there was no HTTP path, so no web or
 * terminal client could actually *talk* to the assistant. Extracting it means
 * every surface runs the identical pipeline: plugin selection, memory
 * retrieval, the agent loop, trace persistence and history persistence. A fix
 * in one surface is a fix in all of them.
 */

export interface ConversationDeps {
  llmProvider: LLMProvider;
  toolRouter: ToolRouter;
  agentConfig: AgentConfig;
  getAllManifests: () => PluginManifest[];
  memoryRetriever?: MemoryRetriever;
  memoryTools?: ToolDefinition[];
  memoryExecutor?: MemoryExecutor;
  conversationStore?: ConversationStore;
  thoughtTracer?: ThoughtTracer;
  contextWindowSize?: number;
  /**
   * Plugin hooks that see the whole turn. See turn-filters.ts — in particular
   * that an onTurnStart rewrite is total: history and the trace record the
   * rewritten message, not the original.
   */
  turnFilters?: TurnFilter[];
}

export interface ConversationTurnInput {
  chatId: string;
  message: string;
  /** Data-URI images attached to this message. At most one reaches the model. */
  images?: string[];
  /** Fires as the turn progresses, so a client can show work instead of a blank wait. */
  onStep?: (step: AgentStep) => void;
  /** Fires once plugin selection is done, before the slower agent loop begins. */
  onPluginsSelected?: (plugins: string[]) => void;
  /**
   * History to use instead of reading the store.
   *
   * For callers that keep their own (the Telegram bot falls back to an
   * in-memory map when no ConversationStore is configured).
   */
  history?: LLMMessage[];
}

export interface ConversationTurnResult {
  response: string;
  trace: ThoughtTrace;
  selectedPlugins: string[];
  pendingApproval?: PendingApproval;
}

export async function runConversationTurn(
  input: ConversationTurnInput,
  deps: ConversationDeps
): Promise<ConversationTurnResult> {
  const { chatId } = input;

  // Before anything else, so plugin selection, memory retrieval, the trace and
  // the stored history all agree about what was asked.
  const filters = deps.turnFilters ?? [];
  const startedAt = Date.now();
  const message = await applyTurnStart(filters, { chatId, userMessage: input.message });

  // ─── "What can you do?" ────────────────────────────────────────────────
  //
  // Answered from the manifests, before the model is involved at all.
  //
  // Skill-based selection means the agent only sees the tools of the plugins
  // the router picked, so asked what it can do it reports that subset as the
  // whole. Live, with only `notes` selected, it listed five note skills and
  // concluded "that is the primary set of tools I have access to" — true about
  // what it could see, false about TARDIS.
  //
  // This used to exist in the Telegram bot only, which is why the web app, the
  // mobile app and the terminal could not describe TARDIS at all.
  if (isCapabilityQuestion(message)) {
    return finishTurn({
      chatId,
      message,
      answer: describeCapabilities(deps.getAllManifests(), capabilityDetail(message)),
      filters,
      startedAt,
      deps,
    });
  }

  const { tools, selectedPlugins, method } = await selectPlugins(
    message,
    deps.getAllManifests(),
    deps.llmProvider
  );
  input.onPluginsSelected?.(selectedPlugins);

  const memories = deps.memoryRetriever ? await deps.memoryRetriever.getRelevant(message) : [];

  // Memory tools and clarify are always available — neither is subject to
  // plugin selection, because both apply regardless of which plugins were picked.
  const availableTools = [...tools, ...(deps.memoryTools ?? []), CLARIFY_TOOL];

  const pluginExecutor = deps.toolRouter.asExecutor();
  const executeTool = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    if (toolName.startsWith('memory.') && deps.memoryExecutor) {
      return deps.memoryExecutor.execute(toolName, args);
    }
    return pluginExecutor(toolName, args);
  };

  const maxMessages = deps.agentConfig.conversationHistoryLength * 2;
  const conversationHistory =
    input.history ??
    (deps.conversationStore ? await deps.conversationStore.getHistory(chatId, maxMessages) : []);

  const result = await runAgentLoop({
    userMessage: message,
    conversationHistory,
    memories,
    availableTools,
    selectedPlugins,
    config: deps.agentConfig,
    llmProvider: deps.llmProvider,
    executeTool,
    ...(deps.contextWindowSize !== undefined ? { contextWindowSize: deps.contextWindowSize } : {}),
    ...(input.images?.length ? { userImages: input.images } : {}),
    ...(input.onStep ? { onStep: input.onStep } : {}),
    pluginSelectionMethod: method,
  });

  const response = await applyTurnEnd(filters, {
    chatId,
    userMessage: message,
    response: result.response,
    steps: result.trace.steps,
  });
  // The trace is a record of the turn as delivered, so it carries the filtered
  // response rather than the one the loop happened to produce.
  result.trace.finalResponse = response;

  // Best-effort: a tracing failure must never turn a good answer into an error.
  if (deps.thoughtTracer) {
    try {
      await deps.thoughtTracer.save(result.trace);
    } catch (err) {
      console.error(`[conversation] Failed to save trace for chat ${chatId}:`, err);
    }
  }

  await persistHistory(chatId, message, { ...result, response }, deps);

  return {
    response,
    trace: result.trace,
    selectedPlugins,
    ...(result.pendingApproval ? { pendingApproval: result.pendingApproval } : {}),
  };
}

/**
 * Completes a turn that was answered without running the agent loop.
 *
 * Everything after the answer still has to happen: `onTurnEnd` filters, the
 * thought trace, and — the one that matters most — history. A short-circuit
 * that skipped persistence would leave the next message with no idea what was
 * just said, which is precisely how the live transcript ended up going in
 * circles.
 */
async function finishTurn(args: {
  chatId: string;
  message: string;
  answer: string;
  filters: TurnFilter[];
  startedAt: number;
  deps: ConversationDeps;
}): Promise<ConversationTurnResult> {
  const { chatId, message, filters, startedAt, deps } = args;

  const response = await applyTurnEnd(filters, {
    chatId,
    userMessage: message,
    response: args.answer,
    steps: [],
  });

  const trace: ThoughtTrace = {
    id: randomUUID(),
    userMessage: message,
    steps: [
      {
        type: 'reasoning',
        content: response,
        timestamp: startedAt,
        durationMs: Date.now() - startedAt,
      },
    ],
    finalResponse: response,
    totalDurationMs: Date.now() - startedAt,
    // Honest: no model was asked. A trace claiming otherwise would make the
    // traces page lie about where an answer came from.
    modelUsed: 'none (answered from plugin manifests)',
    timestamp: startedAt,
  };

  if (deps.thoughtTracer) {
    try {
      await deps.thoughtTracer.save(trace);
    } catch (err) {
      console.error(`[conversation] Failed to save trace for chat ${chatId}:`, err);
    }
  }

  await persistHistory(chatId, message, { response, trace }, deps);

  return { response, trace, selectedPlugins: [] };
}

/**
 * Writes the turn to history, replaying completed tool calls.
 *
 * Without the tool calls the stored history reads as "user asks -> assistant
 * confirms", which is what taught the model it could claim success without
 * acting. Only complete call/result pairs are written: an approval pause
 * produces a call with no result, and a dangling tool_call makes the next
 * request's message sequence invalid.
 */
async function persistHistory(
  chatId: string,
  message: string,
  result: { response: string; trace: ThoughtTrace },
  deps: ConversationDeps
): Promise<void> {
  const store = deps.conversationStore;
  if (!store) return;

  await store.appendMessage(chatId, { role: 'user', content: message });

  const steps = result.trace.steps;
  for (let i = 0; i < steps.length; i++) {
    const call = steps[i];
    const observed = steps[i + 1];
    if (call?.type !== 'tool_call' || !call.toolName) continue;
    if (observed?.type !== 'tool_result' || observed.toolName !== call.toolName) continue;

    await store.appendMessage(chatId, {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: call.toolName, name: call.toolName, arguments: call.toolArgs ?? {} }],
    });
    await store.appendMessage(chatId, {
      role: 'tool',
      content: JSON.stringify(observed.toolResult ?? null),
      name: call.toolName,
    });
    i++; // the result step is consumed by the pair above
  }

  await store.appendMessage(chatId, { role: 'assistant', content: result.response });
}
