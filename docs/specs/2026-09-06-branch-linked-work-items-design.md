# Branch-linked work items — design

**Date:** 2026-09-06
**Status:** approved, not yet implemented
**Scope of this repo's work:** TARDIS only. Two changes live outside it and are
handed off as documents (§13, §14).

---

## 1. What this is

Creating a git branch locally starts a work item; pushing that branch creates it
for real, with a title and description composed from the branch name and the
commits; merging the pull request moves it to Done.

The middle third of that sentence is the only part that does not already exist.

## 2. What already exists (verified, `origin/staging`)

The internal-operation server has a complete git-linkage subsystem, "M5 Part 1".
It is on `origin/staging`, **not** `origin/main` — a first pass at this design
grepped a stale checkout, concluded no GitHub support existed anywhere, and was
wrong. Anyone revisiting this should check `origin/staging` explicitly.

| Capability | Location |
|---|---|
| `workspace_git_link` — `pull_request` \| `commit` \| `branch`, with `state` (`open`/`merged`/`closed`) | `prisma/schema.prisma:8354` |
| HMAC-verified webhook, `POST /workspaces/git/webhook`, gated on `GITHUB_WEBHOOK_SECRET` | `workspace-git-webhook.controller.ts` |
| Branch-push handling — `refs/heads/…` upserts a `branch` link | `workspace-git-link.service.ts:588` |
| `PR_MERGED` automation trigger; `MOVE_STATUS` action | `schema.prisma:8239`, `8246` |
| Item-key parser, `\b<KEY>-(\d+)\b`, anchored so `TMS-142` never matches `TMS-1420` | `workspace-git-key-parser.util.ts` |
| Manual link UI ("Linked work") + auto-vs-manual attribution | `work-item-git-links.tsx` |
| `POST /workspaces/work-items/:wid/git-links`, body `{ url }` | `workspace-git-link.controller.ts:46` |

Two consequences:

- **"Merge the PR → move to Done" is configuration, not code.** A `PR_MERGED` →
  `MOVE_STATUS: DONE` automation rule plus `GITHUB_WEBHOOK_SECRET` plus a
  webhook pointed at the server.
- **Registering a branch link is one POST** of
  `https://github.com/<owner>/<repo>/tree/<branch>`. The service parses the URL;
  the plugin does not need to construct a link row.

## 3. Goals

1. `git checkout -b` records intent. Nothing appears on the board yet.
2. `git push` creates one work item, titled and described from the branch name
   and the commits, with a parent chosen from real candidates.
3. A merged PR closes it, without depending on a model remembering to do so.
4. No git command is ever slowed, blocked, or failed by this feature.

## 4. Non-goals

- Linking a branch to an item that already exists is a manual escape hatch
  (`branch-adopt`), not the primary flow.
- No sync back from work item to branch. The branch is upstream of the item.
- No support for providers other than GitHub. The server models `provider` as a
  string for exactly this reason, but nothing here uses it.
- No rewriting of branch names.

## 5. Decisions

### D1 — The item is drafted at checkout and created at push

At `git checkout -b` there are no commits, so a title derived then would be the
branch name and nothing more. At push there are commit subjects and bodies,
which is what makes an LLM-composed description worth having.

Checkout therefore writes a storage key and stops. Push composes and creates.

*Rejected:* create at checkout — thin descriptions, and every abandoned
experiment becomes a board item. *Rejected:* create at PR open — server-side and
simple, but the task appears after the work is finished, which defeats the point.

### D2 — The item is created, never matched

The branch is the trigger, not a reference. There is no key in
`feat/auto-submit-week-on-build` to match against, and there cannot be: the item
does not exist when the branch is named.

### D3 — The merged PR is matched by head ref, not by a key in text

This is the chicken-and-egg of D2. The existing webhook resolves a PR to an item
by parsing `TMS-143` from the PR title, body, or head ref. Our branch has no key
in it, so the PR will not match and `PR_MERGED` will never fire.

The fix is a server-side lookup: when a `pull_request` event arrives, also look
for an existing `branch` git-link in the same repo whose branch matches the PR's
head ref, and reuse its work item. See §13.

*Rejected:* instruct the coding agent to put `TMS-143` in every PR body. It
works, costs nothing server-side, and would be a reasonable start — but it makes
the closing half of the feature depend on a model complying every time, and a
merged PR that silently fails to close its task is a failure nobody notices for
a week. A database join is not a hope.

*Rejected:* rename the branch at push to embed the key. Everything downstream
would work untouched, but a hook that rewrites your branch under you is a bad
trade for saving one service-layer change.

