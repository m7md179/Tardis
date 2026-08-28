# Workspace Plugin — Local Setup & Verified Behaviour

Everything here was confirmed by running it against a live local
`internal-operation-server` on 2026-08-27, not read off the source. Where a claim
came from a request, the request is shown.

**No credentials in this file.** This repo is on GitHub.

---

## 1. Point at the plain-HTTP port, not HTTPS

The IO server listens twice (`src/main.ts:57-69`):

| Port | Protocol | Use it? |
|---|---|---|
| 3080 | HTTP | **yes** |
| 3010 | HTTPS | no |

The HTTPS listener uses `ssl/server.crt`, which is `CN=13.60.180.11` (an old
production IP), carries **no SAN**, and **expired 2026-04-04**. Bun's `fetch`
rejects it outright:

```
THREW: certificate has expired
```

That is not fixable by trusting the cert locally — with no SAN it would never
validate for `localhost` anyway. Plain HTTP on 3080 avoids the problem entirely
and needs no change to `internal-operation-server`, which keeps the design spec's
"that repo ships nothing" constraint intact.

```
baseUrl = http://localhost:3080
```

## 2. Four config keys, all required

| Key | Where to get it |
|---|---|
| `baseUrl` | `http://localhost:3080` |
| `email` | your local IO account |
| `password` | your local IO account |
| `apiKey` | `API_KEY` in `internal-operation-server/.env` |

Then restrict the data directory, because it now holds two secrets:

```bash
chmod 600 <tardis-data-dir>/tardis.db
```

### `apiKey` is not optional

`APIKeyGuard` is a global `APP_GUARD` (`src/app.module.ts:203`). Every route
rejects a request without a matching `x-api-key` header — **including
`POST /account/login`**, which looks public. Only paths containing `heartbeat`
are exempt (`src/utils/guards/key.guard.ts:15`).

```
POST /account/login  without x-api-key  ->  403 Forbidden resource
POST /account/login  with    x-api-key  ->  400 invalid credentials
```

The failure is misleading: without the key every call returns an identical 403,
and a 403 on login reads as a wrong password. `IoClient` therefore refuses to
construct without one, so this surfaces once at activation rather than on every
call.

## 3. Use a *user* account, not an admin account

```
POST /workspaces/:id/work-items  {"assignee_account_ids":[<admin id>]}
  -> 400  "Admin accounts cannot be added as workspace members or assignees"
```

An admin can create and read everything, but **cannot be an assignee or a
member**. Consequences if you configure the plugin with an admin account:

- `workspace.my-items` is permanently empty.
- Nothing can be assigned to you, so the draft flow in Plan 2 has no useful
  default assignee.
- `my_settings` is always `null`, so the restricted-member code paths never run
  and stay unexercised.

Configure the plugin with the ordinary user account you actually work as.

## 4. Verified wire behaviour

Run against workspace `TARDIS` (id 1) seeded with EPIC 1 → STORY 2 → SUB_TASK 3.

### Envelopes

| Endpoint kind | Envelope |
|---|---|
| Most | `{ data, status, message }` |
| Some lists (e.g. `GET /workspaces`) | `{ data, status, message, totalCount }` |

`IoClient.request()` reads `.data` only, so the extra key is harmless — but
`totalCount` means pagination exists at the envelope level even where the query
DTO has no `take`/`skip`.

### `assignees` has three shapes

| Response | `assignees` |
|---|---|
| `POST .../work-items` (create) | **`null`** |
| `GET .../board`, list endpoints | `[]` or populated array |
| `GET /workspaces/work-items/:id` | array |

Populated entries are exactly:

```json
{ "account_id": 4, "first_name": "TMS User 3", "last_name": "Seed", "email": "tms-large-3@ctms.local" }
```

The `null` on create is a real crash source — reading back an item you just
created and calling `.length` on it throws. `types.ts` declares
`Assignee[] | null` and both consumers coalesce.

### `my_settings` is snake_case

Confirmed on the wire:

```
my_role = "ADMIN" | my_settings = null
```

No camelCase interceptor exists. `null` means ADMIN **or** LEAD — unrestricted,
not "not a member". A camelCase mirror would read `undefined` for every rule
field; `permissions.ts` fails closed so that shows up as everything-denied rather
than everything-allowed.

### Members payload

`GET /workspaces/:id/members` items carry:

```
account, account_id, act_own_only, created_at, hidden_tabs, id,
own_items_only, revoked_capabilities, role, transition_grants, workspace_id
```

`account` nests `{ id, first_name, last_name, email }`. There is no single
display-name field, which is why `format.ts` composes one.

### `?q=` is a whole-phrase substring match

