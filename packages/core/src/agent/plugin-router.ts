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
export async function selectPlugins(
  userMessage: string,
  allPlugins: PluginManifest[],
  llmProvider: LLMProvider
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

  const selectionPrompt =
    `Given the user's message, pick which plugins are needed to handle it.\n` +
    `Return ONLY a JSON array of plugin names. If no plugins are needed (e.g., casual conversation), return [].\n\n` +
    `Available plugins:\n${pluginSummaries}\n\n` +
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
 * Parse the LLM's JSON response into an array of plugin name strings.
 * Returns null if the response is not a valid JSON array.
 */
function parsePluginNames(raw: string, _allPlugins: PluginManifest[]): string[] | null {
  // Strip markdown code fences if the LLM wrapped the response
  const cleaned = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((item) => typeof item === 'string')) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}