### D4 — Hooks never block, never prompt, never fail the git command

`pre-push` already consumes stdin for the ref list, and pushes here are issued by
a coding agent, so an interactive prompt would hang mid-task rather than ask a
person. Both hooks background their work and `exit 0` unconditionally.

A `git push` that fails because a task tracker was unreachable is a worse defect
than the one this feature exists to fix.

### D5 — Hooks are local and untracked

`core.hooksPath` is `.husky/_` in the io repos. `.husky/_/` is entirely
gitignored and already contains generated wrappers for `post-checkout` and
`pre-push`, each of which invokes `.husky/<hook>` if present. Only
`.husky/commit-msg` and `.husky/pre-commit` are tracked.

Creating `.husky/post-checkout` would therefore commit it and run it on every
teammate's machine. The installer instead adds both files to
`.git/info/exclude`, which is local and never pushed.

Worktrees share the parent repo's hooks — `wt-tms-server/.git` is a `gitdir:`
pointer into `internal-operation-server/.git/worktrees/…` — so installing once
per repo covers all of them.

### D6 — The hook is shell; the logic is Bun, inside TARDIS

Each hook is ~15 lines of POSIX `sh` that decides whether to act and then
backgrounds a Bun CLI shipped in this repo. Building JSON from commit messages in
shell means escaping arbitrary text in `sh`, which is where this would break
silently. Bun is already a hard dependency of TARDIS, the logic becomes testable
with `bun test`, and the hot path stays trivial.

The installer records bun's **absolute path** at install time rather than relying
on `PATH`, which a git hook does not reliably inherit.

### D7 — Skills must not be `workflow`-typed

`POST /api/skills/:id/invoke` returns **409 `APPROVAL_REQUIRED`** for any skill
with `actionType: 'workflow'`, and **403 `READ_ONLY`** when the installation is
in read-only mode (`app.ts:457`). A workflow-typed branch skill would be
permanently unreachable from a hook. All four are `actionType: 'direct'`.

This is a deliberate narrowing of the earlier convention that write-heavy skills
get approval gates: these are invoked by a hook the user installed, on their own
machine, about their own branch.

### D8 — A confident parent or none at all

`rankCandidates` returns an empty list when nothing matches, rather than three
arbitrary items — a behaviour added after a real workspace surfaced "Contractor
Module" as a candidate for a login-rate-limiting query. That property is load
bearing here.

If ranking is confident, the item is a `SUB_TASK` under the chosen `STORY`. If it
is not, the item is created as a `STORY` under the configured epic. It never
invents a parent to satisfy the server's hierarchy constraint.

## 6. Flow

```
git checkout -b feat/auto-submit-week
  └─ post-checkout ──→ (background) ──→ workspace.branch-draft
                                          └─ storage: branch:… = drafting
                                             (no server write)

git push
  └─ pre-push ───────→ (background) ──→ workspace.branch-create
                                          ├─ api.llm.generate  → title, description
                                          ├─ rankCandidates    → parent (D8)
                                          ├─ io-client         → create item TMS-143
                                          ├─ POST …/git-links  → .../tree/<branch>
                                          └─ api.notifications → "TMS-143 created"

gh pr create → merge
  └─ GitHub webhook ──→ head ref matches the branch link (§13)
                          └─ PR_MERGED → MOVE_STATUS: DONE
```

## 7. The hooks

### `post-checkout`

Git passes `$1` previous HEAD, `$2` new HEAD, `$3` flag. Act only when **all** of:

- `$3 = 1` — a branch checkout, not a file restore. Without this the hook fires
  on `git checkout -- <path>`.
- `git symbolic-ref --short HEAD` succeeds — not a detached HEAD.
- The branch is not in `protectedBranches` (default `main`, `master`, `staging`,
  `develop`).
- `git reflog show <branch>` has exactly one entry. A newly created branch has
  one; a branch you are switching back to has more. This is the check that
  distinguishes creation from checkout, and it is the one most likely to be
  wrong, so it is tested against a real repo (§15).

Then background the CLI and `exit 0`.

### `pre-push`

Stdin carries `<local ref> <local sha> <remote ref> <remote sha>` lines. The hook
**must** read stdin to completion.

The hook cannot see plugin storage, so it does not filter on whether a branch was
drafted — it reports every pushed branch that is not protected, and the plugin
decides (§11.1, where a missing record is created rather than rejected). For each
such branch, collect:

- `git log --format=%s%x00%b%x00%H <merge-base>..<local sha>` against the repo's
  default branch, capped at 50 commits;
- the branch name, the repo's `origin` URL, and the local sha.

