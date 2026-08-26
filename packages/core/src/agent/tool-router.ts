import type { PluginManager } from '../plugins/plugin-manager.js';

// ─── Result type ──────────────────────────────────────────────────────────────

export type ToolResultCode = 'TOOL_NOT_FOUND' | 'VALIDATION_ERROR' | 'EXECUTION_ERROR';

export type ToolResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code: ToolResultCode };

// ─── ToolRouter ───────────────────────────────────────────────────────────────

/**
 * Bridges the agent loop to the plugin system.
 *
 * Responsibilities:
 * 1. Finds which plugin owns a given tool name
 * 2. Validates the call arguments against the tool's JSON Schema (required fields)
 * 3. Dispatches to the plugin's executeTool() method
 * 4. Wraps all errors in a structured ToolResult — never throws
 */
export class ToolRouter {
  constructor(private readonly pluginManager: PluginManager) {}

  /**
   * Execute a tool by fully-qualified name (e.g. "time-tracker.start").
   * Always returns a ToolResult — never throws.
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    // ─── 1. Find the tool definition ────────────────────────────────────────
    const pluginName = toolName.split('.')[0];
    if (!pluginName) {
      return {
        success: false,
        error: `Invalid tool name "${toolName}" — expected "plugin-name.tool-name" format`,
        code: 'TOOL_NOT_FOUND',
      };
    }

    const plugin = this.pluginManager.getPlugin(pluginName);
    if (!plugin) {
      return {
        success: false,
        error: `Plugin "${pluginName}" is not loaded`,
        code: 'TOOL_NOT_FOUND',
      };
    }

    // Look up against skills, NOT the derived tools array. `tools` contains only
    // the AI-invocable subset, so validating against it made every
    // `aiInvocable: false` skill unreachable — which is the exact opposite of
    // what that flag is for: reachable directly, just never offered to the LLM.
    const skill = plugin.manifest.skills.find((sk) => sk.id === toolName);
    if (!skill) {
      return {
        success: false,
        error: `Tool "${toolName}" not found in plugin "${pluginName}"`,
        code: 'TOOL_NOT_FOUND',
      };
    }

    // ─── 2. Validate required arguments ─────────────────────────────────────
    const validationError = validateArgs(toolName, skill.parameters, args);
    if (validationError) {
      return { success: false, error: validationError, code: 'VALIDATION_ERROR' };
    }

    // ─── 3. Execute the tool ─────────────────────────────────────────────────
    try {
      const data = await this.pluginManager.executeTool(toolName, args);
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Tool "${toolName}" failed: ${message}`,
        code: 'EXECUTION_ERROR',
      };
    }
  }

  /**
   * Returns a function compatible with AgentLoopInput.executeTool.
   * Unwraps the ToolResult: returns data on success, throws on failure.
   * The agent loop catches these throws and records them as error steps.
   */
  asExecutor(): (toolName: string, args: Record<string, unknown>) => Promise<unknown> {
    return async (toolName: string, args: Record<string, unknown>) => {
      const result = await this.execute(toolName, args);
      if (!result.success) {
        throw new Error(`[${result.code}] ${result.error}`);
      }
      return result.data;
    };
  }
}

// ─── Argument validation ──────────────────────────────────────────────────────

/**
 * Checks that all JSON Schema `required` fields are present in args.
 * Returns an error message string, or null if valid.
 * Type checking is intentionally not included for MVP.
 */
function validateArgs(
  toolName: string,
  parameters: Record<string, unknown>,
  args: Record<string, unknown>
): string | null {
  const required = parameters['required'];
  if (!Array.isArray(required)) return null;

  const missing = required.filter(
    (field): field is string => typeof field === 'string' && !(field in args)
  );

  if (missing.length > 0) {
    return `Tool "${toolName}" missing required argument(s): ${missing.join(', ')}`;
  }

  return null;
}
