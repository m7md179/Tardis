# Connecting branch-linked work items to GitHub

Everything in TARDIS and on the internal-operation server is built. This is the
wiring that makes them meet: five steps, each with a way to check it worked
before moving on.

The flow once it's on:

```
git checkout -b feat/x   →  TARDIS records a draft (nothing on the board)
git push                 →  work item created, titled from your commits
gh pr create → merge     →  GitHub webhook → PR_MERGED rule → item moves to Done
```

---

## Before you start

| Requirement | How to check |
|---|---|
| io server running code with the head-ref match (PR #582) | `git log --oneline origin/staging \| grep head-ref` → `86a91f9c` |
| The io server is reachable **from the public internet** | GitHub has to POST to it. A LAN-only address cannot receive webhooks. |
| **TARDIS deployed with THIS branch's plugin** | `/skills` in the TUI lists `workspace.branch-status`. If it does not, the branch is not deployed and nothing below will work — the settings in step 1 will not exist either |
| `bun` on your PATH | `command -v bun` |

If the server isn't publicly reachable, steps 3–5 can't work yet and you'll get
the first half only: branches become work items, but merging won't close them.
That half is still useful, and the rest can be added later without redoing it.

---

## Step 1 — Turn on branch linking in TARDIS

**There is no settings screen for this.** The server exposes
`GET`/`PUT /api/plugins/:name/config` (`app.ts:526`, `:546`), but nothing in the
web UI or the TUI calls it — `web-ui/src/pages/plugins.tsx` lists plugins and
stops there. Set the values over the API.

Get a token, then send only the keys you are changing — the endpoint merges with
what is stored, so your credentials do not need resending:

```bash
TARDIS=https://your-tardis.example.com

TOKEN=$(curl -s -X POST "$TARDIS/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"password":"YOUR_TARDIS_PASSWORD"}' | jq -r .token)

curl -s -X PUT "$TARDIS/api/plugins/workspace/config" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "values": {
      "branchLinkEnabled": true,
      "branchLinkDefaultEpicId": 80,
      "branchLinkDueDateOffsetDays": 7,
      "branchLinkDefaultPriority": "MEDIUM",
      "branchLinkDraftTtlDays": 14
    }
  }' | jq
```

Replace `80` with the epic that should catch branches matching no story.

The response includes **`"restartRequired": true`**, and it means it: a plugin
reads its settings at activation, so **restart TARDIS** or the new values change
nothing. That is the step most likely to be skipped here.

Read the values back with `GET /api/plugins/workspace/config` — secrets come
back masked, the rest as stored.

<details>
<summary>Or edit the config file directly on the host</summary>

Settings live at `plugins.workspace` in `~/.tardis/config.json`
(`/root/.tardis/config.json` in the container). Add the same keys there and
restart. Note that `scripts/deploy.sh` copies your local config over the
container's, so a value set only on the container is lost on the next deploy.

</details>

It defaults to **off** deliberately: an installed hook can call TARDIS the
moment it lands, and this is the switch that stops it creating anything.

**Fallback epic id matters more than it looks.** When no story matches a branch,
the item is created as a `STORY` under this epic rather than as a parentless
`SUB_TASK` the server would reject. Leave it at `0` and those branches fail
instead — visibly, in `branch-status`, but they fail.

**Check it:** ask TARDIS "what branches do you know about" → an empty list, not
an error.

---

## Step 2 — Install the git hooks

From the TARDIS repo:

```bash
./scripts/branch-link/install.sh \
  /c/projects/internal-operation-server \
  /c/projects/internal-operation-website \
  /c/projects/internal-operation-app
```

It asks once for your TARDIS URL and password and writes
`~/.tardis-branch-link/config.json` at mode 600.

Worth knowing:

- **Worktrees are covered automatically**, including ones created later — 475 of
  them across the three repos at the time of writing.

  This took a second attempt. An earlier version of this guide claimed worktrees
  were covered because they share the parent's hooks. That is true of a repo
  using `.git/hooks`, and false of a husky repo: husky sets `core.hooksPath` to
  the **relative** path `.husky/_`, git resolves a relative hooksPath against
  each working tree's own root, and `.husky/_` is gitignored — generated only
  where `npm install` ran. Every worktree therefore looked for hooks in a
  directory that did not exist and ran none, silently. Husky's own `pre-commit`
  had never fired in a worktree either.

  The installer now points `core.hooksPath` at an absolute directory under
  `~/.tardis-branch-link/hooks/`. That value lives in `.git/config`, which every
  worktree shares, so there is nothing to install per worktree and nothing to
  remember when you make a new one.
- **Your teammates are not affected.** The io repos use husky, so the hooks land
  in `.husky/` — which is committed — and the installer adds them to
  `.git/info/exclude`, which is local and never pushed.
- **It refuses to overwrite a hook it didn't write.**

**Check it:**

```bash
cd /c/projects/internal-operation-server
git checkout -b feat/branch-link-smoke-test
cat ~/.tardis-branch-link/branch-link.log   # → "draft ... -> ok"
```

Then ask TARDIS what branches it knows about — `feat/branch-link-smoke-test`
should be there, *waiting for a push*. Nothing is on your board yet.

To undo: `./scripts/branch-link/install.sh --uninstall <repo>...`

---

## Step 3 — Give the server a webhook secret

Generate one and set it on the io server:

```bash
openssl rand -hex 32
```

Set `GITHUB_WEBHOOK_SECRET` in the server's environment and restart it. Keep the
value — step 4 needs the same string.

Without it the endpoint answers **503 on purpose** rather than accepting a
payload it cannot verify.

---

## Step 4 — Add the webhook on each repo

GitHub → repo → Settings → Webhooks → Add webhook:

| Field | Value |
|---|---|
| **Payload URL** | `<io base url>/workspaces/git/webhook` |
| **Content type** | `application/json` — **not** form-encoded |
| **Secret** | the string from step 3 |
| **Events** | *Let me select individual events* → **Pushes** and **Pull requests** |

The base URL is the same one in the workspace plugin's `baseUrl` setting.

**Content type is not cosmetic.** The signature is an HMAC over the raw request
bytes; `application/x-www-form-urlencoded` wraps the payload in a `payload=`
field and verification fails on every delivery.

**Check it:** GitHub shows a ping delivery immediately. Open Recent Deliveries.

- **200** — good.
- **401** — the secret doesn't match step 3.
- **503** — `GITHUB_WEBHOOK_SECRET` isn't set, or the server wasn't restarted.

---

## Step 5 — The rule that moves it to Done

In the workspace's **Automation** panel, add a rule: trigger **PR merged**,
action **Move status → Done**, and **enable it**.

Or via the API:

```bash
curl -X POST "<io base url>/workspaces/<workspace id>/automation/rules" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <api key>" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Merged PR closes its task",
    "trigger_type": "PR_MERGED",
    "action_type": "MOVE_STATUS",
    "action_config": { "to_status": "DONE" },
    "enabled": true
  }'
```

**`"enabled": true` is required.** Omit it and the rule is created **disabled**
— deliberately, so a new rule can't start acting on live data before you've read
it. A disabled rule looks identical in a list and simply never fires, which is
the failure you'd spend an afternoon on.

---

## The end-to-end check

```bash
cd /c/projects/internal-operation-server
git checkout -b feat/branch-link-live-test
echo "test" >> README.md
git commit -am "Check that a branch becomes a task"
git push -u origin feat/branch-link-live-test
```

Then:

1. `~/.tardis-branch-link/branch-link.log` → `push ... -> ok`
2. A new item on your board, titled from your commit rather than the branch name
3. Its **Linked work** panel shows the branch
4. Open a PR and merge it → the item moves to **Done**

Then clean up the test item and branch.

---

## When something doesn't happen

Nothing here ever blocks a git command, which is the point — and also why
failures are quiet. `~/.tardis-branch-link/branch-link.log` is the first place
to look, and `workspace.branch-status` is the second.

| Symptom | Likely cause |
|---|---|
| Log says `refused` | Branch linking is off (step 1), or TARDIS is in read-only mode |
| Log says `queued` | TARDIS was unreachable. The next branch you create ships it — the queue drains on every hook run |
| No log line at all | Hook not installed, or `bun` wasn't on PATH when you installed |
| `branch-status` shows **failed** | It names the reason. Usually no matching story and no fallback epic |
| Item created, no Linked work | The item is kept when only the link fails. Repair with `branch-adopt` |
| Merged PR didn't move to Done | Step 5 rule disabled; or the webhook isn't delivering (step 4); or the branch was pushed before step 2 so no link exists |
| Hook fails with `/bin/sh^M` | The checkout got CRLF endings. `.gitattributes` pins LF — re-clone or `git add --renormalize` |

Nothing needs a task to exist beforehand, and nothing needs an item key in the
branch name. Push the branch and the item follows.