Background the CLI, `exit 0`.

Deleted refs (all-zero local sha) are skipped.

## 8. The CLI (`scripts/branch-link/`)

One entry point, two subcommands (`draft`, `push`). It:

1. Reads TARDIS URL and credentials from its own config file (§12).
2. Logs in against `POST /api/auth/login`, caching the token on disk with its
   expiry.
3. `POST /api/skills/workspace.branch-{draft,create}/invoke` with `{ args }`.
4. On any network failure, non-2xx, or timeout (5s connect, 30s total), writes
   the request to a queue directory and exits 0.
5. Appends a line to a log file either way.

It never writes to stdout or stderr in a way the user sees; the hook has already
returned.

### The installer

`scripts/branch-link/install.sh <repo-path>…`, run once per repo. For each:

1. Refuse unless the path is a git repo, and resolve its **common** git dir, so
   running it inside a worktree installs into the parent (D5).
2. Write `.husky/post-checkout` and `.husky/pre-push`, refusing to overwrite an
   existing file it did not write (checked by a marker line).
3. Append both paths to `.git/info/exclude` if absent — the step that keeps the
   hooks off your teammates' machines.
4. Substitute bun's absolute path and this repo's absolute path into the hooks
   (D6).
5. On first run only, write `~/.tardis-branch-link/config.json` at mode 600,
   prompting for the TARDIS URL and password.

`install.sh --uninstall <repo-path>` removes both hooks and its
`.git/info/exclude` lines, and leaves the config and queue alone.

## 9. Plugin storage

Key: `branch:<provider>:<repo_full_name>:<branch>`.

```ts
interface BranchRecord {
  provider: 'github';
  repoFullName: string;       // "taj-alsafa/internal-operation-server"
  branch: string;
  baseBranch: string | null;
  state: 'drafting' | 'created' | 'failed' | 'adopted';
  createdAt: string;
  updatedAt: string;
  itemId?: number;            // set when state is created | adopted
  itemKey?: string;           // "TMS-143"
  gitLinkId?: number;
  parentId?: number | null;
  error?: string;             // set when state is failed
  attempts: number;
}
```

`state` is the idempotency mechanism. `branch-create` on a record already in
`created` returns the existing item and does nothing — a second push, a force
push, or a queue drain replaying a request cannot produce a duplicate item.

Records in `drafting` older than `draftTtlDays` (default 14) are swept on any
`branch-status` call. Records in `created` are kept: they are the local half of
the branch↔item mapping.

## 10. Skills

All `actionType: 'direct'` (D7).

| Skill | `mutates` | Arguments | Behaviour |
|---|---|---|---|
| `workspace.branch-draft` | `true` | `repoFullName`, `branch`, `baseBranch?` | Writes a `drafting` record. No server call. Idempotent. |
| `workspace.branch-create` | `true` | `repoFullName`, `branch`, `commits[]`, `headSha` | §11. Idempotent on `state`. |
| `workspace.branch-status` | `false` | `state?` | Lists records; sweeps expired drafts. Renders as a `list` block. |
| `workspace.branch-adopt` | `true` | `repoFullName`, `branch`, `itemId` | Attaches the branch to an existing item, registers the git-link, sets `adopted`. The escape hatch when composition got it wrong. |

`branch-status` is the TUI surface: it is how you see that three branches are
waiting because TARDIS was down, and it is what drains the queue.

## 11. `branch-create` in detail

1. **Guard.** Record missing → create one (a push without a prior checkout hook,
   e.g. the hook was installed mid-branch). Record `created`/`adopted` → return
   the existing item, no writes.
2. **Compose.** `api.llm.generate` receives the branch name and commit subjects
   and bodies, and returns a title and description. The prompt asks for a title
   that reads as a task rather than a branch name, and a description that states
   what changed and why. Failure or unparseable output falls back to the branch
   name with separators replaced by spaces, and the commit subjects as a bulleted
   description — never a failed creation.
3. **Rank a parent** with the existing `rankCandidates`, over the workspace's
   stories, using the composed title and description as the query. Empty result →
   `STORY` under `defaultEpicId` (D8).
4. **Resolve required fields.** `due_date` is required by the server; it comes
   from `dueDateOffsetDays` (default 7) added to today. `priority` from
   `defaultPriority` (default `MEDIUM`). `status` is `BACKLOG` — the item is not
   claimed to be in progress just because a branch exists.
5. **Create** via the existing io-client path.
6. **Register the link.** `POST /workspaces/work-items/<id>/git-links` with
   `https://github.com/<repoFullName>/tree/<branch>`. A failure here is logged
   and the record is still marked `created` — the item exists and matters more
   than the link, and `branch-adopt` can repair it.
