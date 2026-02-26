import { randomUUID } from 'crypto';
import type {
  AgentConfig,
  AgentStep,
  MemoryEntry,
  ThoughtTrace,
  ToolDefinition,
} from '@tardis/shared';
import type { LLMMessage, LLMProvider } from '../llm/provider.js';

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

// ─── Agent loop ───────────────────────────────────────────────────────────────

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopOutput> {
  const startTime = Date.now();
  const steps: AgentStep[] = [];
  let totalTokens = 0;

  // Build the initial message list: system prompt + history + user message
  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(input) },
    ...input.conversationHistory,
    { role: 'user', content: input.userMessage },
  ];

  const tools = input.availableTools.length > 0 ? input.availableTools : undefined;

  let stepCount = 0;
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

  // ─── Max steps reached ────────────────────────────────────────────────────
  const completedTools = steps
    .filter((s) => s.type === 'tool_result' && s.toolName)
    .map((s) => s.toolName as string);

  const maxStepsResponse =
    completedTools.length > 0
      ? `I've reached my thinking limit. I completed: ${completedTools.join(', ')}.`
      : "I've reached my thinking limit without completing any actions.";

  return {
    response: maxStepsResponse,
    trace: buildTrace(input, steps, maxStepsResponse, startTime, totalTokens),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSystemPrompt(input: AgentLoopInput): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]!; // YYYY-MM-DD
  const timeStr = now.toUTCString(); // human-readable

  const lines: string[] = [
    'You are TARDIS, a helpful AI assistant. You have access to plugin tools to help respond to the user.',
    'Use the provided tools when they are relevant to the user request.',
    'When you have enough information, respond directly to the user.',
    `\nToday's date is ${dateStr} (${timeStr}).`,
    'When tools require a date, always pass it as YYYY-MM-DD format using today\'s actual date.',
    `Tomorrow is ${new Date(now.getTime() + 86400000).toISOString().split('T')[0]!}.`,
    '\n## Response style',
    '- Be concise. Confirm the action, share only relevant info, stop.',
    '- Do NOT offer follow-up options or menus after every response.',
    '- Do NOT use emojis unless the user uses them first.',
    '- Never show internal IDs, raw timestamps, or technical details. Format all dates and times in human-readable form.',
    '- Match the user\'s energy. Short command = short confirmation. Detailed question = detailed answer.',
    '- You are a capable assistant, not a customer service bot. No cheerfulness, no upselling, no "Would you like to..." after every action.',
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

  // Memory tool instructions (only if memory tools are available)
  const hasMemoryTools = input.availableTools.some((t) => t.name === 'memory.save');
  if (hasMemoryTools) {
    lines.push('\n## Memory');
    lines.push('- If the user shares a personal fact, preference, or important context (names, emails, schedules, preferences), save it using memory.save with a descriptive snake_case key.');
    lines.push('- Do not announce that you are saving a memory. Just do it silently alongside your response.');
    lines.push('- Use memory.recall if the user asks about something you might have stored previously.');
    lines.push('- Use memory.forget if the user explicitly asks you to forget something.');
  }

  return lines.join('\n');
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
