# Workspace Plugin — Design Spec

**Date:** 2026-08-27
**Status:** Design, approved in outline; not yet implemented
**Repos touched:** `Tardis`, `tardis-app`
**Repos deliberately untouched:** `internal-operation-server`, `internal-operation-website`

---

## 1. What this is

A TARDIS plugin that turns the internal-operation **Workspaces** module — the team's
agile PM system — into something you drive by describing work in plain language, and by
pressing buttons when you'd rather not talk.

You say *"I need to add rate limiting to the login endpoint"*. The plugin figures out
which epic and story that belongs under, asks you only what it genuinely cannot infer,
and creates a properly-parented sub-task with points, an estimate, a due date, a
priority and assignees. Then it moves items across the board on request.

The same skills that the agent calls are invocable directly from the TUI and the web
app, with no LLM in the path. That is not a second implementation — it is the same
door, which is the point.

### Success criteria

1. From a cold start, one sentence of description produces a correctly-parented work
   item in the internal-operation database, with every field you'd have filled in by
   hand on the website.
2. Every skill the agent can call is also reachable as a button/command in the TUI and
   web app, with identical behaviour and identical validation.
3. The plugin never offers you an action the server would reject — it reads your
   per-workspace permissions and shows only what you can actually do.
4. `internal-operation-server` and `internal-operation-website` ship zero changes.

---

## 2. The two systems

### TARDIS

Time And Resource Documentation & Insight System. Bun + TypeScript monorepo. Relevant
subsystems, all of which already exist and are load-bearing:

| Subsystem | Where | What it gives us |
|---|---|---|
| Plugin runtime | `packages/core/src/plugins/` | Manifest validation, permission guard, sandboxed `PluginAPI` |
| Agent loop | `packages/core/src/agent/agent-loop.ts` | reason→act→observe, bounded steps, tool errors fed back as observations |
| `clarify` pseudo-tool | `packages/core/src/agent/clarify.ts` | Ends the turn and asks the user one question |
| Graded permissions | `packages/core/src/agent/permissions.ts` | `allow` / `ask` / `deny`, glob rules, config may only tighten |
| Skill contract | `SKILLS.md` | `GET /api/skills`, `POST /api/skills/:id/invoke` |
| UI contract | `UI-CONTRACT.md` | Five blocks, ten field types, `custom` escape hatch |
| Plugin LLM | `PluginAPI.llm.generate` | Text-in/text-out, never sees your chat history |

`PluginAPI.http` is fully implemented — real `fetch`, gated only on the `http:external`
permission, with no host allowlist. Nothing blocks outbound calls to the IO server.

### Workspaces (internal-operation)

NestJS + Prisma + PostgreSQL. 21 Prisma models, 57 source files under `src/workspaces/`.
The subset this plugin uses:

```
workspace                     name, key, description, status, color, lead, project_id
workspace_work_item           the thing we create and move
workspace_sprint              sprint assignment
workspace_member              role + per-member rules
workspace_work_item_assignee  the multi-assignee source of truth
```

**Hierarchy is server-enforced** (`workspace-work-item.service.ts:309-355`), and it is
the single most important constraint in this design:

| Type | Parent rule |
|---|---|
| `EPIC` | must have **no** parent |
| `STORY` | parent **required**, must be an `EPIC` in the same workspace |
| `SUB_TASK` | parent **required**, must be a `STORY` in the same workspace |

Violations return `400` with `work_item_epic_cannot_have_parent`,
`work_item_story_requires_epic_parent`, or `work_item_sub_task_requires_story_parent`.

This is why the flow you described — *"the epic and story the sub-task it's creating is
following"* — is a genuine two-step narrowing, not a single picker. To place a sub-task
you must resolve a story, and stories are grouped under epics.

**Status is a fixed five-column enum:** `BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`,
`DONE`. Priority is `LOW`, `MEDIUM`, `HIGH`, `URGENT`.

---

## 3. Decisions taken

Recorded so a future reader knows what was chosen deliberately versus what merely
happened.

| # | Decision | Rejected alternatives |
|---|---|---|
| D1 | One spec covering all four subsystems (auth+read, writes, drafting, surfaces) | Incremental A→B→C→D specs |
| D2 | Plugin stores email + password, logs in and refreshes unattended | Paste-a-token; new personal-token endpoint on IO; device-code pairing |
| D3 | The plugin owns a real **Draft** object in its own storage | Stateless LLM-driven slot filling; client-owned drafts |
| D4 | Parent candidates: fuzzy prefilter → LLM re-rank → top 3 + escape hatches | Fuzzy only; server `?q=` only; LLM over the full list |
| D5 | Extend the UI contract with one generic field type; use the existing `custom` hatch only for the board view | Pure escape hatch; hardcoded per-surface workspace mode; add a `board` block to the contract |
| D6 | Develop against a local IO server, flip to prod when proven | Prod-with-scratch-workspace; prod unrestricted |
| D7 | Approve destructive actions and writes to other people's items; everything else direct | Approve all writes; approve deletes only; approve draft-commit only |

