# TARDIS — implementation spec

Everything queued, in order, with enough detail to build from. Derived from
[`harness-study.md`](./harness-study.md) plus defects found in daily use.

## The rule that governs all of it

**Server-side first.** Three surfaces exist — web, mobile, terminal — plus Telegram.
Anything solved in a client has to be solved three times and will drift twice. If a
feature can live behind an endpoint or in the agent loop, it goes there, and the clients
render it.

This is the same principle the UI contract already establishes for skills. It applies
just as hard to conversation state, permissions and scheduling.

---

## Status

| # | Change | State |
|---|---|---|
| 0 | Graded permissions — allow/ask/deny | **done** — 802 tests, verified live |
| 1 | Conversation history survives a refresh | **done** — 816 tests, verified live |
| 2 | `mutates` on skills → read-only mode | **done** — 837 tests, 3/3 live on three cases |
| 3 | Hybrid vector memory | **done** — 892 tests, 8/8 paraphrase / 10/10 quiet live |
| 4 | Turn filters | **done** — 919 tests |
| 5 | rrule scheduling | **done** — 950 tests |
| 6 | Typed plugin config | **done** — 993 tests |
| 7 | Published OpenAPI schema | queued |

---

## 1 — Conversation history survives a refresh

### The problem

Refreshing the web app loses the entire conversation. Everything said, every tool call,
gone. The assistant has amnesia the moment you close a tab.

**The server already has all of it.** `conversations` stores every message with its tool
calls, indexed by `(chat_id, timestamp)`:

```ts
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  role: text('role').notNull(),          // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  toolName: text('tool_name'),
  toolCalls: text('tool_calls'),         // JSON, assistant tool_calls array
  timestamp: integer('timestamp').notNull(),
}, (t) => [index('conversations_chat_ts').on(t.chatId, t.timestamp)]);
```

Nothing exposes it over HTTP. The clients keep turns in React state and drop them on
unmount. This is purely a missing endpoint.

### Design

**Return turns, not raw messages.** Every client already models a turn — question,
plugins, steps, answer. If the endpoint returns rows, all three clients reimplement the
same grouping logic and two of them get it subtly wrong. Group once, on the server.

```
GET /api/chat/history?chatId=app&limit=20&before=<ts>
```

```jsonc
{
  "chatId": "app",
  "turns": [
    {
      "id": "<first message id>",
      "at": 1787749233309,
      "question": "i ate 2 sandwiches, 2 jod, 700 calories",
      "steps": [
        { "type": "tool_call",   "toolName": "health.log-meal", "toolArgs": {...} },
        { "type": "tool_result", "toolName": "health.log-meal", "toolResult": {...} }
      ],
      "answer": "Logged the meal and recorded 2 JOD."
    }
  ],
  "hasMore": true
}
```

`plugins` is not stored per turn today, so it is omitted rather than invented. A restored
turn renders its ledger without the "loaded x, y" line — a small, honest gap.

```
DELETE /api/chat/history?chatId=app
```

Clears it. This is what Telegram's `/new` already does via `handleNewCommand`; the app
surfaces need the same door.

### chatId strategy — the decision that matters for mobile

Today: web hardcodes `'web'`, the TUI generates `tui-<timestamp>` per launch (so it never
persists anything), Telegram uses the real Telegram chat id.

**Proposal: web, mobile and TUI all default to `chatId: 'app'`.**

One continuous conversation across every surface you own. Start on the phone, finish on
the laptop, and the terminal sees the same thread. That is what an assistant should feel
like, and it costs nothing — memory is already global rather than per-chat, so the
conversation being global is the consistent choice.

Telegram keeps its own id. It is a different correspondent, not a different window.

`/new` then means "start a fresh thread", implemented as a `DELETE` rather than by
inventing a new id — otherwise old threads accumulate invisibly forever.

### Files

- `packages/core/src/memory/conversation-store.ts` — add `getTurns(chatId, limit, before)`
- `packages/server/src/api/app.ts` — the two routes
- `tardis-app/packages/core/src/chat.ts` — `fetchHistory(client, chatId)`
- `tardis-app/apps/web/src/components/Chat.tsx` — load on mount
- `tardis-app/apps/tui/src/index.ts` — stop generating a throwaway id
- mobile — same client call once it has a chat screen

