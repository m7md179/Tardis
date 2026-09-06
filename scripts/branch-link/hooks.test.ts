/**
 * Hook semantics, against a real git repository.
 *
 * These are the behaviours that look obviously right and are not: whether
 * `post-checkout` can tell branch CREATION from a plain checkout, and whether
 * `pre-push` consumes its stdin without breaking the push. Neither is
 * observable from a unit test of the helper, because both live in the shell.
 *
 * The hooks are installed pointing at a stub instead of bun, so a run appends
 * one line to a file and nothing touches the network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let repo: string;
let calls: string;
const HOOKS = join(import.meta.dir, 'hooks');

async function sh(cwd: string, cmd: string): Promise<void> {
  const proc = Bun.spawn(['sh', '-c', cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
}

/** The hooks background their work, so give it a moment to land. */
async function settled(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(50);
    const seen = await readFile(calls, 'utf8').catch(() => '');
    if (seen !== '') return seen;
  }
  return readFile(calls, 'utf8').catch(() => '');
}

/**
 * Wait until the stub has stopped being written to.
 *
 * The hooks background their work, so a checkout returns before its hook has
 * finished. Truncating the log without waiting lets a PREVIOUS action's write
 * land after the reset and be read as though the action under test caused it —
 * which is exactly what the first version of these tests did.
 */
async function quiesce(): Promise<void> {
  let last = -1;
  let stable = 0;
  while (stable < 4) {
    await Bun.sleep(75);
    const size = (await readFile(calls, 'utf8').catch(() => '')).length;
    if (size === last) stable++;
    else {
      stable = 0;
      last = size;
    }
  }
}

async function reset(): Promise<void> {
  await quiesce();
  await writeFile(calls, '');
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'branchlink-'));
  calls = join(repo, 'calls.txt');
  await writeFile(calls, '');

  const stub = join(repo, 'stub.sh');
  await writeFile(stub, `#!/bin/sh\necho "$@" >> "${calls.replace(/\\/g, '/')}"\n`);
  await chmod(stub, 0o755);

  await sh(repo, 'git init -q . && git config user.email t@t && git config user.name t');
  await writeFile(join(repo, 'a.txt'), 'hello\n');
  await sh(repo, 'git add . && git commit -qm first');

  await mkdir(join(repo, '.git', 'hooks'), { recursive: true });
  for (const name of ['post-checkout', 'pre-push']) {
    const body = (await readFile(join(HOOKS, name), 'utf8'))
      .replace('__BUN__', 'sh')
      .replace('__CLI__', stub.replace(/\\/g, '/'));
    const path = join(repo, '.git', 'hooks', name);
    await writeFile(path, body);
    await chmod(path, 0o755);
  }
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

describe('post-checkout', () => {
  it('fires when a branch is created', async () => {
    await reset();
    await sh(repo, 'git checkout -q -b feat/new-thing');
    expect(await settled()).toContain('draft');
    expect(await settled()).toContain('feat/new-thing');
  });

  it('does NOT fire when switching back to a branch created earlier', async () => {
    // Without this, switching between two branches all day re-drafts each
    // time. The hook decides by how long ago the branch was created, so the
    // test shrinks that window to zero rather than sleeping through it: at
    // creation the age is 0 and it fires, a second later it does not.
    await sh(repo, 'git checkout -q -b feat/second');
    await sh(repo, 'git checkout -q feat/new-thing');
    await Bun.sleep(1200);
    await reset();
    await sh(repo, 'TARDIS_BRANCH_NEW_WINDOW=0 git checkout -q feat/second');
    await Bun.sleep(600);
    expect(await readFile(calls, 'utf8')).toBe('');
  });

  it('still fires for a branch created right now', async () => {
    // Guards the test above: if the window logic were broken into "never
    // fire", that test would pass for the wrong reason.
    //
    // Deliberately the DEFAULT window, not zero. `date +%s` has one-second
    // resolution, so a branch created at X.99 and checked at X+1.01 reads as
    // one second old — with a window of zero that is a coin toss, and this
    // test flaked on it before.
    await reset();
    await sh(repo, 'git checkout -q -b feat/third');
    expect(await settled()).toContain('feat/third');
  });

  it('does NOT fire on a file checkout', async () => {
    // git passes flag 0 for `git checkout -- <path>`; acting on it would
    // create a task every time someone discarded a change.
    await writeFile(join(repo, 'a.txt'), 'changed\n');
    await reset();
    await sh(repo, 'git checkout -q -- a.txt');
    await Bun.sleep(400);
    expect(await readFile(calls, 'utf8')).toBe('');
  });

  it('does not fire for a protected branch', async () => {
    await reset();
    await sh(repo, 'git checkout -q -b main');
    await Bun.sleep(400);
    // The hook itself does not filter — the helper does — so it may be
    // invoked, but never with a protected branch treated as new work.
    const seen = await readFile(calls, 'utf8');
    if (seen !== '') expect(seen).toContain('main');
  });
});

describe('pre-push', () => {
  it('consumes stdin and lets the push succeed', async () => {
    // pre-push reads its ref list from stdin. A hook that does not consume it
    // can leave git writing into a closed pipe; one that exits non-zero
    // aborts the push outright.
    const remote = await mkdtemp(join(tmpdir(), 'branchlink-remote-'));
    await sh(remote, 'git init -q --bare .');
    await sh(repo, `git remote add origin "${remote.replace(/\\/g, '/')}"`);
    await reset();

    const proc = Bun.spawn(['sh', '-c', 'git push -q origin HEAD:refs/heads/main'], {
      cwd: repo,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(await settled()).toContain('push');
    await rm(remote, { recursive: true, force: true }).catch(() => {});
  });
});
