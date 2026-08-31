import type { PluginManifest, ToolDefinition } from '@tardis/shared';
import type { LLMProvider } from '../llm/provider.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PluginSelectionResult {
  /** Plugin names chosen by the router. Empty means chatbot mode (no tools). */
  selectedPlugins: string[];
  /** Full tool schemas for the selected plugins, ready to pass to the agent loop. */
  tools: ToolDefinition[];
  /** How long the selection LLM call took, in milliseconds. For thought traces. */
  selectionDurationMs: number;
  /** How selection was performed — for debugging and tracing. */
  method: 'llm' | 'explicit' | 'fallback' | 'empty';
}

/** Keeps the routing prompt short; the router only needs the gist. */
function truncate(text: string, max = 200): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : t.slice(0, max) + '…';
}

// ─── Plugin Router ────────────────────────────────────────────────────────────

/**
 * Selects the relevant plugins for a user message before the agent loop runs.
 *
 * Named PluginRouter, not SkillRouter: it chooses among *plugins* using each
 * plugin's one-line `summary`. A Skill is a single capability inside a plugin
 * (see SKILLS.md) — a different concept that used to share this name.
 *
 * Solves the "20 plugin problem": instead of dumping all tool schemas into
 * every request (expensive in tokens, confusing for small models), each plugin
 * provides a short `summary`. The router sends ONLY those summaries to the
 * LLM and asks it to pick the relevant plugins. The full tool schemas for only
 * the selected plugins are then loaded for the agent loop.
 *
 * Selection strategy (in priority order):
 *   1. Explicit mention — if the message contains a plugin name, bypass LLM
 *   2. LLM selection    — ask the LLM to pick from the skill summary list
 *   3. Fallback         — if LLM returns malformed JSON, load all plugins
 *   4. Empty            — if no plugins are loaded, return empty (chatbot mode)
 */
/**
 * One line of "what just happened", for routing a reply that means nothing on
 * its own.
 *
 * Live: TARDIS asked which workspace a draft belonged to, the user answered
 * "RD-TEA", and the router — seeing only those seven characters — sent it to
 * the notes plugin. A follow-up is the most common shape in a conversation and
 * the router was the one component with no memory of one.
 */
export interface RoutingContext {
  /** What the user said immediately before this message. */
  previousUserMessage?: string | undefined;
  /** Plugins the previous turn actually used. */
  previousPlugins?: string[] | undefined;
}