### Tests

- grouping: a user message, two tool call/result pairs and an answer become one turn
- a turn interrupted by an approval (call with no result) does not corrupt the next turn
- `before` paginates without dropping or duplicating a turn at the boundary
- `DELETE` removes only the named chat

### Risks

A long history is a lot of JSON. Default `limit=20` turns and paginate backwards.
The existing `getHistory` cap serves the *model*; this is a separate cap for the *screen*
and the two should not be conflated.

---

## 2 — `mutates` on skills, then read-only mode

### Why this is next and not read-only directly

The roadmap originally called read-only "a preset over permissions, cheap." That was
wrong, and writing the permission code surfaced why: `{"*": "deny"}` denies *reading*,
because `direct` covers both `budget.this-month` and `budget.add-entry`.

Permissions grade **how much ceremony an action needs**. That is not the same axis as
**does it change anything**. Read-only needs the second axis, which does not exist yet.

### Design

Add to the skill schema:

```ts
mutates: z.boolean().optional()   // default derived, see below
```

Default: `actionType === 'workflow'` implies `mutates: true`. A `direct` skill defaults
to `false` unless it says otherwise. That keeps every existing manifest valid while
letting `budget.add-entry` declare the truth about itself.

Then read-only is a real preset:

```ts
// deny anything that mutates; leave reads untouched
```

### The second payoff

The claim-vs-reality guard currently infers mutation **at runtime**, from whether a tool
returned a `success` Result. That works — it is measured at 3/3 — but it only knows after
the call has happened, and it silently depends on every plugin following the Result
pattern. A declared `mutates` makes the same fact available *before* the call and removes
the hidden contract.

Keep the runtime check as a fallback for plugins that do not declare.

### Files

`packages/shared/src/schemas/plugin.ts`, `permissions.ts`, `agent-loop.ts`,
all nine `plugins/*/manifest.json`.

### What was built

`mutates` is optional on the manifest and **resolved once**, in the schema
transform, so `PluginManifest.skills[].mutates` and the derived `tools[].mutates`
are always a boolean and nothing downstream re-derives the rule. 25 direct
skills across seven plugins now declare that they write; the other 30 keep the
derived default.

Read-only lives in `AgentConfig.readOnly` and is applied **after** grading, as a
floor rather than a rule — a `{"budget.add-entry": "allow"}` line cannot cancel
it. An unclassified tool is treated as mutating: refusing a harmless read is an
inconvenience, running an unclassified write in read-only mode is the bug
read-only exists to prevent.

It is enforced in two places, because a switch the UI can step around is not a
switch: the agent loop, and `POST /api/skills/:id/invoke`, which returns
`403 READ_ONLY`. `clarify` declares `mutates: false` and stays available — the
alternative to asking is guessing.

The claim guard now takes two signals that must agree: a skill declaring
`mutates: false` can never validate a completion claim however cheerful its
return value, and the result must still report success. That kills the exact
live failure — "Delete my most recent budget entry." ran `budget.this-month`,
deleted nothing, and answered "I have deleted the most recent budget entry" —
by declaration rather than by luck about whether a read happens to omit a
`success` field.

Verified against the live Gemma, three runs each: a write refused under
read-only 3/3, a read still running 3/3, and the false-delete claim answered
truthfully 3/3.

---

## 3 — Hybrid vector memory

### The problem

`MemoryRetriever` scores keyword overlap and requires at least one literal hit, so *"what
did I say about the car"* misses a memory phrased *"vehicle down payment"*. It is also
O(n) per turn — it loads every memory.

### Design, taken from Open WebUI

**The row is the truth; the vector is a rebuildable index.** Their
`reset_memory_from_vector_db` re-embeds everything from SQL. Embeddings are disposable —
losing them costs time, not data.