D7 has a consequence worth flagging here rather than burying in §9: `actionType` is
static and `resolvePermission` grades by tool name, so "ask only when the item is
someone else's" cannot be expressed as configuration. The condition becomes a **skill
boundary** instead — a restricted `direct` skill and an unrestricted `workflow` twin.

---

## 4. Architecture

```
┌─ Tardis (CT 106) ───────────────────────────────────────────┐
│                                                             │
│  agent-loop ──┬─ clarify (asks, holds no state)             │
│               │                                             │
│               └─ ToolRouter ──┐                             │
│                               │                             │
│  POST /api/skills/:id/invoke ─┤  (no LLM — TUI/web path)    │
│                               │                             │
│                               ▼                             │
│                    plugins/workspace/                       │
│                      index.ts    dispatch                   │
│                      draft.ts    slot state machine   ◄── holds state
│                      ranking.ts  fuzzy + LLM re-rank        │
│                      io-client.ts auth + typed calls        │
│                      format.ts   → human-readable text      │
│                               │                             │
└───────────────────────────────┼─────────────────────────────┘
                                │ HTTPS, Bearer JWT
                                ▼
                  internal-operation-server  (unmodified)
                  POST /account/login
                  GET/POST/PATCH /workspaces/**
```

### File layout

```
Tardis/
  plugins/workspace/
    manifest.json      skills, ui descriptors, permissions, config keys
    index.ts           onActivate / onDeactivate / executeTool dispatch — thin
    io-client.ts       auth lifecycle + typed IO API calls
    draft.ts           the Draft state machine — no HTTP, no LLM
    ranking.ts         candidate ranking — no HTTP
    format.ts          items/boards → text for chat surfaces
    types.ts           IO payload types, hand-mirrored
  packages/shared/src/schemas/plugin.ts    + one field type
  UI-CONTRACT.md                            + the new field type documented

tardis-app/
  packages/ui-contract/src/index.ts   mirror the field type
  packages/core/src/bindings.ts       resolve it
  apps/web/src/components/blocks.tsx  render it
  apps/web/src/screens/WorkspaceBoard.tsx   custom.web board
  apps/tui/src/render.ts              render it as a numbered prompt
```

Existing plugins are single-file. This one is split because `draft.ts` and `ranking.ts`
hold all the logic worth testing, and keeping them free of HTTP and LLM calls is what
makes them testable without a network or a model. `plugin-manager.ts:130` loads the
entry point with a plain dynamic `import()`, so relative imports inside the plugin
directory resolve normally.

---

## 5. Authentication

### Why this works

`POST /account/login` takes `{ email, password }` and returns an access/refresh token
pair directly. There is no OTP on the login path — OTP is only used for account
verification and password reset. Critically, `account.service.ts` was deliberately
changed to **not** invalidate other sessions on login:

> *"Issue a fresh token pair WITHOUT invalidating other active sessions. Users can be
> logged in from multiple devices simultaneously."*

So TARDIS holding a token pair will not sign you out of the website or your phone.

### Storage split

Credentials are user-set and stable; tokens are runtime and rotating. This mirrors what
`plugins/todoist` already does.

| Store | Key | Notes |
|---|---|---|
| `config` | `baseUrl` | e.g. `http://localhost:3000` or `https://www.tajalsafainternal.services` |
| `config` | `email` | |
| `config` | `password` | plaintext at rest — see below |
| `config` | `defaultWorkspaceKey` | optional |
| `storage` | `accessToken` / `refreshToken` | |
| `storage` | `accountId` | needed to answer "is this item mine?" |
| `storage` | `currentWorkspaceId` | the working context |
| `storage` | `draft:active` | the Draft, §7 |

### Lifecycle

`ensureAuth()` wraps every request:

```
no access token          → POST /account/login
401 on a request         → refresh, retry once
refresh fails            → re-login once
login fails              → clear tokens, throw an actionable message
```

The actionable message matters: a bare `401` in a chat surface is useless. It should say
which config key to fix and whether the server was reachable at all.

### Credential risk, stated plainly

Your production password sits in TARDIS's data directory on CT 106. Mitigations:

