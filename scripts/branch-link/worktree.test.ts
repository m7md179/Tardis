/**
 * The worktree case, against a real husky-shaped repository.
 *
 * `core.hooksPath` is stored once in .git/config and shared by every
 * worktree — but husky sets it to the RELATIVE path `.husky/_`, and git
 * resolves a relative hooksPath against each working tree's own root. Since
 * `.husky/_` is gitignored and generated only where `npm install` ran, a
 * worktree has no such directory and git runs no hooks at all, silently.
 *
 * Measured on internal-operation-server: 253 worktrees, none of them firing
 * a hook — husky's own pre-commit included.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const INSTALL = join(import.meta.dir, 'install.sh');

let root: string;
let main: string;
let tree: string;
let home: string;
let calls: string;

async function sh(cwd: string, cmd: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(['sh', '-c', cmd], {
    cwd,
    env: { ...process.env, HOME: home },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return { code: proc.exitCode ?? 1, out };
}

async function settled(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    await Bun.sleep(80);
    const seen = await readFile(calls, 'utf8').catch(() => '');
    if (seen !== '') return seen;
  }
  return readFile(calls, 'utf8').catch(() => '');
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wt-'));
  main = join(root, 'main');
  tree = join(root, 'tree');
  home = join(root, 'home');
  calls = join(root, 'calls.txt');
  await mkdir(home, { recursive: true });
  await writeFile(calls, '');

  await mkdir(main, { recursive: true });
  await sh(main, 'git init -q . && git config user.email t@t && git config user.name t');
  await writeFile(join(main, 'a.txt'), 'hello\n');
  await sh(main, 'git add . && git commit -qm first');

  // Reproduce husky's layout: a relative hooksPath, wrappers in a gitignored
  // `_`, and a tracked hook of its own.
  await mkdir(join(main, '.husky', '_'), { recursive: true });
  await writeFile(join(main, '.husky', '_', '.gitignore'), '*\n');
  await writeFile(
    join(main, '.husky', '_', 'h'),
    '#!/usr/bin/env sh\nn=$(basename "$0")\ns=$(dirname "$(dirname "$0")")/$n\n[ ! -f "$s" ] && exit 0\nsh -e "$s" "$@"\n'
  );
  for (const hook of ['post-checkout', 'pre-push', 'pre-commit']) {
    const p = join(main, '.husky', '_', hook);
    await writeFile(p, '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n');
    await chmod(p, 0o755);
  }
  await writeFile(join(main, '.husky', 'pre-commit'), '#!/bin/sh\necho husky-pre-commit\n');
  await sh(main, 'git add .husky/pre-commit && git commit -qm husky');
  await sh(main, 'git config core.hooksPath .husky/_');

  await sh(main, `git worktree add -q "${tree.replace(/\\/g, '/')}" -b wt-branch`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('the bug', () => {
  it('a worktree has no .husky/_, so git finds no hook there', async () => {
    const { out } = await sh(tree, 'ls .husky/_ 2>/dev/null | wc -l');
    expect(out.trim()).toBe('0');
  });
});

describe('after install', () => {
  beforeAll(async () => {
    const stub = join(root, 'stub.sh');
    await writeFile(stub, `#!/bin/sh\necho "$@" >> "${calls.replace(/\\/g, '/')}"\n`);
    await chmod(stub, 0o755);
    await writeFile(
      join(home, '.tardis-branch-link-config-marker'),
      'placeholder so install does not prompt'
    );
    await mkdir(join(home, '.tardis-branch-link'), { recursive: true });
    await writeFile(
      join(home, '.tardis-branch-link', 'config.json'),
      JSON.stringify({ baseUrl: 'http://x', password: 'y' })
    );
    await sh(
      main,
      `TARDIS_BUN=sh TARDIS_CLI='${stub.replace(/\\/g, '/')}' sh "${INSTALL.replace(/\\/g, '/')}" "${main.replace(/\\/g, '/')}"`
    );
  });

  it('sets an absolute hooksPath, which every worktree shares', async () => {
    const { out } = await sh(tree, 'git config --get core.hooksPath');
    expect(out.trim().startsWith('.')).toBe(false);
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('fires in a worktree — the whole point', async () => {
    await writeFile(calls, '');
    await sh(tree, 'git checkout -q -b feat/in-a-worktree');
    expect(await settled()).toContain('feat/in-a-worktree');
  }, 30000);

  it('fires in a worktree created AFTER install, with no extra step', async () => {
    // The requirement: automatic. A worktree made tomorrow must work without
    // anyone remembering to install into it.
    const fresh = join(root, 'fresh');
    await sh(main, `git worktree add -q "${fresh.replace(/\\/g, '/')}" -b wt-later`);
    await writeFile(calls, '');
    await sh(fresh, 'git checkout -q -b feat/made-later');
    expect(await settled()).toContain('feat/made-later');
  }, 30000);

  it('still runs husky in the main checkout, where .husky/_ exists', async () => {
    const { out } = await sh(main, 'sh "$(git config --get core.hooksPath)"/pre-commit');
    expect(out).toContain('husky-pre-commit');
  });

  it('leaves husky as inert in a worktree as it already was', async () => {
    // Copying husky's whole `_` directory would switch lint-staged on across
    // 253 worktrees for the first time. That is a change to the commit
    // workflow nobody asked for, so the shim delegates only where `.husky/_`
    // already exists.
    const { out } = await sh(tree, 'sh "$(git config --get core.hooksPath)"/pre-commit');
    expect(out).not.toContain('husky-pre-commit');
  });

  it('restores husky’s own hooksPath on uninstall', async () => {
    await sh(main, `sh "${INSTALL.replace(/\\/g, '/')}" --uninstall "${main.replace(/\\/g, '/')}"`);
    const { out } = await sh(tree, 'git config --get core.hooksPath');
    expect(out.trim()).toBe('.husky/_');
  });
});