- `sqlite-vec` extension on the existing database. No new service.
- Local embedding model — `bge-small`, ~90 MB, CPU, ~5 ms. Open WebUI's own comments
  price API embedding at *"1-5+ seconds"* per call, which settles it.
- **Hybrid, not pure vector.** Keep the keyword scorer and merge scores. Vector search is
  worse than people expect at recalling a specific name, an ID or an exact phrase; keyword
  is worse at paraphrase. Together they cover each other.
- Add `path` while the schema is open. Hierarchy costs one column now and is painful to
  retrofit.
- `POST /api/memories/reindex` to rebuild from rows.

### Risks

The embedding model is a new runtime dependency on a box already running llama.cpp on a
4 GB card. It must run on **CPU** and be loaded once, not per call. If that proves
awkward, FTS5 alone is a smaller step that still fixes exact-ish search.

### What was built, and where it departs from the plan above

Three things measured differently than the plan assumed. Each is recorded here
with the number that decided it.

**No sqlite-vec.** It does not load: `bun:sqlite` is compiled without extension
support (*"This build of sqlite3 does not support dynamic extension loading"*),
and pointing Bun at a custom SQLite would have to be done on macOS and Linux
both, plus shipped in the binary build. It also buys nothing at this scale — a
plain JS scan measures **0.26 ms for 500 memories** and **19 ms for 50,000**,
against a turn that already costs seconds of inference. So the vector is a
`BLOB` on the memory row itself, which makes *row-as-truth* literal: there is no
separate index to drift.

**No new service.** Ollama was already running on CT 106 on `127.0.0.1:11434`.
`nomic-embed-text` (274 MB, 768-dim, CPU) is a `pull`, not a deployment.
Measured **~20 ms per query embed** warm, **63 ms per memory** when reindexing.
Cold-start after Ollama's five-minute idle unload costs ~1.1 s, which is why
`keepAlive` is a config option.

**A similarity floor does not work, and a margin does.** This was the plan's
real gap. Over 20 memories, 15 answerable questions and 12 unanswerable ones:

```
"what am I coding"            → correct memory at 0.526
"what is the capital of Peru" → nearest irrelevant memory at 0.526
```

The distributions overlap exactly, so any floor admitting the true hit admits
the junk. The **gap to the runner-up** separates them cleanly — relevant
queries 0.021–0.316, unanswerable ones 0.000–0.123 — so the gate is whether one
memory stands apart from the field, not how high it scored:

| margin | surfaces | admits noise |
|---|---|---|
| 0.03 | 14/15 | 5/12 |
| **0.05** | **12/15** | **1/12** |
| 0.08 | 11/15 | 1/12 |

At `MAX_VECTOR_CANDIDATES = 3` the same data surfaces 13/15 but admits three
times the noise, so the vector half contributes **at most one memory per turn**.
Keyword search already covers literal matches; the vector half exists to catch
paraphrase and should be the conservative one.

**Everything is optional.** With no embedder configured, `MemoryRetriever`
behaves exactly as it did before vectors existed. That is what makes the
embedding service a nice-to-have rather than a dependency, and it is pinned by a
test.

**Endpoint** is `POST /api/memory/reindex` rather than `/api/memories/reindex` —
the existing routes are all `/api/memory`, and consistency with the live surface
beat consistency with this document. `?full=true` drops existing vectors first;
without it the call only fills gaps, which makes it the right thing to run after
an embedder outage.

**Live verification** — real `OllamaEmbedder`, real `cosine`, real
`leadingCluster`, real `nomic-embed-text`, over a 10-memory store:

```
== paraphrases the keyword scorer cannot reach ==
  HIT "what did I say about the car"        -> [car-savings]
  HIT "am I putting money aside for an automobile" -> [car-savings]
  HIT "can I take antibiotics"              -> [allergy]
  ... 8/8

== questions no memory answers ==
  stayed quiet on 10/10
```

---

## 4 — Turn filters

### The problem

Plugins can only be *called*. They cannot observe or modify a turn, so every cross-cutting
behaviour is hardcoded in `agent-loop.ts`: the claim guard, the completion guard, the
unrecorded-amount check, the textual-tool-call recovery. Four special cases in one file,
with no way to add a fifth without editing core.