- The admin UI does not leak it — `packages/web-ui/src/pages/plugins.tsx` renders only
  name, version, tier, summary and tool count, and never touches plugin config. The LLM
  config route already establishes a redaction precedent (`GET /api/config/llm` returns
  a redacted `apiKey`); any future plugin-config endpoint must follow it.
- Deploy must `chmod 600` the data directory. This is a step in the plan, not an
  aspiration.
- Revocation is "change your IO password". There is no narrower revoke, because there
  is no narrower credential. D2 accepted this in exchange for not modifying the server.

If this ever needs to serve teammates, D2 should be revisited in favour of a personal
API token endpoint — the `token` table already has a `token_type` enum with room for it.

### Current workspace

Every skill operates on `currentWorkspaceId` unless told otherwise. Without this, each
call needs an explicit workspace argument and the conversation becomes tedious.
`workspace.use` switches it; `defaultWorkspaceKey` seeds it on first activation.

---

## 6. Domain mapping

Your words, mapped to the API. Every field you listed has a home; none needed inventing.

| You said | `CreateWorkItemDto` field | Type |
|---|---|---|
| task name | `title` | string, required |
| description | `description` | string, markdown |
| point | `story_points` | non-negative int |
| time to finish | `estimate_hours` | int |
| due date | `due_date` | ISO 8601 |
| any other assignee than me | `assignee_account_ids` | int[] |
| priority | `priority` | `LOW`\|`MEDIUM`\|`HIGH`\|`URGENT` |
| the epic and story it follows | `parent_id` | int, + `type` |
| — | `sprint_id` | int, optional |
| — | `status` | defaults `BACKLOG` |

`assignee_account_id` (singular) also exists as a back-compat "primary". The plugin
writes only `assignee_account_ids`; the server keeps the singular in sync.

### Endpoints used

| Purpose | Call |
|---|---|
| Log in | `POST /account/login` |
| My workspaces + my permissions | `GET /workspaces` |
| Board | `GET /workspaces/:id/board` |
| Backlog | `GET /workspaces/:id/backlog` |
| Search / list items | `GET /workspaces/:id/work-items?q=&type=&parent_id=&archived=` |
| Cross-workspace assigned to me | `GET /workspaces/my-items?status=` |
| One item | `GET /workspaces/work-items/:wid` |
| Create | `POST /workspaces/:id/work-items` |
| Edit | `PATCH /workspaces/work-items/:wid` |
| Move | `PATCH /workspaces/work-items/:wid/move` |
| Delete (soft) | `DELETE /workspaces/work-items/:wid` |
| Archive | `POST /workspaces/work-items/:wid/archive` |
| Comment | `POST /workspaces/work-items/:wid/comments` |
| Sprints | `GET /workspaces/:id/sprints` |
| Members | `GET /workspaces/:id/members` |

`GET /workspaces` carries `my_settings` on each workspace, so **capabilities cost no
extra request** — the website's `use-capabilities.ts` reads it from cache for exactly
this reason.

---

## 7. The Draft

### Why the plugin owns it

`clarify` is deliberately stateless: *"the user's next message is an ordinary turn, so
no extra state is carried between them."* That is the right design for a question, and
it is exactly why something else must hold the half-built item. If nothing did, a
four-question conversation would need the model to carry every prior answer forward in
its own reasoning — which is the failure mode `clarify`'s own docstring warns about
(*"a 4B model that is unsure does not hesitate — it commits"*).

The Draft is also what makes your non-AI commands and the AI path the *same* thing: both
mutate one object, so you can start a draft by talking and finish it by typing, or the
reverse.

### Shape

```jsonc
{
  "id": "d_01J...",
  "workspaceId": 7,
  "status": "OPEN",                    // OPEN | COMMITTED | CANCELLED
  "sourceText": "add rate limiting to the login endpoint",
  "slots": {
    "type":       { "value": "SUB_TASK", "source": "inferred" },
    "title":      { "value": "Rate-limit the login endpoint", "source": "inferred" },
    "parent_id":  { "value": null, "source": "unset" },
    "description":{ "value": null, "source": "unset" },
    "story_points": { "value": null, "source": "unset" },
    "estimate_hours": { "value": null, "source": "unset" },
    "due_date":   { "value": null, "source": "unset" },
    "priority":   { "value": "MEDIUM", "source": "default" },
    "assignee_account_ids": { "value": [42], "source": "default" },
    "sprint_id":  { "value": null, "source": "unset" },
    "status":     { "value": "BACKLOG", "source": "default" }
  },
  "createdAt": "...", "updatedAt": "..."
}
```