export async function selectPlugins(
  userMessage: string,
  allPlugins: PluginManifest[],
  llmProvider: LLMProvider,
  context: RoutingContext = {}
): Promise<PluginSelectionResult> {
  const start = Date.now();

  // ─── Edge case: no plugins loaded ────────────────────────────────────────
  if (allPlugins.length === 0) {
    return { selectedPlugins: [], tools: [], selectionDurationMs: 0, method: 'empty' };
  }

  // ─── Strategy 1: Explicit plugin name in message ──────────────────────────
  const explicit = findExplicitPlugin(userMessage, allPlugins);
  if (explicit) {
    const tools = explicit.tools;
    return {
      selectedPlugins: [explicit.name],
      tools,
      selectionDurationMs: Date.now() - start,
      method: 'explicit',
    };
  }

  // ─── Strategy 2: LLM-based selection ─────────────────────────────────────
  const pluginSummaries = allPlugins.map((p) => `- ${p.name}: "${p.summary}"`).join('\n');

  // Only the previous exchange, and only when there is one. A short answer
  // like "RD-TEA" or "yes" carries its meaning entirely in what came before.
  const priorLines: string[] = [];
  if (context.previousUserMessage) {
    priorLines.push(`Earlier the user said: "${truncate(context.previousUserMessage)}"`);
  }
  if (context.previousPlugins && context.previousPlugins.length > 0) {
    priorLines.push(
      `That was handled by: ${context.previousPlugins.join(', ')}. ` +
        `If this message continues it, pick the same plugin.`
    );
  }
  const prior = priorLines.length > 0 ? `${priorLines.join('\n')}\n\n` : '';

  const selectionPrompt =
    `Given the user's message, pick which plugins are needed to handle it.\n` +
    `Return ONLY a JSON array of plugin names. If no plugins are needed (e.g., casual conversation), return [].\n\n` +
    `Available plugins:\n${pluginSummaries}\n\n` +
    prior +
    `User message: "${userMessage}"`;

  let rawResponse: string;
  try {
    rawResponse = await llmProvider.generate({
      systemPrompt:
        'You are a plugin router. Return only a JSON array of plugin names. No explanation.',
      userPrompt: selectionPrompt,
      temperature: 0,
      maxTokens: 100,
    });
  } catch {
    // LLM call failed — fall back to all plugins
    const allTools = allPlugins.flatMap((p) => p.tools);
    return {
      selectedPlugins: allPlugins.map((p) => p.name),
      tools: allTools,
      selectionDurationMs: Date.now() - start,
      method: 'fallback',
    };
  }

  // ─── Parse LLM response ───────────────────────────────────────────────────
  const selectedNames = parsePluginNames(rawResponse, allPlugins);

  if (selectedNames === null) {
    // Malformed JSON — fall back to all plugins
    const allTools = allPlugins.flatMap((p) => p.tools);
    return {
      selectedPlugins: allPlugins.map((p) => p.name),
      tools: allTools,
      selectionDurationMs: Date.now() - start,
      method: 'fallback',
    };
  }

  // Filter to valid plugin names only (LLM might hallucinate names)
  const validNames = selectedNames.filter((name) => allPlugins.some((p) => p.name === name));
  const tools = allPlugins.filter((p) => validNames.includes(p.name)).flatMap((p) => p.tools);

  return {
    selectedPlugins: validNames,
    tools,
    selectionDurationMs: Date.now() - start,
    method: 'llm',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if the user message explicitly names a plugin.
 * Matches "use <plugin-name>" or just the plugin name appearing verbatim.
 */
function findExplicitPlugin(userMessage: string, plugins: PluginManifest[]): PluginManifest | null {
  const lower = userMessage.toLowerCase();
  // Match "use <name>" pattern or bare plugin name surrounded by word boundaries
  for (const plugin of plugins) {
    const name = plugin.name.toLowerCase();
    if (lower.includes(`use ${name}`) || lower.includes(`using ${name}`)) {
      return plugin;
    }
  }
  return null;
}

/**
 * Parse the LLM's response into plugin names.
 *
 * Strict JSON is tried first, then a name scan. gemma-4-E2B frequently answers
 * `[time-tracker]` — the RIGHT plugin, but unquoted, so JSON.parse throws. That
 * sent the router to its fallback and loaded ALL plugins' schemas: measured at
 * 2 of 3 realistic queries once the plugin count reached eight, costing roughly
 * 3,000 tokens of tool definitions per turn and confusing the model with 37
 * tools when it needed six.
 *
 * Scanning for known names is safe precisely because the valid set is known:
 * anything the model invents simply will not match.
 *
 * Returns null only when nothing recognisable is present, which is the one case
 * that genuinely warrants falling back to everything.
 */
function parsePluginNames(raw: string, allPlugins: PluginManifest[]): string[] | null {
  // Strip markdown code fences if the LLM wrapped the response
  const cleaned = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed as string[];
    }
  } catch {
    // Fall through to the name scan.
  }

  // An explicit empty array means "no plugins needed" and must not be treated
  // as unparseable, or casual conversation would load every tool schema.
  if (/^\[\s*\]$/.test(cleaned)) return [];

  const matched = allPlugins
    .map((p) => p.name)
    .filter((name) => new RegExp(`(^|[^a-z0-9-])${name}([^a-z0-9-]|$)`, 'i').test(cleaned));

  return matched.length > 0 ? matched : null;
}
