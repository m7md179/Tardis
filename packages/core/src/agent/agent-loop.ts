import { randomUUID } from 'crypto';
import type {
  AgentConfig,
  AgentStep,
  MemoryEntry,
  ThoughtTrace,
  ToolDefinition,
} from '@tardis/shared';
import type { LLMMessage, LLMProvider } from '../llm/provider.js';
import { fitToContextWindow } from './context-manager.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PendingApproval {
  toolName: string;
  args: Record<string, unknown>;
  /** Human-readable description of what the tool will do — shown to the user for confirmation. */
  preview: string;
}

export interface AgentLoopInput {
  userMessage: string;
  conversationHistory: LLMMessage[];
  memories: MemoryEntry[];
  /** Full tool schemas for the plugins selected by the skill router. */
  availableTools: ToolDefinition[];
  /** Plugin names that the skill router chose (for tracing). */
  selectedPlugins: string[];
  config: AgentConfig;
  llmProvider: LLMProvider;
  /** Model's max context window in tokens. Defaults to 4096 if not provided. */
  contextWindowSize?: number;
  /**
   * Executes a tool by name with the given arguments.
   * Provided by the ToolRouter (Phase 2 Task 5).
   * The agent loop calls this and treats any thrown error as a tool error result.
   */
  executeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentLoopOutput {
  response: string;
  trace: ThoughtTrace;
  /** Present when the agent wants to perform a Workflow action requiring user approval. */
  pendingApproval?: PendingApproval;
}

// ─── Loop guards ──────────────────────────────────────────────────────────────

/**
 * How many times a turn may be restarted because the model answered as if it had
 * acted without ever calling a tool. One retry is enough: if the nudge does not
 * land the second time, the model genuinely has nothing to call.
 */
const MAX_CLAIM_RETRIES = 1;

/**
 * Sent back to the model when it claims an action is done but called no tool.
 *
 * Restating the original request matters. A purely meta-worded correction
 * ("you did not call any tool, call one if needed") makes small models reply
 * conversationally — measured 0/3 tool calls against gemma-4-E2B, with the
 * model apologising and then repeating the same false claim. Re-issuing the
 * request as an imperative gets 3/3, and the trailing escape clause keeps a
 * false-positive detection from forcing a bogus tool call (0/3 hallucinated
 * calls when no tool applies).
 */
function claimCorrectionNudge(userMessage: string): string {
  return (
    'You did not call any tool, so nothing actually happened yet. ' +
    `Call the tool that performs this request now: "${userMessage}". ` +
    'If no tool can do it, say so plainly instead of claiming it is done.'
  );
}

/**
 * Matches responses that assert an action was carried out ("Reminder set…",
 * "I've added…", "Done."). Used only to decide whether a tool-less response is
 * suspicious — a false positive costs one extra LLM call, nothing more.
 */
const COMPLETION_CLAIM_PATTERN = new RegExp(
  [
    // "I've set…", "I have created…", "I set…"
    /\bi(?:'ve|\s+have)?\s+(?:just\s+)?(?:set|created|added|scheduled|started|stopped|paused|resumed|saved|deleted|removed|updated|cancell?ed|completed|marked|logged)\b/
      .source,
    // "Reminder set", "Task added", "Timer has been started"
    /\b(?:memory|memories|reminder|task|timer|session|note|event|alarm|entry|fact|preference)s?\s+(?:has|have)?\s*(?:been\s+)?(?:set|created|added|scheduled|started|stopped|paused|resumed|saved|deleted|removed|updated|cancell?ed|completed)\b/
      .source,
    // Bare confirmations
    /^(?:done|all set|ok(?:ay)?,?\s+done|got it,?\s+done)\b/.source,
  ].join('|'),
  'i'
);

function looksLikeCompletionClaim(text: string): boolean {
  return COMPLETION_CLAIM_PATTERN.test(text.trim());
}

/**
 * JSON with object keys sorted, so two logically identical tool calls always
 * produce the same string regardless of key order in the model's output.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Identity of a completed tool call: name + arguments + result. */
function toolCallSignature(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown
): string {
  return stableStringify({ toolName, args, result });
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopOutput> {
  const startTime = Date.now();
  const steps: AgentStep[] = [];
  let totalTokens = 0;

  // The prompt is split into a stable half and a volatile half so that prefix
  // caching survives from turn to turn — see buildSystemPrompt/buildContextPreamble.
  const systemPrompt = buildSystemPrompt(input);
  const contextPreamble = buildContextPreamble(input);
  const contextWindowSize = input.contextWindowSize ?? 4096;

  // Trim history to fit within model's context window before building messages
  const hasTools = input.availableTools.length > 0;
  const trimmedHistory = fitToContextWindow({
    // Both prompt halves are reserved, non-negotiable content for budgeting.
    systemPrompt: `${systemPrompt}\n${contextPreamble}`,
    conversationHistory: input.conversationHistory,
    userMessage: input.userMessage,
    contextWindowSize,
    ...(hasTools ? { tools: input.availableTools } : {}),
  });

  // Message order matters for prefix caching:
  //   [stable system prompt][tool schemas][history…][volatile context][user message]
  // Everything up to and including history is byte-identical to the previous
  // turn, so the backend can reuse its cached prefix.
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
    { role: 'system', content: contextPreamble },
    { role: 'user', content: input.userMessage },
  ];

  const tools = input.availableTools.length > 0 ? input.availableTools : undefined;

  let stepCount = 0;
  let lastToolSignature: string | null = null;
  let claimRetriesUsed = 0;
  let stoppedForRepeat = false;

  while (stepCount < input.config.maxSteps) {
    stepCount++;
    const stepStart = Date.now();

    // ─── REASON: Send to LLM ─────────────────────────────────────────────────
    const llmResponse = await input.llmProvider.chat(tools ? { messages, tools } : { messages });

    if (llmResponse.usage) {
      totalTokens += llmResponse.usage.promptTokens + llmResponse.usage.completionTokens;
    }

    // ─── Case 1: Text response — agent is done ────────────────────────────────
    if (llmResponse.type === 'text') {
      const text = llmResponse.text ?? '';

      // ─── Claim-vs-reality guard ───────────────────────────────────────────
      // The model sometimes answers "Reminder set." having called nothing at
      // all. Retry once, telling it plainly that nothing happened, before we
      // hand a false confirmation to the user.
      const calledAnyTool = steps.some((s) => s.type === 'tool_call');
      if (
        tools !== undefined &&
        !calledAnyTool &&
        claimRetriesUsed < MAX_CLAIM_RETRIES &&
        looksLikeCompletionClaim(text)
      ) {
        claimRetriesUsed++;
        steps.push({
          type: 'error',
          content:
            'Model claimed an action was completed without calling any tool — retrying once with a correction.',
          timestamp: stepStart,
          durationMs: Date.now() - stepStart,
        });
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: claimCorrectionNudge(input.userMessage) });
        continue;
      }

      steps.push({
        type: 'reasoning',
        content: text,
        timestamp: stepStart,
        durationMs: Date.now() - stepStart,
      });
      return {
        response: text,
        trace: buildTrace(input, steps, text, startTime, totalTokens),
      };
    }

    // ─── Case 2: Tool call ────────────────────────────────────────────────────
    if (llmResponse.type === 'tool_call') {
      const toolName = llmResponse.toolName ?? '';
      const toolArgs = llmResponse.toolArgs ?? {};
      const toolCallId = llmResponse.toolCallId ?? toolName;

      // Determine effective action type (user overrides take precedence)
      const tool = input.availableTools.find((t) => t.name === toolName);
      const effectiveActionType =
        input.config.actionOverrides[toolName] ?? tool?.actionType ?? 'direct';

      steps.push({
        type: 'tool_call',
        content: toolName,
        toolName,
        toolArgs,
        timestamp: stepStart,
        durationMs: Date.now() - stepStart,
      });

      // ─── Workflow: pause and request user approval ────────────────────────
      if (effectiveActionType === 'workflow') {
        const preview = generatePreview(toolName, toolArgs);
        return {
          response: preview,
          trace: buildTrace(input, steps, null, startTime, totalTokens),
          pendingApproval: { toolName, args: toolArgs, preview },
        };
      }

      // ─── ACT: Execute the tool ────────────────────────────────────────────
      const execStart = Date.now();
      let toolResult: unknown;
      try {
        toolResult = await input.executeTool(toolName, toolArgs);
      } catch (err) {
        toolResult = {
          error: true,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      steps.push({
        type: 'tool_result',
        content: toolName,
        toolName,
        toolResult,
        timestamp: execStart,
        durationMs: Date.now() - execStart,
      });

      // ─── Repeat guard ─────────────────────────────────────────────────────
      // Same tool, same arguments, same result twice in a row means the model
      // is stuck. Stop now instead of burning the rest of the step budget.
      const signature = toolCallSignature(toolName, toolArgs, toolResult);
      if (signature === lastToolSignature) {
        steps.push({
          type: 'error',
          content: `Repeated the identical call to "${toolName}" with the same arguments and the same result — stopping to avoid a loop.`,
          toolName,
          timestamp: Date.now(),
          durationMs: 0,
        });
        stoppedForRepeat = true;
        break;
      }
      lastToolSignature = signature;

      // ─── OBSERVE: Feed result back, continue loop ─────────────────────────
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: toolCallId, name: toolName, arguments: toolArgs }],
      });
      messages.push({
        role: 'tool',
        content: JSON.stringify(toolResult),
        name: toolName,
      });
    }
  }

  // ─── Stopped early: repeat guard tripped, or max steps reached ────────────
  const completedTools = [
    ...new Set(
      steps
        .filter((s) => s.type === 'tool_result' && s.toolName)
        .map((s) => s.toolName as string)
    ),
  ];

  let stopResponse: string;
  if (stoppedForRepeat) {
    stopResponse =
      completedTools.length > 0
        ? `I stopped because I was repeating the same action. I completed: ${completedTools.join(', ')}.`
        : 'I stopped because I was repeating the same action without making progress.';
  } else {
    stopResponse =
      completedTools.length > 0
        ? `I've reached my thinking limit. I completed: ${completedTools.join(', ')}.`
        : "I've reached my thinking limit without completing any actions.";
  }

  return {
    response: stopResponse,
    trace: buildTrace(input, steps, stopResponse, startTime, totalTokens),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The stable half of the prompt — byte-identical on every turn.
 *
 * Prefix caching (llama.cpp and most hosted APIs) only reuses a prompt up to
 * the first byte that changed. The tool schemas are rendered immediately after
 * this message and cost far more tokens than the prompt itself, so anything
 * that varies per turn must stay out of here — put it in buildContextPreamble().
 */
export function buildSystemPrompt(input: AgentLoopInput): string {
  const lines: string[] = [
    'You are TARDIS, a helpful AI assistant. You have access to plugin tools to help respond to the user.',
    'Use the provided tools when they are relevant to the user request.',
    'When you have enough information, respond directly to the user.',
    'Never say an action is done unless you actually called the tool that does it. If you did not call a tool, nothing happened.',
    "When tools require a date, always pass it as YYYY-MM-DD format using today's actual date.",
  ];

  // ─── Behavioural instructions FIRST, response style LAST ──────────────────
  //
  // Ordering here is load-bearing, not cosmetic. With the response-style rules
  // placed before the memory instructions, gemma-4-E2B saved a fact in only
  // 2/15 trials — it answered "Memory saved." without ever calling the tool.
  // Moving the style block after the memory block, and scoping it explicitly to
  // wording, took that to 15/15 with 0/10 spurious saves and no change in reply
  // length. The single worst offender was a line reading "Match the user's
  // energy. Short command = short confirmation", which on its own produced 0/9:
  // the model read a short user statement as deserving a short confirmation
  // rather than an action. That line is gone.
  //
  // Rule of thumb: anything telling the model WHAT TO DO must come after
  // anything telling it HOW TO WRITE.

  const hasMemoryTools = input.availableTools.some((t) => t.name === 'memory.save');
  if (hasMemoryTools) {
    lines.push('\n## Memory');
    lines.push('- If the user shares a personal fact, preference, or important context (names, emails, schedules, preferences), save it using memory.save with a descriptive snake_case key.');
    lines.push('- Do not announce that you are saving a memory. Just do it silently alongside your response.');
    lines.push('- Use memory.recall if the user asks about something you might have stored previously.');
    lines.push('- Use memory.forget if the user explicitly asks you to forget something.');
  }

  lines.push('\n## Response style');
  lines.push(
    'These rules govern how you word your reply. They never decide whether to call a tool — if a tool is needed, call it first, then apply these to the wording.'
  );
  lines.push('- Be concise. Confirm the action, share only relevant info, stop.');
  lines.push('- Do NOT offer follow-up options or menus after every response.');
  lines.push('- Do NOT use emojis unless the user uses them first.');
  lines.push('- Never show internal IDs, raw timestamps, or technical details. Format all dates and times in human-readable form.');
  lines.push('- You are a capable assistant, not a customer service bot. No cheerfulness, no upselling, no "Would you like to..." after every action.');

  return lines.join('\n');
}

/**
 * The volatile half of the prompt — current time, active plugins, recalled
 * memories. Emitted as its own message placed after the conversation history
 * and directly before the user's message, so it never invalidates the cached
 * prefix. Time is minute-precision on purpose: a seconds field would change the
 * prompt on every single request for no practical benefit.
 */
export function buildContextPreamble(input: AgentLoopInput): string {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const timeStr = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const lines: string[] = [
    `Today's local date is ${formatLocalDate(now)}. Current local time is ${timeStr} (${timeZone}).`,
    `Tomorrow is ${formatLocalDate(tomorrow)}.`,
  ];

  if (input.selectedPlugins.length > 0) {
    lines.push(`\nActive plugins: ${input.selectedPlugins.join(', ')}`);
  }

  if (input.memories.length > 0) {
    lines.push('\nRelevant context from memory:');
    for (const mem of input.memories) {
      lines.push(`- ${mem.key}: ${mem.value}`);
    }
  }

  return lines.join('\n');
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generatePreview(toolName: string, args: Record<string, unknown>): string {
  const argList = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return argList ? `About to run \`${toolName}\` with: ${argList}` : `About to run \`${toolName}\``;
}

function buildTrace(
  input: AgentLoopInput,
  steps: AgentStep[],
  finalResponse: string | null,
  startTime: number,
  totalTokens: number
): ThoughtTrace {
  const trace: ThoughtTrace = {
    id: randomUUID(),
    userMessage: input.userMessage,
    steps,
    finalResponse,
    totalDurationMs: Date.now() - startTime,
    modelUsed: input.llmProvider.name,
    timestamp: startTime,
  };
  if (totalTokens > 0) {
    trace.tokenCount = totalTokens;
  }
  return trace;
}