`source` is `unset` | `inferred` | `user` | `default`. It exists so the plugin can tell
the difference between *"you told me MEDIUM"* and *"I assumed MEDIUM"* — only the latter
is worth asking about, and asking about things you already said is the fastest way to
make this unusable.

One active draft, at `storage["draft:active"]`. Single-user system; a draft list is
YAGNI. Continuity across surfaces (start on the phone, finish in the terminal) is a
free consequence.

### The loop

```
draft-start(text)
  ├─ LLM extracts what it can from text → slots marked "inferred"
  ├─ defaults applied → slots marked "default"
  ├─ compute missing[] (required-to-commit, then prompt-policy order)
  └─ return { draft, missing, candidates?, nextQuestion }

draft-set({ parent_id: 88 })          ← or any slots, any number at a time
  └─ return { draft, missing, candidates?, nextQuestion }

... repeat until missing[] is empty ...

draft-commit()
  └─ POST /workspaces/:id/work-items → real item, draft → COMMITTED
  └─ if the draft named assignees other than you:
       the item is created assigned to you, and the result carries a
       follow-up instructing workspace.assign — which is `workflow`,
       so you approve putting work on a colleague at the moment it happens
```

That last step is deliberate. You asked to be prompted for *"any other assignee than
me"*, so the draft asks — but committing must not be the thing that silently lands work
in someone else's queue. Splitting it means the approval appears on the operation that
actually warrants one, once, instead of gating every commit (§9).

**`nextQuestion` is composed by the plugin, not the model.** The plugin knows the slot
order, the hierarchy rules and the candidate list, so it writes the question
deterministically and the model's only job is to relay it through `clarify`. This is the
main defence against model quality: the conversation's structure does not depend on the
LLM at all, only its parsing of your answers.

### Slot ordering

Required to commit — server would reject without them:

1. `type`
2. `title`
3. `parent_id` — skipped entirely when `type === EPIC`

Then prompt-policy order, which stops as soon as you say "that's enough":

4. `description`
5. `story_points`
6. `estimate_hours`
7. `due_date`
8. `priority` — only if still `default`
9. `assignee_account_ids` — only if still `default`
10. `sprint_id` — only offered when the workspace has an `ACTIVE` sprint

### Parent resolution is two-stage

For `SUB_TASK`, `parent_id` must be a `STORY`. Stories are numerous and their titles are
often meaningless out of context, so the plugin narrows by epic first:

```
"which epic?"  → 3 ranked epics + "none of these" + "show all"
"which story?" → stories under that epic, ranked against sourceText
```

For `STORY`, only the epic stage runs. For `EPIC`, neither does.

If the ranked epic list is a single confident hit, the plugin **skips the question and
marks it `inferred`**, surfacing the choice in the draft summary instead. Asking a
question whose answer is obvious is the failure mode `clarify` explicitly warns about.

### Commit-time validation

The plugin re-validates hierarchy locally before POSTing — same three rules as §2. Not
because the server won't (it will), but because a local failure produces a question and
a server failure produces a stack trace in a chat window.

---

## 8. Candidate ranking

```
fetch      GET /workspaces/:id/work-items?type=EPIC&archived=exclude
prefilter  fuzzy-rank titles against sourceText → top 10
re-rank    one PluginAPI.llm.generate call → top 3, each with a one-line reason
fallback   LLM error, timeout, or unparseable JSON → fuzzy top 5, unranked
always     append "none of these" and "show all"
```

`@tardis/shared` exports `fuzzyFindOne`; this needs a top-N variant, so `ranking.ts`
owns a small `fuzzyRank(query, items, key) → scored[]` and `fuzzyFindOne` stays as-is.

The fallback mirrors `PluginRouter`, which falls back to all-plugins on LLM failure or
bad JSON. Same principle: a degraded answer beats an error.

**Hallucination guard.** The re-rank prompt returns ids, and any id not present in the
prefiltered set is discarded before the result is shown — the same defence
`skill-router.ts` uses against hallucinated plugin names. Without it the model can
invent a plausible epic id and the plugin will happily POST against it.

**"Show all" is not optional.** Ranking will sometimes be wrong, and a picker with no
escape hatch turns a wrong guess into a dead end.

**Scale.** This assumes tens of epics per workspace, and it degrades gracefully: the
prefilter caps what reaches the model, so growth costs a bigger fetch, not a blown
context window. If a workspace ever holds hundreds of epics, move the prefilter
server-side via `?q=` — the endpoint already supports it.

---

## 9. The skill surface

These are simultaneously the agent's tools and your manual commands. There is no second
list.

### Reads — all `direct`