### Design, taken from Open WebUI's `filter` functions

```ts
onTurnStart?(turn: { userMessage, chatId }): Promise<{ userMessage?: string } | void>;
onTurnEnd?(turn: { response, steps, chatId }): Promise<{ response?: string } | void>;
```

Same try/catch isolation every plugin call already gets — **a filter that can rewrite a
turn can break every turn**, so a throwing filter is skipped and logged, never fatal.

### Do not port

`pipe` (custom model endpoints — TARDIS has one model by design) and `action` (message
buttons — the UI contract's `actions` already covers this ground).

### What was built

Filters live in `runConversationTurn`, which is the one place every surface —
web, mobile, terminal, Telegram — already goes through. They are discovered
from a plugin's module exports, the same way proactive handlers are; the server
announces them at load, because a plugin quietly rewriting every turn is
otherwise invisible in `tardis plugins`.

**The rewrite is total.** A message rewritten by `onTurnStart` is the message
for the rest of the turn: plugin selection, memory retrieval, the agent loop,
the thought trace and the stored history all see it, and the original is not
kept. The alternative — the model sees one thing and history records another —
means the next turn replays a conversation that never happened, and makes a
trace a record of something other than what ran. The same holds at the other
end: the trace and the transcript carry the response as *delivered*, not the one
the loop happened to produce.

A rewrite to empty is ignored at both ends. Returning `{}` is the natural way to
say "no change", and Telegram rejects empty message text outright, so a filter
must not be able to produce a turn that cannot be delivered.

**Not built: short-circuiting.** `onTurnStart` cannot end a turn early with a
canned reply. It would be useful — a blocklist, a rate limiter — but it is a
larger contract than this needs (what does the trace contain? is it persisted?)
and nothing queued wants it yet. Adding it later is additive.

---

## 5 — rrule scheduling

Cron cannot express "last Friday of the month", which a budget assistant reporting on a
pay cycle actually needs. Open WebUI stores `{prompt, model_id, rrule}` plus a computed
`next_run_at`.

**Storing `next_run_at` is the underrated half.** TARDIS recomputes the match every 60s
tick, which is correct but makes *"when will you next tell me about my spending?"*
unanswerable without simulating the matcher.

**Preserve the interval matching.** The `(since, now]` logic added after the double-fire
bug is correct and hard-won. rrule replaces the *expression*, not the tick.

### What was built

Both dialects live behind `occursIn` and `nextRunAt` in `proactive/schedule.ts`,
and nothing outside that file knows which one a schedule is written in.
Detection needs no heuristics: `FREQ=` is required in every RRULE and cannot
appear in cron. `isTimeToRun` stays as the cron-shaped name and delegates, so
there is one implementation of the interval rule rather than two that drift.

**TZID is not supported, and that is a finding rather than a shortcut.** rrule
needs luxon for timezones and, without it, does not error — it silently applies
the *machine's* offset to another zone's rule. Measured:
`DTSTART;TZID=Europe/London:20260115T090000` produced 12:00Z on an Asia/Amman
box, which is 09:00 Amman, not 09:00 London. A schedule that is quietly three
hours wrong is worse than one that is unsupported. RRULE times are therefore
read as local wall-clock, matching cron, and a test pins that
`FREQ=DAILY;BYHOUR=9` and `0 9 * * *` resolve to the same instant. Two dialects
on one server disagreeing about what 9am means would be a genuinely nasty bug.

A bare `FREQ=…` is anchored to a fixed epoch rather than to "now" — otherwise
`FREQ=MONTHLY;BYMONTHDAY=1` written on the 15th first fires *next* month, and a
rule would mean different things depending on when it was typed.

**`next_run_at` honours quiet hours**, because the tick *skips* a run that lands
inside them rather than deferring it. Reporting an 02:00 occurrence under quiet
hours of 22:00–08:00 would be a lie. The search is bounded at 500 candidates:
quiet hours can cover every occurrence a rule ever has, and an unbounded walk
would hang the scheduler rather than return null.

It is recomputed on every tick rather than only when the schedule changes — a
handful of rows, and it self-heals a value left stale by a crash or a clock
change. A stale answer to *"when will you next tell me?"* is a wrong answer, not
a slow one.

`PUT /api/proactive/triggers/schedule` now rejects an unparseable schedule with
`400 INVALID_SCHEDULE` and returns the new `nextRunAt`. Previously an invalid
expression was stored happily and then simply never fired, because `occursIn`
returns false on a parse failure.

**The upgrade path is now tested.** Every other database test starts from
`CREATE TABLE`, which already declares the newest columns — so the `ALTER`
statements that actually run against production had never been exercised. There
is now a test that builds a database in its pre-upgrade shape, migrates it, and
checks both that the columns appear and that the existing rows are untouched.

---

## 6 — Typed plugin config

Manifest `config` is an untyped bag with no validation and no UI. A Zod schema per plugin
gives defaults, validation and a generated settings form — the UI contract already proves
descriptor-driven rendering works here.

Open WebUI splits admin-level `Valves` from per-user `UserValves`. TARDIS is single-user;
one level is enough.

### What was actually broken

Worse than "untyped bag". `api.config.get` read **only** the system config
file, so a manifest's declared defaults were never consulted at all — which is
why every plugin carries its own `DEFAULTS` constant and a merge loop. And
`api.config.set` was a no-op: it resolved, discarded the value, and said
nothing.

### What was built

The manifest `config` block now accepts a described field:

```jsonc
"maxResults": {
  "type": "number", "label": "Results per search",
  "description": "Snippets are a token budget, not a page.",
  "default": 5, "min": 1, "max": 20
}
```

Bare values still work — `"currency": "JOD"` becomes a string field whose label
is derived from the key — so no manifest broke. A descriptor is distinguished
from an object-valued default by requiring **both** a known `type` and a
`label`, which makes a collision essentially impossible.

The manifest exposes two views of the same block: `configSchema` describes each
setting, and `config` stays exactly the plain key → default map it always was,
so every existing reader is untouched. All four manifests that had settings are
now described; a test asserts the resolved defaults are unchanged.

`api.config.get` returns the declared default when the system config says
nothing. `api.config.set` validates and persists to `config.json` — and when
there is nowhere to write it **throws** rather than resolving. A setting that
vanishes without a word is the harder bug of the two.

Misconfiguration is reported at load, not at first use: a plugin that starts
cleanly and then fails on its first call because a required token is missing is
much harder to diagnose. Unknown keys are reported too — a typo in `config.json`
that silently does nothing is the most annoying kind of configuration bug and it
is free to catch.

```
GET /api/plugins/:name/config   -> { schema, values, issues, writable }
PUT /api/plugins/:name/config   -> { values } ; 400 INVALID_CONFIG
```

Two details that would each have been a bug: a resubmitted secret mask means
*unchanged*, not "set it to bullet characters" — otherwise opening the settings
form and pressing save destroys every token. And an empty string for a number
field is rejected rather than read as zero, because a cleared field means
"unset", and silently storing `0` for a timeout is a dangerous reading.

Masking is presentation, not storage: the value is still in `config.json` in the
clear, and the code says so rather than implying otherwise.

Existing plugins keep their local `DEFAULTS` — they work, and rewriting a
shipped plugin for tidiness is not what this change promised. New plugins do
not need one.

---

## 7 — Published OpenAPI schema

The HTTP API is hand-rolled and documented only by its tests. Hono can emit OpenAPI from
route definitions; opencode publishes 3.1 at `/doc`.

Lowest urgency, but it is what makes the mobile app's client generatable rather than
hand-written.

---

## Not doing

| | Why |
|---|---|
| Custom model endpoints (`pipe`) | one model by design |
| LSP, edit/glob/grep tools | coding-agent concerns |
| SCIM, groups, RBAC | one user |
| Prose-style "skills" | TARDIS skills are invocable capabilities — same word, different thing |
| Nested sessions | no use for sub-conversations yet; revisit if subagents appear |
