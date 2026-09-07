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
import {
  parseCommitLog,
  parsePrePushRefs,
  resolveTimeoutMs,
  shouldAct,
  DEFAULT_PROTECTED,
} from './core.js';
import { allocate, parseSourceLog, sessionize } from '../../plugins/workspace/sessions.js';
import type { CommitEvent } from '../../plugins/workspace/sessions.js';
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
  requestTimeoutMs?: number;
  /** Repos to scan for `time`. Absolute paths to the main checkouts. */
  repos?: string[];
  /** Commits further apart than this start a new working session. */
  gapMinutes?: number;
  /** Credited before a session's first commit, for the work that produced it. */
  leadInMinutes?: number;
  /** Hard ceiling per day; the split is scaled, never truncated. */
  maxDayHours?: number;
  /** Shares below this are dropped — a zero-minute entry is timesheet noise. */
  minMinutes?: number;
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
      requestTimeoutMs: resolveTimeoutMs(parsed.requestTimeoutMs),
      repos: parsed.repos ?? [],
      gapMinutes: parsed.gapMinutes ?? 45,
      leadInMinutes: parsed.leadInMinutes ?? 30,
      maxDayHours: parsed.maxDayHours ?? 10,
      minMinutes: parsed.minMinutes ?? 10,
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
      fetch(url, { ...init, signal: AbortSignal.timeout(resolveTimeoutMs(config.requestTimeoutMs)) }),
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

/**
 * `cli.ts time <YYYY-MM-DD> [--write] [--replace]`
 *
 * Divides one day's real working time between the branches worked on, and
 * prints it. Nothing is written without --write, deliberately: these numbers
 * go on a timesheet, and you should see the split before it becomes a record.
 */
async function runTime(config: Config, date: string, write: boolean, replace: boolean): Promise<void> {
  const commits: CommitEvent[] = [];

  for (const repoRoot of config.repos ?? []) {
    const repo = await repoFullName(repoRoot);
    if (repo === null) continue;
    const author = (await git(repoRoot, ['config', 'user.email'])).trim();

    // --branches, NOT --all. `--source` reports whichever ref git traversed
    // from, and under --all a commit that has been pushed is usually reached
    // via refs/remotes/origin/<branch> — which parseSourceLog drops, so the
    // day silently counted only UNPUSHED work. Measured: 3 commits found
    // where the repo had 22. --branches traverses local heads only, so %S is
    // always a branch you were working on.
    const raw = await git(repoRoot, [
      'log',
      '--branches',
      '--source',
      '--no-merges',
      ...(author === '' ? [] : [`--author=${author}`]),
      `--since=${date} 00:00:00`,
      `--until=${date} 23:59:59`,
      '--format=%S%x00%at%x1e',
    ]);
    commits.push(...parseSourceLog(raw, repo));
  }

  const sessions = sessionize(commits, {
    gapSeconds: (config.gapMinutes ?? 45) * 60,
    leadInSeconds: (config.leadInMinutes ?? 30) * 60,
  });
  const worked = sessions.reduce((n, s) => n + s.seconds, 0);
  const allocations = allocate(sessions, {
    maxDaySeconds: (config.maxDayHours ?? 10) * 3600,
    minSeconds: (config.minMinutes ?? 10) * 60,
  });

  const hhmm = (sec: number): string =>
    `${Math.floor(sec / 3600)}h${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`;

  console.log(`${date}: ${commits.length} commits, ${sessions.length} sessions, ${hhmm(worked)} worked`);
  for (const s of sessions) {
    const from = new Date(s.startedAt * 1000).toTimeString().slice(0, 5);
    const to = new Date(s.endedAt * 1000).toTimeString().slice(0, 5);
    console.log(`  ${from}-${to}  ${hhmm(s.seconds)}  (${s.commits.length} commits)`);
  }
  console.log('');
  for (const a of allocations) console.log(`  ${hhmm(a.seconds).padStart(6)}  ${a.branch}`);
  const billed = allocations.reduce((n, a) => n + a.seconds, 0);
  console.log(`  ${hhmm(billed).padStart(6)}  TOTAL`);

  if (!write) {
    console.log('');
    console.log('Nothing written. Re-run with --write to log it.');
    return;
  }

  const deps = makeDeps(config);
  const result = await invokeSkill(deps, 'workspace.log-branch-time', { date, allocations, replace });
  console.log('');
  console.log(`${result.status}${result.detail === undefined ? '' : `: ${result.detail}`}`);
  await log(`time ${date} -> ${result.status}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command, repoRoot, branchArg] = argv;
  if (command === undefined) return;

  const config = await readConfig();
  if (config === null) {
    await log(`no usable config at ${CONFIG_PATH} — run install.sh`);
    if (command === 'time') console.error(`No config at ${CONFIG_PATH}. Run install.sh.`);
    return;
  }

  // `time` is the one command a person runs by hand, so it prints.
  if (command === 'time') {
    const date = repoRoot ?? new Date().toISOString().slice(0, 10);
    await runTime(config, date, argv.includes('--write'), argv.includes('--replace'));
    return;
  }

  if (repoRoot === undefined) return;

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
        '--format=%s%x00%b%x00%H%x00%at%x1e',
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
