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
