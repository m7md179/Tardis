export type PluginTier = 1 | 2 | 3;

export type ActionType = 'direct' | 'workflow';

export interface ToolDefinition {
  name: string;                    // unique: "pluginName.toolName"
  description: string;             // shown to the LLM (only after plugin is selected)
  parameters: Record<string, unknown>; // JSON Schema
  actionType: ActionType;          // direct = auto-execute, workflow = needs approval
}

export interface ProactiveTrigger {
  name: string;
  description: string;             // shown in Web UI settings
  defaultSchedule: string;         // cron expression
  defaultEnabled: boolean;
  handler: string;                 // function name to invoke
}

export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  tier: PluginTier;
  main: string;                    // entrypoint file
  skillSummary: string;            // 1-3 sentence summary for skill-based selection
  permissions: string[];
  tools: ToolDefinition[];
  proactive?: ProactiveTrigger[];
  llm?: {
    provider: string;
    model: string;
    temperature?: number;
    systemPrompt?: string;
  };
  config?: Record<string, unknown>; // default config values
  dependencies?: string[];          // other plugins this one can call
}

export interface PluginInstance {
  manifest: PluginManifest;
  onActivate: (api: unknown) => Promise<void>;
  onDeactivate?: () => Promise<void>;
  executeTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}
