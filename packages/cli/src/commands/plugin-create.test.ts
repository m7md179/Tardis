import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { runPluginCreate } from './plugin-create.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join('/tmp', `tardis-cli-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── runPluginCreate ──────────────────────────────────────────────────────────

describe('runPluginCreate', () => {
  let pluginsDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    pluginsDir = makeTempDir();
    cleanup = () => rmSync(pluginsDir, { recursive: true, force: true });
  });

  afterEach(() => cleanup());

  it('creates the plugin directory', () => {
    runPluginCreate('my-plugin', pluginsDir);
    expect(existsSync(join(pluginsDir, 'my-plugin'))).toBe(true);
  });

  it('creates manifest.json with the correct name and structure', () => {
    runPluginCreate('my-plugin', pluginsDir);

    const manifestPath = join(pluginsDir, 'my-plugin', 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    expect(manifest['name']).toBe('my-plugin');
    expect(manifest['version']).toBe('1.0.0');
    expect(manifest['displayName']).toBe('My Plugin');
    expect(Array.isArray(manifest['tools'])).toBe(true);
  });

  it('creates index.ts with plugin boilerplate', () => {
    runPluginCreate('my-plugin', pluginsDir);

    const indexPath = join(pluginsDir, 'my-plugin', 'index.ts');
    expect(existsSync(indexPath)).toBe(true);

    const content = readFileSync(indexPath, 'utf-8');
    expect(content).toContain('PluginInstance');
    expect(content).toContain('executeTool');
    expect(content).toContain('my-plugin');
  });

  it('converts hyphenated name to Title Case for displayName', () => {
    runPluginCreate('google-calendar', pluginsDir);

    const manifest = JSON.parse(
      readFileSync(join(pluginsDir, 'google-calendar', 'manifest.json'), 'utf-8')
    ) as Record<string, unknown>;

    expect(manifest['displayName']).toBe('Google Calendar');
  });

  it('exits with error when plugin directory already exists', () => {
    mkdirSync(join(pluginsDir, 'existing-plugin'), { recursive: true });

    let exited = false;
    const origExit = process.exit.bind(process);
    (process as unknown as { exit: (code?: number) => never }).exit = () => {
      exited = true;
      throw new Error('process.exit called');
    };

    try {
      runPluginCreate('existing-plugin', pluginsDir);
    } catch {
      // expected
    } finally {
      (process as unknown as { exit: typeof origExit }).exit = origExit;
    }

    expect(exited).toBe(true);
  });

  it('exits with error when plugin name contains invalid characters', () => {
    let exited = false;
    const origExit = process.exit.bind(process);
    (process as unknown as { exit: (code?: number) => never }).exit = () => {
      exited = true;
      throw new Error('process.exit called');
    };

    try {
      runPluginCreate('My Plugin!', pluginsDir);
    } catch {
      // expected
    } finally {
      (process as unknown as { exit: typeof origExit }).exit = origExit;
    }

    expect(exited).toBe(true);
  });

  it('creates a tool entry named <pluginName>.example in manifest', () => {
    runPluginCreate('time-tracker', pluginsDir);

    const manifest = JSON.parse(
      readFileSync(join(pluginsDir, 'time-tracker', 'manifest.json'), 'utf-8')
    ) as { tools: Array<{ name: string }> };

    const toolNames = manifest.tools.map((t) => t.name);
    expect(toolNames).toContain('time-tracker.example');
  });
});
