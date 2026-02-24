import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const MANIFEST_TEMPLATE = (name: string, displayName: string) =>
  JSON.stringify(
    {
      name,
      version: '1.0.0',
      displayName,
      description: `${displayName} plugin for TARDIS`,
      tier: 1,
      main: 'index.ts',
      skillSummary: `Describe what ${displayName} does in 1-2 sentences.`,
      permissions: [],
      tools: [
        {
          name: `${name}.example`,
          description: 'An example tool — replace this with your actual tool.',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Example input parameter' },
            },
            required: ['input'],
          },
          actionType: 'direct',
        },
      ],
    },
    null,
    2
  );

const INDEX_TEMPLATE = (name: string, displayName: string) => `import type { PluginInstance, PluginAPI } from '@tardis/core';

const plugin: PluginInstance = {
  async onActivate(api: PluginAPI) {
    api.logger.info('${displayName} plugin activated');
  },

  async onDeactivate() {
    // cleanup
  },

  async executeTool(toolName: string, args: Record<string, unknown>) {
    if (toolName === '${name}.example') {
      const input = args['input'] as string;
      return { result: \`You passed: \${input}\` };
    }
    throw new Error(\`Unknown tool: \${toolName}\`);
  },
};

export default plugin;
`;

/**
 * Scaffold a new plugin directory from a minimal template.
 * Used by `tardis plugin create <name>`.
 */
export function runPluginCreate(pluginName: string, pluginsDir: string): void {
  // Validate name: lowercase letters, numbers, hyphens only
  if (!/^[a-z0-9-]+$/.test(pluginName)) {
    console.error(`Error: plugin name must be lowercase letters, numbers, and hyphens only.`);
    console.error(`Got: "${pluginName}"`);
    process.exit(1);
  }

  const pluginDir = join(pluginsDir, pluginName);

  if (existsSync(pluginDir)) {
    console.error(`Error: plugin directory already exists: ${pluginDir}`);
    process.exit(1);
  }

  const displayName = pluginName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'manifest.json'), MANIFEST_TEMPLATE(pluginName, displayName));
  writeFileSync(join(pluginDir, 'index.ts'), INDEX_TEMPLATE(pluginName, displayName));

  console.log(`Created plugin: ${pluginName}`);
  console.log(`  ${join(pluginDir, 'manifest.json')}`);
  console.log(`  ${join(pluginDir, 'index.ts')}`);
  console.log('\nNext steps:');
  console.log('  1. Edit manifest.json — update description, tools, and permissions');
  console.log('  2. Edit index.ts — implement executeTool()');
  console.log(`  3. Run: tardis plugins  — to verify it loads`);
}
