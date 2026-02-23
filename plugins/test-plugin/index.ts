// Test Plugin — used to verify plugin system works during development

export const onActivate = async (api: any): Promise<void> => {
  api.logger.info('Test plugin activated');
  await api.storage.set('activated', true);
};

export const onDeactivate = async (): Promise<void> => {
  // nothing to clean up
};

export const executeTool = async (
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  if (toolName === 'test-plugin.ping') {
    const message = typeof args['message'] === 'string' ? args['message'] : '';
    return { pong: true, echo: message || 'hello from test-plugin' };
  }
  throw new Error(`Unknown tool: ${toolName}`);
};
