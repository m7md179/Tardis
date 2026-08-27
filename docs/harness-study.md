# Three harnesses, and what TARDIS should take from them

A study of **Open WebUI**, **opencode** and **Pi** — what they actually implement, and
which parts are worth recreating here.

## How this was sourced

Honesty about provenance, because it changes how much each claim is worth:

| Harness | Source | Confidence |
|---|---|---|
| **Open WebUI 0.11.0** | Read directly from the running container in CT 106 — `/app/backend/open_webui/` | **High.** These are field names off the actual models. |
| **opencode** | `opencode.ai/docs` — permissions, agents, server pages | Medium-high. Documented schemas, not read source. |
| **Pi** | `github.com/earendil-works/pi` README | Medium. The README is thin; extension API lives at `pi.dev/docs`, unread. |

Open WebUI happens to already run on your box — it is what SearXNG was installed for.
That made it the one harness whose internals could be checked rather than trusted.

---

## Open WebUI

A multi-user chat platform. Python/FastAPI + SQLAlchemy backend, SvelteKit frontend.
Much of it is enterprise scaffolding TARDIS should ignore — but three subsystems are
directly relevant, and one of them answers a question already open here.

### Memory — the vector design, concretely

`models/memories.py`, a plain SQL row:

```python
class Memory(Base):
    __tablename__ = 'memory'
    id         = Column(String, primary_key=True)
    user_id    = Column(String, index=True)
    type       = Column(String, default='context')   # 'user' | 'context'
    path       = Column(Text, nullable=True)          # hierarchical
    content    = Column(Text)
    meta       = Column(JSON, nullable=True)
    updated_at = Column(BigInteger)
    created_at = Column(BigInteger)
```

The vector half lives beside it, **one collection per user**, in `routers/memories.py`:

```python
await ASYNC_VECTOR_DB_CLIENT.upsert(collection_name=f'user-memory-{user.id}', items=...)
results = await ASYNC_VECTOR_DB_CLIENT.search(collection_name=f'user-memory-{user.id}', ...)
await ASYNC_VECTOR_DB_CLIENT.delete_collection(f'user-memory-{user.id}')
```

Two details worth more than the schema:

- **The row is the truth, the vector is an index.** `reset_memory_from_vector_db`
  rebuilds every embedding from the SQL rows. Embeddings are disposable; losing them
  costs time, not data. That is the right split and TARDIS should copy it exactly.
- **Their own code comments the cost:** *"external embedding API calls (1-5+ seconds)"*,
  and *"A user with 100 memories would trigger 100 embedding API calls."* That is the
  argument for a **local** embedding model rather than an API, which is what a 4 GB
  card and a homelab want anyway.

`path` is the underrated field — memories are hierarchical, with
`list_memory_paths` and `read_memory_path` endpoints. Not just a bag of facts.

Vector backends supported: `chroma` (default), `pgvector`, `mariadb-vector`, `oracle23ai`.

### Functions — three plugin shapes, not one

`models/functions.py` has `type = Column(Text)` with three values, and they are
genuinely different things:

| Type | What it is | TARDIS equivalent |
|---|---|---|
| `pipe` | A custom model endpoint — appears in the model picker | none |
| `filter` | Middleware: runs **before and after every request** | **none — this is the gap** |
| `action` | A button on a message the user can press | none |

Filters are queried globally: `select(Function).filter_by(type='filter', is_active=True,
is_global=True)`. TARDIS has no equivalent — no way to modify a turn on its way in or
out without editing the agent loop.

### Valves — plugin config with a schema

Plugins declare a Pydantic `Valves` class (admin-level) and `UserValves` (per-user), and
Open WebUI renders a settings form from it. TARDIS manifests already carry a `config`
object, but it is an untyped bag with no UI and no validation.

### Automations — proactive, but scheduled by rrule

```python
class Automation(Base):
    data        = Column(JSON)        # {prompt, model_id, rrule}
    is_active   = Column(Boolean)
    last_run_at = Column(BigInteger)
    next_run_at = Column(BigInteger)

class AutomationRun(Base):
    automation_id, chat_id, status    # 'success' | 'error'
    error, created_at
```

Two differences from TARDIS's scheduler:

1. **rrule (RFC 5545), not cron.** rrule expresses "last Friday of the month" and
   "every other Tuesday"; cron cannot.
2. **`next_run_at` is stored.** TARDIS recomputes the match on every 60s tick. A stored
   next-run is cheaper and, more importantly, *inspectable* — you can ask when something
   will next fire.

`AutomationRun` is the same idea as `proactive_logs`, which TARDIS already has.

### Skills — content, not code

```python
class Skill(Base):
    id, user_id, name (unique), description, content, meta, is_active
```

`content` is prose the model reads — the Claude-skills shape. **This is a different
meaning of the word than TARDIS uses.** A TARDIS skill is an invocable capability with a
JSON-Schema signature; an Open WebUI skill is an instruction document. Both are useful
and they are not competitors.

