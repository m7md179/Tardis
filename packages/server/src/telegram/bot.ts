import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { runConversationTurn } from '@tardis/core';
import type { PendingApproval, ToolRouter, LLMProvider, LLMMessage, MemoryRetriever, ConversationStore, ThoughtTracer } from '@tardis/core';
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
  /** DB-backed conversation history store (persistent across restarts). */
  conversationStore?: ConversationStore;
  /** Persists thought traces so they show up in /api/traces and the web UI. */
  thoughtTracer?: ThoughtTracer;
  /** Model's max context window in tokens. Passed to agent loop for trimming. */
  contextWindowSize?: number;
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
  deps: BotDeps,
  images?: string[]
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

  // ─── "What can you do" — answered from manifests, not by the model ─────
  // Only when nothing is pending, so it cannot swallow an approval reply.
  if (!state.pendingApprovals.has(chatId) && isCapabilityQuestion(text)) {
    return handleHelpCommand(deps);
  }

  // ─── Pending workflow approval ─────────────────────────────────────────
  const pending = state.pendingApprovals.get(chatId);
  if (pending) {
    state.pendingApprovals.delete(chatId);

    if (isApprovalText(text)) {
      try {
        const result = await deps.toolRouter.execute(pending.toolName, pending.args);
        if (result.success) {
          // Every workflow skill today returns a `message`, but a tool that
          // does not must never dump pretty-printed JSON into the chat. The
          // user already saw the preview and approved it; a plain confirmation
          // is the honest fallback.
          const data = result.data as Record<string, unknown> | null;
          const spoken =
            typeof data?.['message'] === 'string'
              ? data['message']
              : typeof data?.['summary'] === 'string'
                ? data['summary']
                : 'Done.';
          return { text: spoken };
        }
        return { text: `Failed: ${result.error}` };
      } catch (err) {
        return { text: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
      }
    }

    return { text: 'Cancelled.' };
  }

  // ─── Normal agent flow ─────────────────────────────────────────────────
  //
  // Delegates to the shared conversation service so Telegram and the HTTP chat
  // endpoint run the identical pipeline. This logic used to live only here,
  // which is why the agent was unreachable from anything but Telegram.
  try {
    const chatIdStr = String(chatId);
    const result = await runConversationTurn(
      {
        chatId: chatIdStr,
        message: text,
        ...(images?.length ? { images } : {}),
        // Only when there is no DB store; otherwise the service reads it.
        ...(deps.conversationStore
          ? {}
          : { history: state.conversationHistory.get(chatId) ?? [] }),
      },
      {
        llmProvider: deps.llmProvider,
        toolRouter: deps.toolRouter,
        agentConfig: deps.agentConfig,
        getAllManifests: deps.getAllManifests,
        ...(deps.memoryRetriever ? { memoryRetriever: deps.memoryRetriever } : {}),
        ...(deps.memoryTools ? { memoryTools: deps.memoryTools } : {}),
        ...(deps.memoryExecutor ? { memoryExecutor: deps.memoryExecutor } : {}),
        ...(deps.conversationStore ? { conversationStore: deps.conversationStore } : {}),
        ...(deps.thoughtTracer ? { thoughtTracer: deps.thoughtTracer } : {}),
        ...(deps.contextWindowSize !== undefined
          ? { contextWindowSize: deps.contextWindowSize }
          : {}),
      }
    );

    // Without a DB store the service keeps no history, so the bot retains its
    // own in-memory fallback for that case.
    if (!deps.conversationStore) {
      const maxMessages = deps.agentConfig.conversationHistoryLength * 2;
      const updatedHistory: LLMMessage[] = [
        ...(state.conversationHistory.get(chatId) ?? []),
        { role: 'user' as const, content: text },
        { role: 'assistant' as const, content: result.response },
      ].slice(-maxMessages);
      state.conversationHistory.set(chatId, updatedHistory);
    }

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

export async function handleNewCommand(
  chatId: number,
  state: BotState,
  deps?: Pick<BotDeps, 'conversationStore'>
): Promise<BotResponse> {
  state.conversationHistory.delete(chatId);
  state.pendingApprovals.delete(chatId);
  if (deps?.conversationStore) {
    await deps.conversationStore.clearHistory(String(chatId));
  }
  return { text: 'Conversation cleared. Start fresh!' };
}

// ─── Capability questions ─────────────────────────────────────────────────────

/**
 * "What can you do" answered from the manifests, not from the model.
 *
 * Asked live, the model replied "I am a capable assistant. I can help you with
 * tasks…" — true and useless. It has no way to introspect its own 51 callable
 * skills, and inventing a capability list is exactly the kind of confident
 * fiction this project keeps having to guard against. The manifests already
 * know the answer, so read it from there.
 */
// Two shapes, because they need different strictness. A bare "help" is a
// capability question; "help me log lunch" is a request, and an earlier version
// that matched `help\b` hijacked it.
const CAPABILITY_PHRASE =
  /^\s*(?:what\s+(?:can|do)\s+you\s+do|what\s+are\s+you\s+(?:able\s+to\s+do|capable\s+of)|what\s+can\s+you\s+help\s+(?:me\s+)?with)\b/i;
const CAPABILITY_WORD = /^\s*(?:help|commands|capabilities)\s*[?!.]*\s*$/i;

export function isCapabilityQuestion(text: string): boolean {
  const t = text.trim();
  return CAPABILITY_PHRASE.test(t) || CAPABILITY_WORD.test(t);
}

/** Photo sizes as Telegram sends them: ascending, smallest first. */
export interface PhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/**
 * The biggest photo that is still small enough to be worth sending.
 *
 * Telegram offers several resolutions. The largest is often 1280px+, which
 * costs context and decode time on a 4 GB card for no accuracy gain on a plate
 * of food — and the whole image is base64'd into the request, inflating 33%.
 * Cap the long edge and take the best one under it, falling back to the
 * smallest available when every size is over.
 */
const MAX_PHOTO_EDGE = 1024;

export function pickPhotoSize(sizes: PhotoSize[]): PhotoSize | null {
  if (sizes.length === 0) return null;
  const withinCap = sizes.filter((s) => Math.max(s.width, s.height) <= MAX_PHOTO_EDGE);
  if (withinCap.length > 0) {
    return withinCap.reduce((best, s) => (s.width * s.height > best.width * best.height ? s : best));
  }
  return sizes.reduce((smallest, s) => (s.width * s.height < smallest.width * smallest.height ? s : smallest));
}

export function handleHelpCommand(deps: BotDeps): BotResponse {
  const manifests = deps.getAllManifests().filter((m) => m.name !== 'test-plugin');
  const blocks = manifests.map((m) => {
    const count = m.skills?.length ?? 0;
    return `*${m.displayName}* — ${count} skill${count === 1 ? '' : 's'}\n${m.summary.split('.')[0]}.`;
  });

  return {
    text: [
      "*Just talk to me.* You don't need commands — say what happened and I'll record it.",
      '',
      '_Try:_',
      '• I had two eggs and toast for breakfast',
      '• spent 4.5 on coffee',
      '• start a timer for studying',
      '• remind me to call the bank in an hour',
      '• how much have I spent this month?',
      '• remember that I take my coffee black',
      '',
      'Send me a *photo of a meal* and I will log it.',
      '',
      ...blocks,
      '',
      '*Commands:* /new to clear the conversation · /help this message · /plugins details · /status current state',
      '',
      "Anything that deletes something asks you first — reply *yes* to confirm.",
    ].join('\n'),
  };
}

export function handlePluginsCommand(deps: BotDeps): BotResponse {
  const manifests = deps.getAllManifests();
  if (manifests.length === 0) {
    return { text: 'No plugins loaded.' };
  }
  const list = manifests
    .map((m) => `• *${m.displayName}* (${m.name}) — Tier ${m.tier}\n  ${m.summary}`)
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
      const { text } = await handleNewCommand(chatId, this.state, this.deps);
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

    this.bot.command(['help', 'start'], async (ctx) => {
      const { text } = handleHelpCommand(this.deps);
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });

    // A photo is the fastest way to log a meal, and until the app ships it is
    // the only way to reach the vision model at all — the bot previously
    // listened for text only, so photos silently did nothing.
    this.bot.on(message('photo'), async (ctx) => {
      const chatId = ctx.message.chat.id;
      const caption = ctx.message.caption?.trim();
      try {
        const chosen = pickPhotoSize(ctx.message.photo as PhotoSize[]);
        if (!chosen) {
          await ctx.reply("I couldn't read that photo. Try sending it again?");
          return;
        }
        await ctx.sendChatAction('typing');
        const link = await ctx.telegram.getFileLink(chosen.file_id);
        const res = await fetch(link.toString());
        if (!res.ok) throw new Error(`download failed with ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        const dataUri = `data:image/jpeg;base64,${bytes.toString('base64')}`;

        // With no caption the model gets a plain instruction rather than an
        // empty message, which it answers with a description instead of acting.
        const prompt = caption && caption.length > 0 ? caption : 'Log this meal from the photo.';
        const response = await handleUserMessage(chatId, prompt, this.state, this.deps, [dataUri]);
        await ctx.reply(cleanUrls(response.text));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[telegram] photo handling failed for chat ${chatId}:`, err);
        await ctx.reply(`I couldn't process that photo.\n\nError: ${msg}`);
      }
    });

    this.bot.on(message('text'), async (ctx) => {
      const chatId = ctx.message.chat.id;
      const text = ctx.message.text;

      // An unregistered command reaching the agent gets answered as if it were
      // conversation — "/plugin" came back "What would you like me to do?".
      if (text.startsWith('/')) {
        const typed = text.slice(1).split(/[\s@]/)[0] ?? '';
        const known = ['new', 'help', 'start', 'plugins', 'status'];
        const near = known.find((k) => k.startsWith(typed) || typed.startsWith(k));
        await ctx.reply(
          near
            ? `There's no /${typed}. Did you mean /${near}?`
            : `There's no /${typed}. Try /help — or just tell me what you need in plain words.`
        );
        return;
      }

      await ctx.sendChatAction('typing');
      const response = await handleUserMessage(chatId, text, this.state, this.deps);
      await ctx.reply(cleanUrls(response.text));
    });
  }

  /**
   * Publishes the command list so Telegram shows its menu button.
   *
   * Without this the commands exist but are invisible — you have to already
   * know they are there, which is most of why the bot felt bare.
   */
  private async publishCommands(): Promise<void> {
    const commands = [
      { command: 'help', description: 'What TARDIS can do' },
      { command: 'new', description: 'Start a fresh conversation' },
      { command: 'status', description: 'Current state' },
      { command: 'plugins', description: 'Loaded plugins in detail' },
    ];
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
      });
    } catch (err) {
      // Cosmetic only — never stop the bot starting over a menu.
      console.warn('[telegram] could not publish command list:', err instanceof Error ? err.message : err);
    }
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
    await this.publishCommands();
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