| Skill | UI block | Notes |
|---|---|---|
| `workspace.list-workspaces` | `list` | includes your role and rules |
| `workspace.use` | `form` | switch current workspace |
| `workspace.board` | `list` + `custom.web` | the board view |
| `workspace.backlog` | `list` | |
| `workspace.my-items` | `list` | cross-workspace, assigned to you |
| `workspace.search-items` | `list` | `?q=` + filters |
| `workspace.get-item` | `detail` | one item in full |
| `workspace.sprints` | `list` | |
| `workspace.members` | `list` | `aiInvocable: false` — feeds the assignee picker |
| `workspace.list-parent-candidates` | — | `aiInvocable: false` — feeds the `remote-select` parent picker (§11) |

### Draft — all `direct`

| Skill | UI block |
|---|---|
| `workspace.draft-start` | `form` |
| `workspace.draft-set` | `form` |
| `workspace.draft-show` | `detail` |
| `workspace.draft-commit` | `action` |
| `workspace.draft-cancel` | `action` |

### Writes

| Skill | `actionType` | Why |
|---|---|---|
| `workspace.create-item` | `direct` | direct create, bypassing the draft |
| `workspace.edit-item` | `direct` | **refuses** items you are not assignee or reporter of |
| `workspace.move-item` | `direct` | status / board order; same refusal |
| `workspace.comment` | `direct` | comments are additive and reversible |
| `workspace.edit-any-item` | `workflow` | the unrestricted variant of edit + move |
| `workspace.assign` | `workflow` | the only way to put work on someone else |
| `workspace.archive-item` | `workflow` | reversible, but disruptive |
| `workspace.delete-item` | `workflow` | soft-delete; blocked by the server if it has children |

#### Why "yours" vs "anyone's" is two skills, not one

D7 draws the line at *other people's items*, but `actionType` is a static manifest
declaration and `resolvePermission` grades it by **tool name only** — neither can express
"ask, but only when the target belongs to someone else". Encoding a runtime condition
into a static field is not possible, so the condition becomes the skill boundary:

- `workspace.edit-item` / `workspace.move-item` run without asking, and **refuse** with a
  pointer to `edit-any-item` when the target is not yours.
- `workspace.edit-any-item` carries no restriction and always asks.

This is honest about the constraint rather than pretending a `direct` skill is safe. It
also keeps the fast path genuinely fast: the overwhelmingly common case is your own work,
and that case never prompts.

The same reasoning applies to assignees on creation. `workspace.create-item` and
`workspace.draft-commit` accept assignee sets that **include you and no one else**;
putting work on a colleague is always `workspace.assign`, applied after the item exists.
Without this, `draft-commit` would be a `direct` skill capable of assigning work to
anyone, which is exactly what D7 rules out.

### `aiInvocable: false` earns its place

`workspace.members` and `workspace.list-parent-candidates` exist to feed pickers. They
are useless to the agent — which resolves parents through the draft skills — and every
skill the agent *can* see costs prompt tokens. `SKILLS.md` measures tool schemas at
~1,121 tokens for 15 tools, ~78% of fixed prompt overhead, so keeping two lookup skills
out of the prompt is a real saving, not bookkeeping.

---

## 10. Permissions and approvals

Two independent layers, and conflating them would be a mistake.

### Layer 1 — the server decides what you may do

`GET /workspaces` returns `my_settings` per workspace:

```ts
{ role, ownItemsOnly, actOwnOnly, hiddenTabs, revokedCapabilities, allowedTransitions }
```

`null` means LEAD or ADMIN — unrestricted. `VIEWER` means everything denied. Otherwise a
capability is allowed unless it appears in `revokedCapabilities`, drawn from:

`create_items`, `edit_items`, `assign`, `apply_labels`, `manage_sprint_items`,
`comment`, `log_time`, `manage_checklist`, `manage_attachments`, `delete_items`

**Status transitions are individually granted.** A `MEMBER` needs an explicit
`(from → to)` edge in `allowedTransitions`; the server enforces it with a `403` in
`assertTransitionAllowed`. So *"move it any way I need"* is true if you're a LEAD or
admin in that workspace, and bounded by your grants otherwise.

The plugin caches `my_settings` per workspace for the session and **only offers legal
moves**. `workspace.move-item`'s result includes the legal target statuses, so the board
UI can grey out the rest rather than letting you drag into a `403`.

This layer is not a security boundary the plugin implements — the server enforces it
regardless. It is a UX layer: the plugin's job is to not offer what will fail.

### Layer 2 — you decide what runs without asking

