import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { runAgentLoop, selectPluginSkills } from '@tardis/core';
import type { PendingApproval, ToolRouter, LLMProvider, LLMMessage, MemoryRetriever } from '@tardis/core';
import type { MemoryExecutor } from '@tardis/core';
import type { AgentConfig, PluginManifest, ToolDefinition } from '@tardis/shared';

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
  /** Memory retriever for injecting relevant context. */
  memoryRetriever?: MemoryRetriever;
  /** Memory tools (save/recall/forget) definitions. */
  memoryTools?: ToolDefinition[];
  /** Executor for memory.* tool calls. */
  memoryExecutor?: MemoryExecutor;
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

  // ─── OAuth code exchange (bypass LLM — pattern match directly) ─────────
  const oauthMatch = text.match(/(?:my\s+)?google\s+calendar\s+(?:code\s+is\s+|code:\s*)(4\/[^\s]+)/i)
    ?? text.match(/^(4\/1[A-Za-z0-9_\-]+)$/); // bare code pasted alone
  if (oauthMatch) {
    const code = oauthMatch[1]!;
    const result = await deps.toolRouter.execute('google-calendar.exchange-code', { code });
    if (result.success) {
      return { text: '✅ Google Calendar connected! You can now ask about your events.' };
    }
    return { text: `Failed to connect Google Calendar: ${result.error}` };
  }

  // ─── Pending workflow approval ─────────────────────────────────────────
  const pending = state.pendingApprovals.get(chatId);
  if (pending) {
    state.pendingApprovals.delete(chatId);

    if (isApprovalText(text)) {
      try {
        const result = await deps.toolRouter.execute(pending.toolName, pending.args);
        if (result.success) {
          const data = result.data as Record<string, unknown> | null;
          const msg = typeof data?.['message'] === 'string'
            ? data['message']
            : JSON.stringify(data, null, 2);
          return { text: msg };
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

    // Retrieve relevant memories for context injection
    const memories = deps.memoryRetriever
      ? await deps.memoryRetriever.getRelevant(text)
      : [];

    // Combine plugin tools with always-available memory tools
    const allTools = [...tools, ...(deps.memoryTools ?? [])];

    // Build executor that routes memory.* to memoryExecutor, rest to toolRouter
    const pluginExecutor = deps.toolRouter.asExecutor();
    const combinedExecutor = async (toolName: string, args: Record<string, unknown>) => {
      if (toolName.startsWith('memory.') && deps.memoryExecutor) {
        return deps.memoryExecutor.execute(toolName, args);
      }
      return pluginExecutor(toolName, args);
    };

    const history = state.conversationHistory.get(chatId) ?? [];

    const result = await runAgentLoop({
      userMessage: text,
      conversationHistory: history,
      memories,
      availableTools: allTools,
      selectedPlugins,
      config: deps.agentConfig,
      llmProvider: deps.llmProvider,
      executeTool: combinedExecutor,
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
    `Chat ID: \`${chatId}\``,
    `History: ${historyLen} exchange${historyLen !== 1 ? 's' : ''}`,
  ];
  if (hasPending) lines.push('⏳ Waiting for your approval');
  return { text: lines.join('\n') };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip markdown bold/italic markers that wrap URLs so Telegram's
 * auto-link detection doesn't include the markers in the clickable URL.
 * e.g. **https://example.com** → https://example.com
 */
function cleanUrls(text: string): string {
  return text
    .replace(/\*\*(https?:\/\/[^\s*]+)\*\*/g, '$1')
    .replace(/__(https?:\/\/[^\s_]+)__/g, '$1')
    .replace(/\*(https?:\/\/[^\s*]+)\*/g, '$1');
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
  private readonly token: string;
  private polling = false;

  constructor(token: string, deps: BotDeps) {
    this.state = createBotState();
    this.deps = deps;
    this.token = token;
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
      await ctx.reply(cleanUrls(response.text));
    });
  }

  /**
   * Send a proactive notification to all allowed chat IDs.
   * Falls back to the first allowed chat ID if multiple are configured.
   */
  async notify(text: string): Promise<void> {
    const base = `https://api.telegram.org/bot${this.token}`;
    const chatIds =
      this.deps.allowedChatIds.size > 0
        ? Array.from(this.deps.allowedChatIds)
        : [];

    if (chatIds.length === 0) {
      console.warn('[telegram] notify(): no allowed chat IDs configured, cannot send notification');
      return;
    }

    // Send to first chat ID (single-user setup)
    const chatId = chatIds[0]!;
    await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  }

  async start(): Promise<void> {
    // Use raw fetch for all startup calls — Telegraf's HTTP client shares a
    // keep-alive connection that can cause Telegram to see concurrent sessions.
    const base = `https://api.telegram.org/bot${this.token}`;
    await fetch(`${base}/deleteWebhook?drop_pending_updates=true`);
    // Short pause so Telegram can fully commit the session after deleteWebhook.
    await new Promise((r) => setTimeout(r, 500));
    this.polling = true;
    this.runPollingLoop().catch((err) => {
      console.error('[telegram] Polling loop crashed:', err instanceof Error ? err.message : String(err));
    });
  }

  private async rawGetUpdates(timeoutS: number, offset: number): Promise<unknown[]> {
    const url =
      `https://api.telegram.org/bot${this.token}/getUpdates` +
      `?timeout=${timeoutS}&limit=100&offset=${offset}` +
      `&allowed_updates=message,callback_query`;
    const res = await fetch(url);
    const body = (await res.json()) as { ok: boolean; result?: unknown[]; description?: string; error_code?: number };
    if (!body.ok) {
      const err = new Error(body.description ?? 'Telegram API error') as Error & { error_code: number | undefined };
      err.error_code = body.error_code;
      throw err;
    }
    return body.result ?? [];
  }

  private async runPollingLoop(): Promise<void> {
    const TIMEOUT_S = 10;
    let offset = 0;
    let consecutive409 = 0;

    while (this.polling) {
      try {
        const updates = await this.rawGetUpdates(TIMEOUT_S, offset);
        consecutive409 = 0;
        for (const update of updates) {
          const u = update as Parameters<typeof this.bot.handleUpdate>[0];
          offset = (u as { update_id: number }).update_id + 1;
          this.bot.handleUpdate(u).catch((err) => {
            console.error('[telegram] handleUpdate error:', err instanceof Error ? err.message : String(err));
          });
        }
      } catch (err) {
        if (!this.polling) break;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('409') || (err as { error_code?: number }).error_code === 409) {
          consecutive409++;
          const wait = Math.min(5_000 * consecutive409, 30_000);
          console.warn(`[telegram] 409 Conflict (×${consecutive409}) — waiting ${wait / 1000}s…`);
          await new Promise((r) => setTimeout(r, wait));
        } else {
          console.error('[telegram] getUpdates error:', msg);
          await new Promise((r) => setTimeout(r, 3_000));
        }
      }
    }
  }

  stop(_reason?: string): void {
    this.polling = false;
  }
}
