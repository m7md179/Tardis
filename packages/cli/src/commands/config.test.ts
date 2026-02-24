import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { runConfigShow } from './config.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDataDir(configOverride: Record<string, unknown> = {}): {
  dataDir: string;
  cleanup: () => void;
} {
  const dataDir = join('/tmp', `tardis-config-test-${randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });

  const config = {
    auth: { jwtSecret: 'a-secret-that-is-at-least-32-characters-long' },
    llm: { provider: 'ollama', model: 'qwen3:4b' },
    ...configOverride,
  };
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify(config));

  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

// ─── runConfigShow ────────────────────────────────────────────────────────────

describe('runConfigShow', () => {
  let dataDir: string;
  let cleanup: () => void;
  let output: string;
  const origLog = console.log.bind(console);

  beforeEach(() => {
    ({ dataDir, cleanup } = makeTempDataDir());
    output = '';
    console.log = (msg: unknown) => {
      output += String(msg) + '\n';
    };
  });

  afterEach(() => {
    console.log = origLog;
    cleanup();
  });

  it('prints valid JSON', () => {
    runConfigShow(dataDir);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('redacts the JWT secret', () => {
    runConfigShow(dataDir);
    expect(output).not.toContain('a-secret-that-is-at-least-32-characters-long');
    expect(output).toContain('[redacted]');
  });

  it('shows the LLM provider and model', () => {
    runConfigShow(dataDir);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const llm = parsed['llm'] as Record<string, unknown>;
    expect(llm['provider']).toBe('ollama');
    expect(llm['model']).toBe('qwen3:4b');
  });

  it('redacts the API key when present', () => {
    const { dataDir: d2, cleanup: c2 } = makeTempDataDir({
      llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-supersecretkey' },
    });
    runConfigShow(d2);
    expect(output).not.toContain('sk-supersecretkey');
    expect(output).toContain('[redacted]');
    c2();
  });

  it('redacts Telegram bot token when present', () => {
    const { dataDir: d2, cleanup: c2 } = makeTempDataDir({
      telegram: { botToken: 'bot123456:ABC-secrettoken', allowedChatIds: [] },
    });
    runConfigShow(d2);
    expect(output).not.toContain('bot123456:ABC-secrettoken');
    expect(output).toContain('[redacted]');
    c2();
  });
});
