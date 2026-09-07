#!/usr/bin/env bun
/**
 * cli.ts — the helper both git hooks background.
 *
 * See docs/specs/2026-09-06-branch-linked-work-items-design.md §8.
 *
 *   cli.ts draft <repo-root> <branch>     (post-checkout)
 *   cli.ts push  <repo-root>              (pre-push, refs on stdin)
 *
 * Contract with the hooks: this process is detached and nobody reads its
 * output, so it prints nothing and exits 0 whatever happens. Everything it
 * has to say goes to the log file.
 *
 * The queue is drained at the start of EVERY run. It has to be: the queue
 * lives on this machine, and `workspace.branch-status` is a skill on the
 * server, which cannot see it. The next branch you create is what ships the
 * ones that failed while TARDIS was down.
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { parseCommitLog, parsePrePushRefs, shouldAct, DEFAULT_PROTECTED } from './core.js';
import { invokeSkill } from './transport.js';
import type { TransportDeps } from './transport.js';

const HOME = join(homedir(), '.tardis-branch-link');
const CONFIG_PATH = join(HOME, 'config.json');
const TOKEN_PATH = join(HOME, 'token');
const QUEUE_DIR = join(HOME, 'queue');
const LOG_PATH = join(HOME, 'branch-link.log');

interface Config {
  baseUrl: string;
  password: string;
  protectedBranches?: string[];
  maxCommits?: number;
}

async function log(message: string): Promise<void> {
  try {
    await mkdir(HOME, { recursive: true });
    await writeFile(LOG_PATH, `${new Date().toISOString()} ${message}\n`, { flag: 'a' });
  } catch {
    // A hook helper that cannot write its own log has nothing better to do.
  }
}

async function readConfig(): Promise<Config | null> {
  try {
    const parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Partial<Config>;
    if (typeof parsed.baseUrl !== 'string' || typeof parsed.password !== 'string') return null;
    return {
      baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
      password: parsed.password,
      protectedBranches: parsed.protectedBranches ?? DEFAULT_PROTECTED,
      maxCommits: parsed.maxCommits ?? 50,
    };
  } catch {
    return null;
  }
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', '-C', repoRoot, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return proc.exitCode === 0 ? out : '';
}

function makeDeps(config: Config): TransportDeps {
  return {
    baseUrl: config.baseUrl,
    password: config.password,
    fetchImpl: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(30000) }),
    readToken: async () => {
      try {
        return (await readFile(TOKEN_PATH, 'utf8')).trim() || null;
      } catch {
        return null;
      }
    },
    writeToken: async (token) => {
      await mkdir(HOME, { recursive: true });
      await writeFile(TOKEN_PATH, token, { mode: 0o600 });
    },
    enqueue: async (skillId, args) => {
      await mkdir(QUEUE_DIR, { recursive: true });
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
      await writeFile(join(QUEUE_DIR, name), JSON.stringify({ skillId, args }));
    },
    log: (message) => void log(message),
  };
}

/**
 * Ship anything queued by an earlier run. A request that is refused (rather
 * than failing) is deleted: it was a decision, and replaying it forever would
 * grow the queue without bound.
 */
async function drain(deps: TransportDeps): Promise<void> {
  let names: string[];
  try {
    names = await readdir(QUEUE_DIR);
  } catch {
    return;
  }

  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const path = join(QUEUE_DIR, name);
    let entry: { skillId?: unknown; args?: unknown };
    try {
      entry = JSON.parse(await readFile(path, 'utf8')) as { skillId?: unknown; args?: unknown };
    } catch {
      await unlink(path).catch(() => {});
      continue;
    }
    if (typeof entry.skillId !== 'string') {
      await unlink(path).catch(() => {});
      continue;
    }

    // Remove first: enqueue() on failure writes a fresh entry, so deleting
    // after a failure would drop it, and deleting before a success is safe.
    await unlink(path).catch(() => {});
    const result = await invokeSkill(deps, entry.skillId, entry.args);
    await log(`drain ${entry.skillId} -> ${result.status}`);
  }
}

async function repoFullName(repoRoot: string): Promise<string | null> {
  const remote = (await git(repoRoot, ['remote', 'get-url', 'origin'])).trim();
  const cleaned = remote.replace(/\.git$/, '');
  const https = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+\/[^/]+)$/.exec(cleaned);
  if (https) return https[1] ?? null;
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+\/[^/]+)$/.exec(cleaned);
  if (ssh) return ssh[1] ?? null;
  return null;
}

async function defaultBranch(repoRoot: string): Promise<string> {
  const head = (await git(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim();
  const name = head.split('/').pop();
  return name !== undefined && name !== '' ? name : 'main';
}

async function main(): Promise<void> {
  const [command, repoRoot, branchArg] = process.argv.slice(2);
  if (command === undefined || repoRoot === undefined) return;

  const config = await readConfig();
  if (config === null) {
    await log(`no usable config at ${CONFIG_PATH} — run install.sh`);
    return;
  }

  const deps = makeDeps(config);
  await drain(deps);

  const repo = await repoFullName(repoRoot);
  if (repo === null) {
    await log(`${repoRoot}: origin is not a GitHub remote, nothing to link`);
    return;
  }

  const protectedBranches = config.protectedBranches ?? DEFAULT_PROTECTED;

  if (command === 'draft') {
    if (branchArg === undefined || !shouldAct(branchArg, protectedBranches)) return;
    const base = await defaultBranch(repoRoot);
    const result = await invokeSkill(deps, 'workspace.branch-draft', {
      repoFullName: repo,
      branch: branchArg,
      baseBranch: base,
    });
    await log(`draft ${repo}#${branchArg} -> ${result.status}`);
    return;
  }

  if (command === 'push') {
    const stdin = await new Response(Bun.stdin.stream()).text();
    const base = await defaultBranch(repoRoot);

    for (const ref of parsePrePushRefs(stdin)) {
      if (!shouldAct(ref.branch, protectedBranches)) continue;

      const raw = await git(repoRoot, [
        'log',
        `--max-count=${String(config.maxCommits ?? 50)}`,
        '--format=%s%x00%b%x00%H%x1e',
        `origin/${base}..${ref.sha}`,
      ]);

      const result = await invokeSkill(deps, 'workspace.branch-create', {
        repoFullName: repo,
        branch: ref.branch,
        baseBranch: base,
        commits: parseCommitLog(raw),
      });
      await log(`push ${repo}#${ref.branch} -> ${result.status}`);
    }
  }
}

// Nothing may escape: the git command that triggered this has already returned.
main().catch((err) => void log(`unhandled: ${String(err)}`));
