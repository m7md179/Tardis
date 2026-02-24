import type { ToolDefinition } from '@tardis/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntentPattern {
  /** Regex applied to the user message (case-insensitive). */
  pattern: RegExp;
  /** Fully-qualified tool name to call, e.g. "time-tracker.start". */
  toolName: string;
  /** Extract tool arguments from the regex match object. */
  extractArgs: (match: RegExpMatchArray) => Record<string, unknown>;
  /** Human-readable label for logging (e.g. "start timer"). */
  label: string;
}

export interface IntentDetectionResult {
  toolName: string;
  args: Record<string, unknown>;
  /** Which pattern label matched — useful for debugging. */
  matchedPattern: string;
}

// ─── Built-in pattern registry ────────────────────────────────────────────────

const patternRegistry: IntentPattern[] = [
  // ─── Time tracker ────────────────────────────────────────────────────────
  {
    label: 'start timer',
    pattern: /(?:start|begin|track)\s+(?:working\s+on\s+|timer\s+(?:for\s+)?|tracking\s+)(.+)/i,
    toolName: 'time-tracker.start',
    extractArgs: (match) => ({ taskName: (match[1] ?? '').trim() }),
  },
  {
    label: 'stop timer',
    pattern: /(?:stop|end|finish|complete)\s+(?:the\s+)?timer/i,
    toolName: 'time-tracker.stop',
    extractArgs: () => ({}),
  },
  {
    label: 'pause timer',
    pattern: /(?:pause|hold|suspend)\s+(?:the\s+)?timer/i,
    toolName: 'time-tracker.pause',
    extractArgs: () => ({}),
  },
  {
    label: 'resume timer',
    pattern: /(?:resume|continue|restart)\s+(?:the\s+)?timer/i,
    toolName: 'time-tracker.resume',
    extractArgs: () => ({}),
  },
  {
    label: 'timer status',
    pattern: /(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:current\s+)?timer|show\s+timer\s+status|check\s+timer)/i,
    toolName: 'time-tracker.status',
    extractArgs: () => ({}),
  },

  // ─── Notes ───────────────────────────────────────────────────────────────
  {
    label: 'save note',
    pattern: /(?:save|store|note|write\s+down|remember)\s+(?:that\s+|this:\s*|note:\s*)?(.+)/i,
    toolName: 'notes.save',
    extractArgs: (match) => ({ content: (match[1] ?? '').trim() }),
  },

  // ─── Reminders ───────────────────────────────────────────────────────────
  {
    label: 'set reminder',
    pattern: /(?:remind\s+me\s+(?:to\s+)?|set\s+(?:a\s+)?reminder\s+(?:for\s+)?)(.+)/i,
    toolName: 'reminders.set',
    extractArgs: (match) => ({ message: (match[1] ?? '').trim() }),
  },

  // ─── Todoist ─────────────────────────────────────────────────────────────
  {
    label: 'add task',
    pattern: /(?:add\s+(?:a\s+)?task(?:\s+to\s+(?:todoist|my\s+list))?:?\s*)(.+)/i,
    toolName: 'todoist.add-task',
    extractArgs: (match) => ({ content: (match[1] ?? '').trim() }),
  },
  {
    label: 'list tasks',
    pattern: /(?:list|show|get)\s+(?:my\s+)?tasks/i,
    toolName: 'todoist.list-tasks',
    extractArgs: () => ({}),
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect intent from a user message when the LLM failed to call a tool.
 *
 * Only returns a result if:
 *   1. A pattern matches the user message
 *   2. The matched tool is in the availableTools list (i.e. the plugin is loaded)
 *
 * Returns null if no intent is detected or the tool isn't available.
 */
export function detectIntent(
  userMessage: string,
  availableTools: ToolDefinition[]
): IntentDetectionResult | null {
  const availableToolNames = new Set(availableTools.map((t) => t.name));

  for (const intent of patternRegistry) {
    // Skip if the tool isn't available
    if (!availableToolNames.has(intent.toolName)) continue;

    const match = userMessage.match(intent.pattern);
    if (!match) continue;

    const args = intent.extractArgs(match);

    // Skip if extracted args are empty strings for required-looking fields
    const hasEmptyArg = Object.values(args).some(
      (v) => typeof v === 'string' && v.trim() === ''
    );
    if (hasEmptyArg) continue;

    return {
      toolName: intent.toolName,
      args,
      matchedPattern: intent.label,
    };
  }

  return null;
}

/**
 * Register a custom intent pattern.
 * Plugins can call this during onActivate() to add their own intent patterns.
 * Custom patterns are checked AFTER built-in patterns.
 */
export function registerIntentPattern(pattern: IntentPattern): void {
  patternRegistry.push(pattern);
}

/**
 * Remove all registered patterns matching the given tool name.
 * Useful for cleanup when a plugin is deactivated.
 */
export function unregisterIntentPatterns(toolName: string): void {
  for (let i = patternRegistry.length - 1; i >= 0; i--) {
    if (patternRegistry[i]?.toolName === toolName) {
      patternRegistry.splice(i, 1);
    }
  }
}

/**
 * Get a read-only snapshot of all registered patterns (for testing/debugging).
 */
export function getRegisteredPatterns(): readonly IntentPattern[] {
  return patternRegistry;
}