7. **Store** `created`, then `api.notifications` with the item key, title, chosen
   parent, and due date, so a wrong guess is visible immediately rather than at
   sprint review.

## 12. Configuration

Added to the workspace plugin's `config` block:

| Key | Default | Purpose |
|---|---|---|
| `branchLink.enabled` | `false` | Off until deliberately turned on. |
| `branchLink.repoMap` | `{}` | `repoFullName` → workspace key. One entry today. |
| `branchLink.defaultEpicId` | none | Fallback parent for the `STORY` path (D8). |
| `branchLink.dueDateOffsetDays` | `7` | The server requires a due date. |
| `branchLink.defaultPriority` | `MEDIUM` | |
| `branchLink.protectedBranches` | `main,master,staging,develop` | |
| `branchLink.draftTtlDays` | `14` | |

The CLI's own config (TARDIS URL, password, log and queue paths) lives on the
laptop at `~/.tardis-branch-link/config.json`, mode 600, written by the
installer. It is not in this repo and not in the io repos.

## 13. Handoff — server change

Delivered as `docs/handoff/2026-09-06-git-link-head-ref-match.md`.

**Change:** in `WorkspaceGitLinkService`'s `pull_request` handling, when
key-parsing yields no matches, fall back to looking up an existing `branch` link
in the same repo for the PR's head ref, and use its `work_item_id`.

The lookup is deterministic, not a scan: branch links are stored with
`number: hashStringToInt32(branch)`, so the head ref hashes to the same value and
the existing `@@unique([work_item_id, provider, repo_full_name, number, kind])`
index does the work.

**Constraints the change must respect**, all documented in the existing code and
easy to break:

- `linked_by_account_id` is `null` for auto-detected and non-null for manual, and
  a webhook refresh must **never** overwrite a manual link back to `null`.
- The handler must not throw; GitHub disables endpoints that keep failing.
- The work must stay inside the existing transaction, with automation events
  fired after commit on the root client.

### Also required, and configuration only

- `GITHUB_WEBHOOK_SECRET` set on the server.
- A webhook on each repo → `POST /workspaces/git/webhook`, events `push` and
  `pull_request`.
- One automation rule per workspace: `PR_MERGED` → `MOVE_STATUS: DONE`.

## 14. Handoff — coding agent instructions

Delivered as `docs/handoff/2026-09-06-agent-branch-conventions.md`, to be pasted
into each io repo's `CLAUDE.md`.

Under D1 the branch name and commit messages *become* the work item's text. That
turns them from style preference into an interface, and the instructions say so:
branch names describe the change rather than the file touched; commit subjects
are meaningful on their own; the first push of a branch is the moment the task is
created, so it should not happen with a single `wip` commit.

## 15. Testing

**Hook semantics** — a script driving a real scratch repo, because these are the
behaviours that look right and are not:

- `git checkout -b` fires; `git checkout <existing>` does not (the reflog check);
- `git checkout -- <path>` does not fire (`$3 = 0`);
- a protected branch does not fire;
- `pre-push` consumes stdin and the push still succeeds;
- a deleted ref does not fire;
- both hooks return 0 when the CLI is absent entirely.

**CLI** — `bun test`: queue-on-failure, token caching and expiry, no stdout.

**Plugin** — `bun test` with a faked io-client and a faked `generate`:

- second `branch-create` for the same branch creates nothing;
- `generate` throwing still produces an item, via the fallback title;
- empty ranker result produces a `STORY` under the epic, not a parentless
  `SUB_TASK` (which the server would reject);
- missing `defaultEpicId` with an empty ranker fails cleanly and records `failed`,
  rather than creating something wrong;
- git-link failure still leaves the item `created`.

## 16. Out of scope, worth doing separately

Three defects found while reading a real session transcript. None are caused by
this design, and one is worked around by it (§11.4):

1. **The plugin never exposed labels.** `workspace_labels` and
   `workspace_work_item_labels` have existed all along; the model correctly
   reported that it had no label field, having checked, and was wrong about the
   server as a result.
2. **`my-items` returns `truncated: true` while showing all items** — observed as
   `count: 9, showing: 9, truncated: true`. The model read that as "there is
   more", called again, and stopped itself with "I was repeating the same
   action."
3. **`draft-commit` fails on a missing due date instead of asking for it.**
   `blockingSlots` should surface `due_date` as a blocking slot; instead the
   commit fails with `Workspace: A work item needs a due date to be created`.
