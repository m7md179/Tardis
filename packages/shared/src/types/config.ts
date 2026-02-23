import type { AgentConfig } from './agent.js';

export interface LLMProviderConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'google';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}

export interface TelegramConfig {
  botToken: string;
  allowedChatIds: string[];
}

export interface ProactiveConfig {
  enabled: boolean;
  quietHoursStart?: string;  // "22:00"
  quietHoursEnd?: string;    // "08:00"
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiry: string;
}

export interface SystemConfig {
  server: ServerConfig;
  auth: AuthConfig;
  llm: LLMProviderConfig;
  agent: AgentConfig & { personality?: string };
  telegram?: TelegramConfig;
  proactive: ProactiveConfig;
}