Against an item titled **"Rate-limit the login endpoint"**:

| `q` | Matches |
|---|---|
| `rate` | 1 |
| `Rate-limit` | 1 |
| `rate limit` | **0** |
| `login` | 2 |
| `LOGIN` | 2 |

Case-insensitive, but not token-aware: `"rate limit"` does not match
`"Rate-limit"`. This is the empirical case for D4 — server-side `q` alone cannot
do "closest to what I described", because the words you use are rarely the exact
substring in the title.

### Server-side rules the plugin must respect

| Rule | Error |
|---|---|
| EPIC may not have a parent | `400 Epic items cannot have a parent` |
| A work item needs a description before it can enter To Do | `400` |
| Admin cannot be assignee/member | `400` |

The description rule is **not** in the design spec's slot model, which treats
`description` as optional-but-prompted. It is required for any status other than
`BACKLOG`, and Plan 2's draft state machine must enforce it before commit.

## 5. Reproducing the verification

A throwaway harness that drives the real `IoClient` against the live server is
the fastest way to re-check all of the above after a change. It logs in, lists
workspaces, reads the board, backlog, one item, sprints and members, and then
corrupts the stored token to prove the 401 → re-login path:

```
  [info] Workspace: authenticated
PASS  login -> account id 2
PASS  listWorkspaces -> 1
PASS  my_settings is null for an admin (unrestricted)
PASS  board has all five columns
PASS  getBacklog -> 3
PASS  getItem(3) -> Rate-limit the login endpoint
PASS  getMyItems -> 0 (admin cannot be an assignee, so 0 is expected)
PASS  getMembers -> 1
  [debug] Workspace: token rejected, logging in again
  [info] Workspace: authenticated
PASS  recovered from a bad token -> 1 workspaces
```

The 401 recovery is worth re-running deliberately: access tokens live 24 h, so in
normal use that path fires roughly once a day and a regression in it would go
unnoticed until the next morning.

---

## 6. Wiring TARDIS and the TUI to it

Done and verified 2026-08-27. The whole chain runs:

```
TUI  →  TARDIS /api/skills/:id/invoke  →  ToolRouter  →  workspace plugin
     →  PluginAPI.http  →  internal-operation server  →  back
```

### There is more than one IO server running locally

This bit costs an hour if you do not know it. Two backend processes, **two
different databases**:

| Port | Protocol | Database | Notes |
|---|---|---|---|
| 3080 | HTTP | `internal-operation` | main checkout; `super-admin` is account **2** |
| 3000 | HTTPS | `internal-operation` | same process as 3080 |
| 3010 | HTTPS | `internal-operation-local` | `wt-analytics-server` worktree; `super-admin` is account **1** |

Accounts do **not** exist across both. An account that logs in on 3010 gets
`invalid credentials` on 3080, which looks like a wrong password and is not.

`wt-analytics-server` reads `HTTP_PORT` (default 3080) and `HTTPS_PORT`
(default 3000). Both defaults were already taken by the other instance, so its
plain-HTTP listener never bound and it is reachable only over HTTPS on 3010 —
with the expired cert from §1. To give it a usable HTTP port, restart it with
`HTTP_PORT=3011`; no file changes are needed, the code already reads it.

The plugin currently points at **3080**.

### The data directory

`packages/server/src/index.ts:73` loads plugins from `<dataDir>/plugins`, **not**
from the repo's `plugins/`. `scripts/deploy.sh:74` symlinks each repo plugin into
place; on Windows a directory junction does the same job without needing admin:

```powershell
cmd /c mklink /J "C:\Users\<you>\.tardis\plugins\workspace" `
                 "C:\Users\<you>\tardis\repo\plugins\workspace"
```

The junction matters for module resolution: the plugin imports `@tardis/core`,
which only resolves because the real path is inside the repo's workspace.

### config.json

At `<dataDir>/config.json`. Required blocks and the traps in them:

| Key | Note |
|---|---|
| `llm.provider`, `llm.model` | required — `loadConfig` rejects a config without them |
| `auth.jwtSecret` | required, minimum 32 characters |
| `auth.adminPassword` | **nested under `auth`**, not top level. At the top level it is silently ignored and every API login returns `Invalid password`. |
| `server.port` | default 3000 collides with the IO server's HTTPS listener — set something free, e.g. 3020 |
| `plugins.workspace` | `baseUrl`, `email`, `password`, `apiKey`, `defaultWorkspaceKey` |

`chmod 600` it — it holds an IO password and the API key.

### Running it

```bash
# server
cd <repo>
TARDIS_DATA_DIR="C:/Users/<you>/.tardis" bun run packages/server/src/index.ts

