import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { PluginManifestSchema } from '@tardis/shared';

// ─── The shipped manifests must satisfy the contract ─────────────────────────
//
// Schema tests prove the rules work on synthetic input. This proves the real
// plugins actually obey them — the thing that silently rots when someone edits
// a manifest by hand.

function findRepoRoot(): string {
  let dir = resolve(import.meta.dir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'turbo.json')) && existsSync(join(dir, 'plugins'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Could not locate repo root from ' + import.meta.dir);
}

const PLUGINS_DIR = join(findRepoRoot(), 'plugins');
const PLUGIN_DIRS = readdirSync(PLUGINS_DIR).filter((d) =>
  existsSync(join(PLUGINS_DIR, d, 'manifest.json'))
);

describe('shipped plugin manifests', () => {
  it('finds the plugins directory', () => {
    expect(PLUGIN_DIRS.length).toBeGreaterThan(0);
  });

  for (const dir of PLUGIN_DIRS) {
    describe(dir, () => {
      // Parsed lazily INSIDE each test. Parsing at describe-time made an invalid
      // manifest an "unhandled error between tests" — reported alongside
      // "0 fail", so a plugin that could not load shipped to production with a
      // green suite. A bad manifest must be a FAILING TEST.
      const load = (): ReturnType<typeof PluginManifestSchema.parse> =>
        PluginManifestSchema.parse(
          JSON.parse(readFileSync(join(PLUGINS_DIR, dir, 'manifest.json'), 'utf-8'))
        );

      it('parses and normalizes', () => {
        const manifest = load();
        expect(manifest.summary.length).toBeGreaterThan(0);
        expect(manifest.skills.length).toBeGreaterThan(0);
      });

      it('has a summary the schema will accept at load time', () => {
        // 500 chars is the schema limit; exceeding it stops the plugin loading
        // entirely, with every one of its skills silently absent.
        const raw = JSON.parse(readFileSync(join(PLUGINS_DIR, dir, 'manifest.json'), 'utf-8'));
        const summary: string = raw.summary ?? raw.skillSummary ?? '';
        expect({ dir, length: summary.length }).toMatchObject({
          length: expect.any(Number),
        });
        expect(summary.length).toBeGreaterThan(0);
        expect(summary.length).toBeLessThanOrEqual(500);
      });

      it('gives every skill an id namespaced to this plugin', () => {
        const manifest = load();
        for (const skill of manifest.skills) {
          expect(skill.id.startsWith(`${manifest.name}.`)).toBe(true);
        }
      });

      it('only references parameters the skill actually accepts in ui.fields', () => {
        const manifest = load();
        for (const skill of manifest.skills) {
          const fields = skill.ui?.fields;
          if (!fields) continue;
          const declared = Object.keys(
            (skill.parameters['properties'] as Record<string, unknown> | undefined) ?? {}
          );
          for (const f of fields) {
            expect({ skill: skill.id, field: f.name, declared }).toMatchObject({
              declared: expect.arrayContaining([f.name]),
            });
          }
        }
      });

      it('points every ui item action at a skill that exists', () => {
        const manifest = load();
        const allIds = new Set(manifest.skills.map((s) => s.id));
        for (const skill of manifest.skills) {
          for (const action of skill.ui?.actions ?? []) {
            // Cross-plugin actions are legal; only same-plugin ones are checked here.
            if (!action.skill.startsWith(`${manifest.name}.`)) continue;
            expect({ from: skill.id, action: action.skill, exists: allIds.has(action.skill) })
              .toMatchObject({ exists: true });
          }
        }
      });

      it('never ships custom UI without a standard fallback', () => {
        const manifest = load();
        // Enforced by the schema, asserted here so the intent is visible where
        // someone would actually add custom UI.
        for (const skill of manifest.skills) {
          if (skill.ui?.custom) expect(skill.ui.block).toBeDefined();
        }
      });
    });
  }
});
