import { loadConfig } from '@tardis/core';

/**
 * Display the current configuration.
 * Used by `tardis config --show`.
 */
export function runConfigShow(dataDir: string): void {
  const config = loadConfig(dataDir);

  // Redact the JWT secret and API key before printing
  const safe = {
    ...config,
    auth: {
      ...config.auth,
      jwtSecret: config.auth.jwtSecret ? '[redacted]' : '(not set)',
    },
    llm: {
      ...config.llm,
      apiKey: config.llm.apiKey ? '[redacted]' : '(not set)',
    },
    telegram: config.telegram
      ? {
          ...config.telegram,
          botToken: '[redacted]',
        }
      : undefined,
  };

  console.log(JSON.stringify(safe, null, 2));
}