# TUI, from tardis-app
cd apps/tui
TARDIS_URL=http://127.0.0.1:3020 TARDIS_PASSWORD=<auth.adminPassword> bun run src/index.ts
```

Startup should say `Loaded 1 plugin(s): [ "workspace" ]`. Only junctioned plugins
load, so the repo's other seven are absent until they are junctioned too.

### What was verified

`GET /api/skills` serves all nine skills with their descriptors. Invoking
`workspace.list-workspaces` through `POST /api/skills/:id/invoke` returns the
TARDIS workspace, which means the method-dispatching `httpAdapter` works — the
login POST would have been silently downgraded to a GET by a bare
`api.http.get`.

In the TUI, `/skills` → `3` renders:

```
Board
  Authentication hardening
    MEDIUM · BACKLOG
  Protect the login endpoint
    MEDIUM · BACKLOG
  Rate-limit the login endpoint
    HIGH · TODO · 3 pts · 4h · due 2026-09-04 · TMS User 3 Seed
```

Nothing in the TUI knows what a work item is. That came entirely from the skill's
`ui` descriptor, which is the contract behaving as designed.

### Two limits of this setup

**No LLM is running.** Ollama is not listening on 11434, so the chat path cannot
work — only `/skills`, the direct no-AI path, does. That path is the whole of
Plan 1; the AI path needs a provider configured before it is worth testing.

**The configured account is an admin.** Admins cannot be assignees or workspace
members, so `workspace.my-items` is permanently empty and `my_settings` is always
`null`. Fine for reads; Plan 2's draft flow needs an ordinary user account on
whichever database the plugin points at.

---

## 7. Plan 2 verification — drafts, ranking and writes

Run 2026-08-28 against the live `wt-analytics-server` on `https://localhost:3010`
(DB `internal-operation-local`), as a **non-admin** account. That matters: §3's
admin limitation meant the whole assignee half of this was previously
unexercisable. As a MEMBER, `getMyItems` returned **110** items where the admin
account returned 0.

### What passed

| Check | Result |
|---|---|
| Login as a non-admin | account 100, `my_role="MEMBER"` |
| `my_settings` parsed | real payload, 20 transition grants, all capabilities allowed |
| `searchItemsByType` | 15 epics, 59 stories |
| Draft question order | type → title → parent, and it says "story" for a SUB_TASK |
| Description gate | fires **locally** before any request |
| Full write cycle | create #439 → get → move TODO→BACKLOG → comment → delete |
| `isMine` | true for an item this account reported |
| EPIC-with-parent | refused locally, and `parent_id` stripped from the payload |
| `delete-item` via the API | `APPROVAL_REQUIRED`, item untouched |

### Correction to §4: `assignees` is absent, not null

§4 says create returns `assignees: null`. Against this server it is **absent
entirely** — `undefined`, not `null`. Both are handled (`item.assignees ?? []`),
so nothing breaks, but the accurate statement is: **do not rely on `assignees`
existing on a create or update response.** Only list, board and detail responses
carry it.

### Ranking: what real data exposed

Synthetic fixtures made the ranker look better than it was. Against 15 real
epics, a query about login rate limiting returned:

```
Contractor Module, Contractor Agreement, R&D System Development, ...
```

Two separate faults, both now fixed:

**Subsequence noise.** `fuzzyScore`'s third tier scores "are the needle's
characters present in order", so `rate` scores 0.188 against
`Cont`**`ra`**`c`**`t`**`or modul`**`e`**. Any four-letter token
subsequence-matches almost any longer title. Tokens now need **0.5**, which
keeps the exact (1.0) and substring (0.9) tiers and discards the third.

**Arbitrary fallback.** An empty shortlist means "the query had real tokens and
none matched" — an answer. The code treated it as failure and returned the first
three items in the workspace as candidates. It now returns nothing, so the
question is still asked but without a misleading shortlist. `prefilter` still
returns everything when the query carried no usable tokens at all, which is the
genuinely-no-opinion case and a different thing.

After both fixes, the same query returns `[]` — correct, because this workspace
has no authentication epic.

### The honest limit: no LLM was available

Ollama is not running, so `rankCandidates` fell back to the fuzzy order on every
call. **The LLM re-rank has never been executed against real data.** Everything
above measures the prefilter alone. The re-rank's own failure paths are covered
by unit tests with a stubbed model — fences, invented ids, non-JSON, throws — but
whether a local model actually improves the ordering is untested and unknown.

That matters most for the case the design was built for: wording that shares no
words with the right epic. The prefilter cannot solve that by construction, and
the re-rank is the part meant to. Configure a provider before trusting D4.
