# Handoff — a manually-created git link shows as the bare repo name

**Repo:** `internal-operation-server` (and optionally `internal-operation-website`)
**Base:** `origin/staging`
**Related:** PR #582 `feat/git-link-head-ref-match`, already merged — same file.
**Not in scope:** TARDIS. The change is entirely server-side.

---

## What happens

A work item created from a git branch shows this in its **Linked work** panel:

```
taj-alsafa/internal-operation-app        Added manually
```

It should name the branch. Observed on a real item, `RD-TEA-1222`, whose link
points at `https://github.com/taj-alsafa/internal-operation-app/tree/feat/attachment-link-size-limit`.

The link itself is correct — clicking it opens the branch. Only the **label** is
wrong, and it is wrong in a way that makes several links to different branches
in the same repo indistinguishable from each other.

## Why

`work-item-git-links.tsx:88` renders:

```ts
const label = link.title ?? gitLinkFallbackLabel(link);
```

and `features/workspaces/lib/git-links.ts:60`:

```ts
export function gitLinkFallbackLabel(link) {
  return link.kind === 'pull_request'
    ? `${link.repoFullName}#${link.number}`
    : link.repoFullName;          // branch AND commit both land here
}
```

So the label is only as good as `title`. And `upsertLinkFromManualLink`
(`workspace-git-link.service.ts`, ~line 391) writes:

```ts
create: {
  ...identity,
  url: params.url,
  title: null,          // ← here
  ...
}
```

The webhook path (`upsertLinkFromWebhook`) sets `title` to the branch name, so
webhook-created branch links display correctly. The manual path never sets one —
its own docblock says as much:

> *"the manual route (which is how a branch-created item gets its link) never
> sets it at all"*

TARDIS creates its branch links through the manual endpoint
(`POST /workspaces/work-items/:wid/git-links`, body `{ url }`), because that
endpoint takes a URL and lets the server do the GitHub-shape parsing. There is
no title field on the DTO and there should not be — the server already knows the
branch name.

## The fix

`parseGitHubUrl` already returns exactly what is needed. `createManualLink`
calls it to get `kind` and `number` for the identity key, so the parsed value is
in hand at the point of the write:

```ts
{ repoFullName, kind: 'branch', number: hashStringToInt32(branch), refOrSha: branch }
```

**On create**, derive `title` from it instead of writing `null`:

| kind | suggested title |
|---|---|
| `branch` | `refOrSha` — the branch name |
| `commit` | `refOrSha.slice(0, 7)` — the short sha |
| `pull_request` | leave `null`; the existing fallback already renders `owner/repo#123`, and a real PR title arrives from the webhook |

**On update, change nothing.** The current behaviour is deliberate and correct:
title/state/author_login are left alone so a webhook that already enriched this
same identity is not blanked back to null. A manual re-link must not downgrade a
row the webhook improved.

## Invariants not to break

These are all load-bearing and all currently correct:

1. **`linked_by_account_id` on the manual path is always (re-)claimed by the
   acting account.** A human explicitly linking takes attribution even over an
   existing auto-detected link. Do not change this while you are in the function.
2. **The webhook path must never overwrite a manual link's attribution back to
   `null`.** Separate function; just do not "tidy" the two together.
3. **The head-ref confirm reads `url`, not `title`.**
   `resolveItemsForHeadRefBranchLink` re-parses the stored URL to guard against
   an FNV-1a hash collision, and its comment explicitly says title cannot be used
   for this because the manual route does not set it. **That comment becomes
   stale with this change** — but do NOT switch the confirm to use `title`:
   `url` remains the authoritative value, and rows created before this change
   still have `title: null`. Update the comment; leave the logic alone.
4. **The `git_link_identity` unique key is unchanged.** Title is not part of it.

## Tests worth adding

- A manual branch link stores the branch name as its title.
- A manual commit link stores a short sha.
- A manual re-link of a row the webhook already titled does **not** blank the
  title.
- A manual link whose URL has a branch containing `/`
  (`feat/attachment-link-size-limit`) keeps the whole branch name, not the first
  segment.
- Existing head-ref match specs still pass — that path must be untouched.

## Optional, website side

Even with the server fix, rows created before it still have `title: null`. A
one-line improvement to `gitLinkFallbackLabel` covers those and makes the client
robust on its own:

```ts
// derive from the URL for branch/commit rather than falling back to the repo
```

This is cosmetic and independent — worth doing, not worth blocking on.

## What this does not cover

**Commits are not linked at all** for a branch-created item, and that is not
this bug. `handlePushEvent` links a commit only when its message contains an item
key, and an item created from a branch has no key at commit-writing time — it did
not exist yet. There is no head-ref fallback for commits, only for pull requests.

That gap is being closed on the TARDIS side, where the commit shas are already
known at creation time, by registering them through this same manual endpoint.
Nothing is needed from this repo for it — but it does mean the `commit` row of
the table above will start being exercised.

**Pull requests already work.** `handlePullRequestEvent` resolves a PR to a
branch-created item through the head-ref fallback from PR #582, and the webhook
sets a real title. No change needed.
