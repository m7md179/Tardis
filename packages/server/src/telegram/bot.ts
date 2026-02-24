import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { runAgentLoop, selectPluginSkills } from '@tardis/core';
import type { PendingApproval, ToolRouter, LLMProvider, LLMMessage } from '@tardis/core';
import type { AgentConfig, PluginManifest } from '@tardis/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotDeps {
  /** Returns all loaded plugin manifests (used by skill router). */
  getAllManifests: () => PluginManifest[];
  llmProvider: LLMProvider;
  toolRouter: ToolRouter;
  agentConfig: AgentConfig;
  /**
   * Set of allowed Telegram chat IDs (as strings).
   * Empty set = allow all (useful for single-user setups).
   */
  allowedChatIds: Set<string>;
}

export interface BotState {
  /** Per-chat pending workflow approvals. */
  pendingApprovals: Map<number, PendingApproval>;
  /** Per-chat conversation history (LLM message format). */
  conversationHistory: Map<number, LLMMessage[]>;
}

export interface BotResponse {
  text: string;
}

// ─── State factory ────────────────────────────────────────────────────────────

export function createBotState(): BotState {
  return {
    pendingApprovals: new Map(),
    conversationHistory: new Map(),
  };
}

// ─── Approval detection ───────────────────────────────────────────────────────

const APPROVAL_WORDS = new Set(['yes', 'y', 'yep', 'ok', 'confirm', 'approve']);

export function isApprovalText(text: string): boolean {
  return APPROVAL_WORDS.has(text.trim().toLowerCase());
}

// ─── Core message handler (testable without Telegraf) ─────────────────────────

/**
 * Pure business logic for handling an incoming Telegram text message.
 * Decoupled from Telegraf so it can be unit-tested with no mocks of the
 * bot framework itself.
 */
export async function handleUserMessage(
  chatId: number,
  text: string,
  state: BotState,
  deps: BotDeps
): Promise<BotResponse> {
  // ─── Authorization ──────────────────────────────────────────────────────
  if (deps.allowedChatIds.size > 0 && !deps.allowedChatIds.has(String(chatId))) {
    return { text: 'Unauthorized.' };
  }

  // ─── Pending workflow approval ─────────────────────────────────────────
  const pending = state.pendingApprovals.get(chatId);
  if (pending) {
    state.pendingApprovals.delete(chatId);

    if (isApprovalText(text)) {
      try {
        const result = await deps.toolRouter.execute(pending.toolName, pending.args);
        if (result.success) {
          const formatted = JSON.stringify(result.data, null, 2);
          return { text: `Done.\n\`\`\`\n${formatted}\n\`\`\`` };
        }
        return { text: `Failed: ${result.error}` };
      } catch (err) {
        return { text: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
      }
    }

    return { text: 'Cancelled.' };
  }

  // ─── Normal agent flow ─────────────────────────────────────────────────
  try {
    const allManifests = deps.getAllManifests();
    const { tools, selectedPlugins } = await selectPluginSkills(
      text,
      allManifests,
      deps.llmProvider
    );

    const history = state.conversationHistory.get(chatId) ?? [];

    const result = await runAgentLoop({
      userMessage: text,
      conversationHistory: history,
      memories: [],
      availableTools: tools,
      selectedPlugins,
      config: deps.agentConfig,
      llmProvider: deps.llmProvider,
      executeTool: deps.toolRouter.asExecutor(),
    });

    // Update conversation history, capped at conversationHistoryLength * 2 (message + reply pairs)
    const maxMessages = deps.agentConfig.conversationHistoryLength * 2;
    const updatedHistory: LLMMessage[] = [
      ...history,
      { role: 'user' as const, content: text },
      { role: 'assistant' as const, content: result.response },
    ].slice(-maxMessages);
    state.conversationHistory.set(chatId, updatedHistory);

    if (result.pendingApproval) {
      state.pendingApprovals.set(chatId, result.pendingApproval);
      return { text: `${result.response}\n\nApprove? (yes/no)` };
    }

    return { text: result.response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TelegramBot] Error for chat ${chatId}:`, err);
    return { text: `Something went wrong. Please try again.\n\nError: ${msg}` };
  }
}

// ─── Command handlers (also plain functions — testable without Telegraf) ──────

export function handleNewCommand(chatId: number, state: BotState): BotResponse {
  state.conversationHistory.delete(chatId);
  state.pendingApprovals.delete(chatId);
  return { text: 'Conversation cleared. Start fresh!' };
}

export function handlePluginsCommand(deps: BotDeps): BotResponse {
  const manifests = deps.getAllManifests();
  if (manifests.length === 0) {
    return { text: 'No plugins loaded.' };
  }
  const list = manifests
    .map((m) => `• *${m.displayName}* (${m.name}) — Tier ${m.tier}\n  ${m.skillSummary}`)
    .join('\n\n');
  return { text: `*Loaded plugins:*\n\n${list}` };
}

export function handleStatusCommand(chatId: number, state: BotState): BotResponse {
  const hasPending = state.pendingApprovals.has(chatId);
  const historyLen = (state.conversationHistory.get(chatId)?.length ?? 0) / 2;
  const lines = [
    '*TARDIS Status*',
    `History: ${historyLen} exchange${historyLen !== 1 ? 's' : ''}`,
  ];
  if (hasPending) lines.push('⏳ Waiting for your approval');
  return { text: lines.join('\n') };
}

// ─── Telegraf wrapper ─────────────────────────────────────────────────────────

/**
 * Thin Telegraf wrapper around the testable core logic.
 * All routing goes through the plain handler functions above.
 */
export class TelegramBot {
  readonly bot: Telegraf;
  private readonly state: BotState;
  private readonly deps: BotDeps;

  constructor(token: string, deps: BotDeps) {
    this.state = createBotState();
    this.deps = deps;
    this.bot = new Telegraf(token);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.bot.command('new', async (ctx) => {
      const chatId = ctx.chat?.id ?? 0;
      const { text } = handleNewCommand(chatId, this.state);
      await ctx.reply(text);
    });

    this.bot.command('plugins', async (ctx) => {
      const { text } = handlePluginsCommand(this.deps);
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    this.bot.command('status', async (ctx) => {
      const chatId = ctx.chat?.id ?? 0;
      const { text } = handleStatusCommand(chatId, this.state);
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    this.bot.on(message('text'), async (ctx) => {
      const chatId = ctx.message.chat.id;
      const text = ctx.message.text;
      const response = await handleUserMessage(chatId, text, this.state, this.deps);
      await ctx.reply(response.text);
    });
  }

  async start(): Promise<void> {
    await this.bot.launch();
  }

  stop(reason?: string): void {
    this.bot.stop(reason);
  }
}