### Ignore

`scim.py`, `groups.py`, `access_grants.py`, `evaluations.py` — multi-user RBAC and
enterprise provisioning. TARDIS has one user.

---

## opencode

A terminal coding agent, client/server. Two subsystems are worth taking.

### Permissions — the best idea in any of the three

```json
{
  "permission": {
    "*": "ask",
    "bash": "allow",
    "edit": "deny"
  }
}
```

Three values — `allow` / `ask` / `deny` — and per-tool objects with glob patterns:

```json
{
  "permission": {
    "bash": { "*": "ask", "git *": "allow", "rm *": "deny" }
  }
}
```

**Last matching rule wins.** `*` matches any run of characters, `?` exactly one.

Permission keys: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`,
`external_directory`, `todowrite`, `webfetch`, `websearch`, `lsp`, `skill`, `question`,
`doom_loop`. Most default to `allow`; `doom_loop` and `external_directory` default to
`ask`; `.env` is blocked outright.

Two of those names are quietly telling: **`question`** is a permission, meaning asking the
user is modelled as a capability — TARDIS's `clarify` tool is the same idea arrived at
independently. And **`doom_loop`** is a guarded capability — the same problem TARDIS's
repeat guard solves, promoted to something you can configure.

### Agents — modes as first-class config

Markdown with frontmatter, in `~/.config/opencode/agents/` or `.opencode/agents/`:

```yaml
---
description: [required]
mode: [primary|subagent|all]
model: [provider/model-id]
temperature: [0.0-1.0]
permission:
  edit: deny
---
[system prompt]
```

Or JSON under `agent.{name}` with `steps`, `disable`, `hidden`, `color`, `top_p`, and
`prompt: "{file:./path}"`.

Ships three: **build** (full access), **plan** (read-only — denies edits, asks before
bash), **general** (subagent for multi-step search). Subagents are invoked automatically
or by `@general` mention, with child sessions navigable via keybind.

### Server

```
opencode serve [--port 4096] [--hostname 127.0.0.1] [--cors <origin>]
```

- `GET /global/health` → `{ healthy: true, version: string }`
- `GET /global/event` — SSE, first event is `server.connected`
- `POST /session`, `GET /session/:id`, `DELETE /session/:id`
- `GET /session/:id/children` — sessions nest via `parentID`
- `POST /session/:id/message` — `{ messageID?, model?, agent?, noReply?, system?, tools?, parts }`
- `GET /command`, `POST /session/:id/command` — `{ messageID?, agent?, model?, command, arguments }`
- OpenAPI 3.1 spec published at `/doc`
- Basic auth via `OPENCODE_SERVER_PASSWORD`

TARDIS already has the client/server split and an SSE stream. What it lacks are
**nested sessions** and a **published schema**.

### Ignore

LSP integration, `edit`/`glob`/`grep` tools — coding-agent concerns.

---

## Pi

The most interesting *architecture* and the least directly reusable.

Five packages, cleanly separated:

| Package | Purpose |
|---|---|
| `pi-coding-agent` | interactive CLI |
| `pi-agent-core` | agent runtime — tool calling and state |
| `pi-ai` | unified multi-provider LLM API |
| `pi-telemetry` | vendor-neutral telemetry contracts, reference adapter, **conformance tests** |
| `pi-tui` | terminal UI with **differential rendering** |

**A four-tool core:** Read, Write, Edit, Bash. Everything else arrives at runtime as
TypeScript Extensions, Skills, Prompt Templates, Themes, or packages.

TARDIS already holds this shape — a thin core plus plugins. Two things are still worth
stealing:

- **`pi-telemetry` ships conformance tests for its contract.** TARDIS has a UI contract
  (`UI-CONTRACT.md`) and a manifest schema, and `manifest-conformance.test.ts` is the
  beginning of the same idea. Making the contract itself testable is what stops it
  drifting.
- **Differential rendering in the TUI.** The TARDIS TUI reprints; Pi diffs. Only matters
  if the TUI grows a live-updating region.

**Explicitly no permission system.** Their docs say so outright and recommend
containerising instead. For a coding agent on a developer's own machine that is a
defensible trade. For an assistant holding your bank card list it would not be, and it
is worth noticing that TARDIS's permission guard is the *stricter* design.

---

## What to recreate here, ranked

Ordered by value per unit of work, against TARDIS as it actually stands.

### 1. Graded permissions — replace binary direct/workflow

**Take from:** opencode.

TARDIS has two states: `direct` (runs) and `workflow` (asks). opencode's three-value
model with patterns is strictly more expressive, and TARDIS is already 80% of the way
there — `AgentConfig.actionOverrides` exists and is consulted in `agent-loop.ts`:

```ts
const effectiveActionType =
  input.config.actionOverrides[toolName] ?? tool?.actionType ?? 'direct';