`resolvePermission(toolName, declared, config.actionOverrides)` grades each skill's
declared baseline. `direct → allow`, `workflow → ask`, and config may only tighten,
never loosen — a `workspace.*: allow` rule cannot turn `delete-item` into a silent
delete. Glob rules, last match wins, written in config order:

```jsonc
"actionOverrides": {
  "workspace.*": "allow",
  "workspace.delete-item": "deny",
  "workspace.assign": "ask"
}
```

D7 is therefore the **default**, expressed as manifest baselines, and re-tunable without
touching code.

---

## 11. UI contract extension

### The problem

`UI-CONTRACT.md` defines `select` with options as **static JSON in the manifest**. Epic
and story lists are neither static nor known at authoring time. Nothing in the current
vocabulary can express "options come from a call".

### The change: a `remote-select` field type

```jsonc
{
  "name": "parent_id",
  "type": "remote-select",
  "label": "Parent story",
  "required": true,
  "optionsFrom": {
    "skill": "workspace.list-parent-candidates",
    "args": { "type": "type" },        // skill param  <-  another field in this form
    "resultPath": "candidates",
    "value": "id",
    "text": "title",
    "hint": "reason"                    // optional secondary line
  }
}
```

### Why this is a legitimate contract addition, not per-plugin knowledge

The contract's stated failure mode is *"the vocabulary growing once per plugin"*. This
addition passes the same test the existing five blocks passed:

- **It is a shape, not a feature.** Any plugin whose parameter is an id into a
  collection it owns needs it. `todoist` would use it for projects; `google-calendar`
  for calendars. It is under-served today, not newly invented.
- **It stays declarative data.** It names a *skill id*, not a URL or an expression —
  Rule 1 holds. `GET /api/skills` still round-trips it as plain JSON.
- **It reuses the existing indirection.** `args` maps a skill parameter to a form field,
  the exact mirror of `list.actions.args` mapping a skill parameter to an item field.
- **`parameters` stays the single argument contract** — Rule 2 holds. The skill still
  accepts `parent_id: number`; only the widget changed.

A `board` block would have failed this test, which is why D5 rejected it.

### Degradation

Rule 5 says *"unknown block or field type → skip and log"*, and that applies here for
free — this is a new *type*, not a new key on `select`, precisely so old clients hit a
defined path rather than rendering an empty dropdown.

One gap Rule 5 does not cover: skipping a **required** field leaves a form that cannot
be submitted correctly. This spec adds a rule to `UI-CONTRACT.md`:

> A client that skips a required field MUST disable submission for that block and say
> why, rather than submitting an incomplete payload.

Silent submission of a form missing a required id is worse than no form.

### Files

| Repo | File | Change |
|---|---|---|
| Tardis | `packages/shared/src/schemas/plugin.ts` | add to `SkillUiFieldTypeSchema`; add `SkillUiOptionsFromSchema`; refine — `remote-select` requires `optionsFrom`, `select` requires `options` |
| Tardis | `UI-CONTRACT.md` | document the type and the required-field rule |
| tardis-app | `packages/ui-contract/src/index.ts` | mirror the types |
| tardis-app | `packages/core/src/bindings.ts` | `resolveFormFields` passes it through; add `resolveRemoteOptions(field, formState)` |
| tardis-app | `apps/web/src/components/blocks.tsx` | async-loading `<select>` |
| tardis-app | `apps/tui/src/render.ts` | numbered list prompt |

`resolveFormFields` currently derives fields from JSON Schema when `ui.fields` is absent,
mapping `string→text`, `number/integer→number`, `boolean→checkbox`, `array→tags`. It
never infers `remote-select` — that requires an explicit declaration, because nothing in
a JSON Schema says which skill supplies the options.

**Cross-repo deploy coupling:** Tardis serving `remote-select` before tardis-app
understands it means every workspace form silently loses its parent picker. The two must
ship together, and the plan must sequence tardis-app's support first.

---

## 12. Surfaces

### What already exists

`apps/tui/src/browse.ts` is *"browsing skills directly, without going through the agent
— the only way to reach a skill the model will not pick"*. That is your "custom commands
where I can create and edit without the AI", already built. Web has the equivalent via
`SkillRenderer.tsx` + `blocks.tsx`.

So the manual path is not new work. What is new is `remote-select` support and a board
worth looking at.

### Web — `custom.web`

`screens/WorkspaceBoard.tsx`: five columns, drag between them, click for detail, inline
draft editor. Registered as `custom.web` on `workspace.board`, with a complete `list`
fallback — the schema rejects `custom` without a valid `block`, and that check exists
because *"the first plugin to ship custom-only UI breaks the TUI, and nobody notices
until someone opens a terminal."*

