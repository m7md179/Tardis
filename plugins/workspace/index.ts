import type { PluginAPI } from '@tardis/core';

let api: PluginAPI;

export const onActivate = async (pluginApi: PluginAPI): Promise<void> => {
  api = pluginApi;
  api.logger.info('Workspace plugin activated');
};

export const onDeactivate = async (): Promise<void> => {
  api.logger.info('Workspace plugin deactivated');
};

export const executeTool = async (
  toolName: string,
  _args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'workspace.list-workspaces':
      return { workspaces: [] };
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