```

Widen that value to `allow | ask | deny`, accept `budget.*` glob keys, and resolve
last-match-wins. `deny` is the genuinely new capability: today there is no way to say
*"never let it delete a goal, not even with my approval."*

The two pieces to change are small and already isolated:

```ts
// packages/shared/src/schemas/plugin.ts
export const ActionTypeSchema = z.enum(['direct', 'workflow']);

// packages/shared/src/schemas/agent.ts
actionOverrides: z.record(ActionTypeSchema).default({}),
```

`z.record` already accepts arbitrary string keys, so glob keys need no schema change —
only a resolver that walks the entries and takes the last match.

**Files:** `packages/shared/src/schemas/plugin.ts` (the enum),
`packages/shared/src/schemas/agent.ts` (the override map),
`packages/core/src/agent/agent-loop.ts:498` (resolution).
**Note:** the existing rule that a user may promote direct → workflow but never demote
must survive; `deny` sits above `ask`, it does not replace it.

### 2. Vector memory — SQL row as truth, embedding as index

**Take from:** Open WebUI.

TARDIS's `MemoryRetriever` loads every memory and scores keyword overlap, requiring at
least one literal hit. "What did I say about the car" therefore misses a memory phrased
"vehicle down payment".

Open WebUI's split is the design to copy: keep the row authoritative, treat the vector
store as a rebuildable index, and make a `reset` path that re-embeds from rows. Add
`path` while touching the schema — hierarchical memory costs one column now and is
painful to retrofit.

For this hardware: **sqlite-vec plus a local embedding model** (`bge-small`, ~90 MB, CPU,
~5 ms). Vectors live in the SQLite file that already exists. Open WebUI's own comments
about 1–5 s embedding calls are the argument against an API. Keep the existing keyword
scorer and merge scores — hybrid beats pure vector at recalling names and IDs.

**Files:** `packages/core/src/memory/memory-store.ts`, `memory-retriever.ts`,
`packages/db/src/schema.ts`.

### 3. Turn filters — the missing extension point

**Take from:** Open WebUI's `filter` functions.

TARDIS plugins can only be *called*. They cannot observe or modify a turn. Every
cross-cutting behaviour therefore had to be hardcoded into the agent loop — the claim
guard, the completion guard, the unrecorded-amount check, the textual-tool-call recovery.
Those were right to build, but they are now four special cases in one file with no way to
add a fifth without editing core.

An `onTurnStart` / `onTurnEnd` hook in the plugin API would let a guard ship as a plugin.

**Files:** `packages/core/src/plugins/plugin-api.ts`, `agent-loop.ts`.
**Caution:** a filter that can rewrite a turn can also break every turn. Wrap in the same
try/catch isolation plugin calls already get.

### 4. rrule scheduling, and store `next_run_at`

**Take from:** Open WebUI automations.

Cron cannot say "last Friday of the month" — a real limitation for a budget assistant
that should report on a pay cycle. Storing `next_run_at` also makes the schedule
answerable: *"when will you next tell me about my spending?"* is currently unanswerable
without simulating the matcher.

**Files:** `packages/core/src/proactive/scheduler.ts`, `cron-utils.ts`.
**Note:** the interval-based `(since, now]` matching added after the double-fire bug is
correct and must be preserved — rrule replaces the *expression*, not the tick logic.

### 5. Typed plugin config (Valves)

**Take from:** Open WebUI.

Manifest `config` is an untyped bag today. A Zod schema per plugin would give validation,
defaults, and a generated settings form — and the UI contract already proves that
descriptor-driven rendering works here.

**Files:** `packages/shared/src/schemas/plugin.ts`, the web UI.

### 6. A read-only mode

**Take from:** opencode's `plan` agent.

One config flag that forces every `workflow` skill to `deny` and every write to `ask`.
Useful for handing someone the app, or for asking questions without risking a write —
which, given a recipe question once landed in the food diary, is not hypothetical.

Cheap: it is a preset over the permission work in item 1.

### 7. Published API schema

**Take from:** opencode's OpenAPI 3.1 at `/doc`.

TARDIS's HTTP API is hand-rolled and only documented by its tests. Hono can emit OpenAPI
from route definitions.

### Deliberately not taking

| | Why |
|---|---|
| Pipes / custom model endpoints | TARDIS has one model by design |
| LSP, edit/glob/grep tools | coding-agent concerns |
| SCIM, groups, RBAC | one user |
| Pi's no-permission stance | wrong trade for something holding financial data |
| Open WebUI "skills" as prose | TARDIS skills are invocable capabilities; same word, different thing — do not merge them |

---

## The through-line

All three converge on the same shape: **a thin core, a typed extension contract, and a
permission boundary around anything that touches the world.** TARDIS already has two of
those. The permission boundary is the one that is binary where it should be graded, and
the extension contract is the one that is call-only where it should also observe.

The most striking single detail is that opencode models **asking the user** and
**looping** as *permissions* — `question` and `doom_loop`. TARDIS built both as
hardcoded guards. Treating them as configurable capabilities rather than fixed behaviour
is the more honest design, and it is a small change from where the code already sits.