Drag targets are filtered by `allowedTransitions` from §10.

### TUI — standard blocks only

By contract rule, the TUI *always* renders the standard block; it cannot execute custom
code. It gets:

- a `workspace` group in `menuGroups`
- `remote-select` as a numbered prompt with a `[s]how all` option
- the board as a `list` grouped by status

This is a plainer workspace mode, not an absent one — which is the trade D5 accepted.

### Mobile

Inherits everything through the standard blocks once `remote-select` lands in
`packages/core`. No mobile-specific work in this spec; `custom.mobile` stays available
if the generic board proves too thin.

---

## 13. Error handling

| Condition | Behaviour |
|---|---|
| Login fails | Clear tokens. Message names the config key and whether the host was reachable. |
| 401 mid-request | Refresh → retry once → re-login once → then surface. |
| 403 on a write | Report the capability or transition you lack, by name. Never retry. |
| Hierarchy 400 | Map the three `ErrorsEnum` values to plain sentences and re-open the draft slot. |
| LLM re-rank fails | Fuzzy top 5, unranked. Never an error. |
| LLM returns unknown ids | Discard them; if nothing survives, fall back to fuzzy. |
| IO server unreachable | One clear message. No retry storm — the agent loop already feeds tool errors back as observations, and a retry loop inside a tool multiplies that. |
| Draft commit partially fails | The POST is one server-side transaction; there is no partial state to reconcile. Surface the error and leave the draft `OPEN`. |

Every message is written to be read in a Telegram window by someone who did not write
the plugin.

---

## 14. Testing

Split so that the parts worth testing need neither a network nor a model.

| Unit | How |
|---|---|
| `draft.ts` | Pure. Slot ordering, `source` precedence, hierarchy gating, EPIC skipping `parent_id`, `nextQuestion` composition, commit-time validation. No HTTP, no LLM. |
| `ranking.ts` | Fuzzy determinism; LLM stub returning good JSON, bad JSON, unknown ids, and a rejection — each must degrade, never throw. |
| `io-client.ts` | Injected `fetch` stub. 401→refresh→retry, refresh-fail→re-login, login-fail→clear+throw. Assert exactly one retry. |
| Permissions | `my_settings` fixtures: LEAD (`null`), VIEWER, MEMBER with partial `allowedTransitions`. Assert illegal moves are never offered. |
| Ownership guard | `edit-item` / `move-item` refuse an item you neither report nor are assigned to, and name `edit-any-item` in the refusal. `draft-commit` never assigns to anyone but you. These are the tests that keep D7 true. |
| Contract | Schema tests: `remote-select` without `optionsFrom` rejected; `select` with `optionsFrom` rejected; `custom` without `block` still rejected. |
| tardis-app bindings | Against a captured `GET /api/skills` fixture including a `remote-select` field — the repo already tests bindings against a real captured contract. |
| End-to-end | Against a **local** IO server: describe a task, answer the questions, assert the row exists with correct `parent_id`, `story_points`, `estimate_hours`, `due_date`, `priority`, assignees. |

**Windows note.** `bun test` currently produces 146 Windows-only `EBUSY` failures from
SQLite handles not releasing on `unlink`. New tests should avoid temp DB files where a
fake or an in-memory store will do, so this suite stays runnable on the workstation
rather than only in CI.

**TDD applies.** `draft.ts` in particular is a state machine with an enumerable set of
transitions — it should be written test-first.

---

## 15. Rollout

**Phase 0 — local.** `baseUrl` → a local `internal-operation-server`. A throwaway
workspace with a few fake epics and stories. Every flow proven here first (D6). A
misparsed LLM response cannot reach the team's board.

**Phase 1 — contract.** Ship `remote-select` through tardis-app *before* Tardis emits
it. Ordering matters; see §11.

**Phase 2 — prod, read-only.** Point at `https://www.tajalsafainternal.services` with
write skills disabled via `actionOverrides: { "workspace.*": "deny" }` plus explicit
`allow` for the reads. Confirms auth, permissions and ranking against real data with
zero write risk.

**Phase 3 — prod, writes.** Lift the overrides to the D7 defaults.

Deployment gotcha, from `TARDIS-HANDOFF.md`: `scripts/deploy.sh` deploys **whatever
branch is checked out locally**, then `git reset --hard origin/$BRANCH` inside the
container. Confirm the branch before deploying. It never runs `git clean`, so untracked
files on the container survive deploys.

---

## 16. Out of scope

- **Tardis sessions → `workspace_work_item_time_entry`.** The most natural integration
  the two systems have, and deliberately excluded: it needs its own conversation about
  session↔item mapping, and folding it in here would double the spec.
- **Serving teammates.** D2's shared-password model does not extend to other people.
  That needs a personal-token endpoint on the server.
- **Attachments, checklists, relations, labels, saved views, lessons, reports.** All
  have APIs; none were asked for.
- **Sprint and workspace creation.** Read and assign only.
- **Offline drafting.** The draft lives server-side in TARDIS; no offline queue.
- **Modifying `internal-operation-server` or `internal-operation-website`.** A
  non-goal, and one of the success criteria.

---

## 17. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Local model too weak to chain draft skills reliably | High | The plugin composes `nextQuestion` and computes `missing[]`; the model only parses answers and relays questions. Structure never depends on the LLM. |
| Password at rest on CT 106 | Medium | Accepted in D2. `chmod 600`, no UI exposure, revoke = password change. Revisit if teammates are added. |
| Cross-repo contract skew | Medium | Ship tardis-app support first (§11, Phase 1). |
| Ranking picks the wrong epic | Medium | Top 3 + "none of these" + "show all". Never a dead end. |
| A `MEMBER` with sparse `allowedTransitions` finds moves mysteriously unavailable | Low | Surface the grants you actually have when a move is unavailable, rather than hiding the option silently. |
| Client types drift to camelCase against a snake_case wire | **High** | §18.4. Fails silently as "unrestricted", so it is caught by a fixture test, not by review. |
| Prod writes from a misfiring agent loop | Low after Phase 0-2 | Staged rollout; destructive skills gated by D7. |

---

## 18. Resolved before planning

All four open items were verified against the source rather than left for implementation.

### 18.1 No pagination on work-item lists

`FindAllWorkItemDto` declares `status`, `type`, `sprint_id`, `assignee_account_id`,
`parent_id`, `q` and `archived` — and no `take`, `skip`, `limit` or `page`. `findAll`
returns every matching row.

**Consequence:** the full-list fetch in `ranking.ts` (§8) is correct and safe. It also
means the response grows linearly with the workspace, so the `?type=EPIC` filter is not
an optimisation but the thing keeping the payload sane. Keep it.

### 18.2 Token TTL: access 24 h, refresh 30 days

`token.service.ts:128,137` — `expiry_date: dayjs().add(24, 'h')` for access,
`dayjs().add(30, 'd')` for refresh.

**Consequence, and it is the counter-intuitive one:** the refresh path runs roughly once
a day and the re-login path essentially never. That makes them the *least* exercised and
*most* likely to be broken in a way nobody notices for a day. §14's `io-client.ts` tests
are not optional coverage — they are the only place these paths get exercised at all.

### 18.3 Members response shape

`MEMBER_SELECT` (`workspace-member.service.ts:38`) returns:

```
id, workspace_id, account_id, role, own_items_only, act_own_only,
hidden_tabs, revoked_capabilities, transition_grants[{from_status,to_status}],
created_at, account { id, first_name, last_name, email }
```

**Consequence:** the assignee picker binds `value: "account_id"`, but there is no single
display field — a person's name is `first_name` + `last_name`. `remote-select.text` is
one field path, and widening it to accept a template would put string composition into a
contract whose first rule is *"descriptors are declarative data. No expressions."*

So `workspace.members` composes a `displayName` in `format.ts` and returns it alongside
the raw fields. The presentation choice lives in the plugin, where it belongs, and the
contract stays a field path. No contract change.

### 18.4 The wire is snake_case — this one matters

`workspace.service.ts:120-137` builds the payload as `my_role` and `my_settings`, with
`own_items_only`, `act_own_only`, `hidden_tabs`, `revoked_capabilities` and
`allowed_transitions: [{ from, to }]` inside it. There is no camelCase interceptor
anywhere in the server; the website's `mySettings` types are mapped on its own side.

**This is a trap, and it fails in the dangerous direction.** A plugin typed in camelCase
compiles, runs, and reads `undefined` for every rule field. `revokedCapabilities`
undefined reads as "nothing revoked"; `allowedTransitions` undefined reads as "no
restrictions to check". The plugin would silently treat a restricted `MEMBER` as
unrestricted and offer every action the server is about to `403`.

**Consequence:** `types.ts` mirrors the wire in snake_case, and §14 gains a fixture test
asserting a snake_case `my_settings` payload parses into a restricted permission set —
so the failure is caught by a test rather than by a confusing 403 months later.

Also confirmed: `my_settings` is `null` for **both ADMIN and LEAD**. `null` means
unrestricted, not "not a member".
