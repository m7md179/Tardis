# TARDIS — Full Build Progress

Checkpoint trail for the multi-phase build (core completion → Skills → clients → new plugins → TUI).
One dated entry per phase. Honest and specific: what was verified true *before* starting,
what was built, concrete evidence, what's next.

---

## Locked decisions (2026-08-26, confirmed with Mohammad)

| Decision | Choice |
|---|---|
| Client stack | **Expo mobile + separate Next.js web**, monorepo, shared `packages/core` + `packages/ui-contract`. Building blocks implemented twice (RN + React DOM) — accepted cost. |
| Client repo | **github.com/m7md179/tardis-app** (alongside the server repo) |
| Phase E vision | **Build the full multimodal pipeline** — `LLMMessage` content parts, `image_url` in the OpenAI adapter, image upload/storage in the app, one image per LLM call |
| Gemma vision findings | Use the two known findings as given; **no new vision testing**. (1) underestimates calorie-dense, low-volume foods (nuts, oils, cheese, dressings); (2) blends multiple images into one wrong answer → analyze each image in a separate call |

### Planned client repo layout
```
tardis-app/
  apps/mobile/          Expo Router (iOS + Android)
  apps/web/             Next.js App Router + Tailwind
  apps/tui/             Phase F
  packages/core/        API client, auth, types, shared logic
  packages/ui-contract/ Phase C block schemas + validators
```

---

## Working rules for this run

- **Re-verify before trusting.** This project has had memory files, config files and a
  systemd env var all be silently stale. Spot-check load-bearing claims against real state.
- **Real evidence only.** DB rows, real command output, real inference against live Gemma.
  Not mocks alone, and never a response's own text claiming success. A well-designed fix
  has already passed every unit test here and still failed against the real model.
- **Run model-dependent checks more than once** — this model's variability is known.
- **Stop and ask** before: deleting real data, touching the live Telegram bot mid-use,
  force-pushing over remote history, or changing production config.
- Branch per task: `phase-{N}/{task-name}`. Deploy via `main`.
- **deploy.sh gotchas** (re-confirm, don't trust): it scp's LOCAL `~/.tardis/config.json`
  over the server's, and must be run from `main`.

---

## Phase status

| Phase | Scope | Status |
|---|---|---|
| A | Core completion: real persistent memory | **DONE** (2026-08-26) |
| B | Skills architecture + `SKILLS.md` + `GET /api/skills` + migrate plugins | **DONE** (2026-08-26) |
| C | Hybrid UI contract + `UI-CONTRACT.md` | **DONE** (2026-08-26) |
| D | Client app foundation (new repo) — **gate: real DB change from the app** | **GATE PASSED**; mobile renderers pending |
| E | New plugins: health/food (multimodal) + budget | NOT STARTED |
| F | TUI renderer against the same contract | NOT STARTED |

Prerequisite unblocking (only as far as needed): `notes` plugin (duplicate `tagFilter`
declaration at `plugins/notes/index.ts:111-112`) and `google-calendar` (4 build errors).

Out of scope unless blocking: CI lint cleanup, SSH key access scoping.

---

## Entries

### 2026-08-26 — Phase A: core completion, real persistent memory

**Verified true before starting** (not taken from memory files):
- Local + container both on `main`; container `0497a11`, clean.
- Live model: real `n_ctx` **32768/slot** per `/v1/models`, `temperature` 0.2, and the
  config temperature genuinely reaches the model (config → adapter default → every `chat()`).
- Test baseline 568 pass / 1 fail — the known stale `bot.test.ts` assertion, confirmed
  failing identically on clean `main` via stash.
- `memories` table: **0 rows**, as expected.
- Memory is **fully wired**: `MemoryStore` → `MemoryRetriever` (budget 2000 from config)
  → `createMemoryExecutor` → passed into the bot. So 0 rows was not a wiring bug.

**Root cause of the empty memories table**

The model never called `memory.save` — 0/6 on obviously storable facts, while reminders
fired 3/3. It replied "Memory saved." having called nothing.

The cause was system-prompt section **order**, not wording. Isolated by A/B:

| Prompt | `memory.save` |
|---|---|
| Short prompt | 9/9 |
| Real `buildSystemPrompt()` | 1/9 |
| Real minus `## Response style` | 9/9 |

Bisecting the style block, `"Match the user's energy. Short command = short confirmation"`
scored **0/9 alone** — the model read a short user statement as deserving a short
confirmation rather than an action. Removing only that line recovered just 3/9; the block
is additively suppressive.

**Built**
- `## Memory` (behavioural) now precedes `## Response style`; the style block is explicitly
  scoped to wording; the "Match the user's energy" line is deleted.
- `fallbackForEmptyResponse()` — after a save the model returned blank text in **10/12**
  trials, and Telegram rejects empty message text. Rewording the prompt fixed blanks but
  regressed saves to 1/4 (the model spoke the acknowledgement *instead of* acting), so the
  blank is handled in code and only ever claims what the trace shows.
- `COMPLETION_CLAIM_PATTERN` widened twice: it missed `"Memory saved."` (no "memory" noun)
  and `"I have already saved..."` (adverb between auxiliary and verb).
- Deflaked `MemoryRetriever`'s recency test (same-millisecond tie made sort order arbitrary).
- New `memory-integration.test.ts`: save → persist → retrieve against real sqlite.

**Concrete evidence**

| Measure | Before | After |
|---|---|---|
| `memory.save` recall (live model) | **2/15** | **15/15** |
| Spurious saves on non-storable input | 0/10 | **0/10** |
| Empty replies after a save | **10/12** | **0/4** |
| Real rows written end-to-end | 0 | **5** |

Real round-trip against live Gemma: *"do I eat pork?"* → "You do not eat pork.";
*"what units do I prefer?"* → "Your preferred units are metric units."
Rows written: `user_name`, `preferred_units`, `dietary_restriction`, `peanut_allergy`,
`mkomko134678_email`. Suite: 578 pass / 1 known pre-existing fail; 8/8 clean core runs.

**Characterized, deliberately not "fixed"**
- **Paraphrase retrieval misses.** Keyword-only, substring matching. `bacon`↛`pork`,
  `kilograms`↛`metric`, `reach you online`↛`email` — 3/3 missed. Working as designed;
  asserted as a property in tests. Embeddings would be the fix if it ever matters.
- **Recency decay is not a gap.** Retrieval *requires* a keyword hit; recency contributes
  at most 5 points of ranking and never gates inclusion. A fact backdated 30 days still
  surfaced. Verified, not assumed.
- **No cap or eviction exists** on the memories table — rows accumulate forever. The only
  bound is read-side: `MemoryRetriever` calls `getAll(500)`, so beyond 500 memories the
  oldest-by-`updatedAt` become invisible to retrieval. Distant for a single user; recorded
  rather than pre-solved.
- **Memory cost is negligible**: 13 tokens for a memory hit (961 vs 948 prompt tokens).
- **Tool-call persistence generalizes.** PR #42's replay loop pairs any
  `tool_call`/`tool_result` regardless of tool, so memory calls persist like reminders —
  confirmed by test against a real DB, not by reading the code.

**Next**: Phase B — Skills architecture, resolving the `SkillRouter` name collision
(it currently routes among *plugins* for LLM tool-selection, which is a different concept
from the new per-capability Skill).


### 2026-08-26 — Phase B: Skills architecture

**Verified true before starting**
- Local + container both `main @ bb78997`, clean. Test baseline 578 pass / 1 known fail.
- Read the real code rather than assuming: the existing `SkillRouter` selects **plugins**
  using a plugin-level `skillSummary` blurb; the manifest's `tools[]` entries are already
  exactly the per-capability concept the new Skill describes; `executeTool(name, args)` is
  already the handler dispatch.

**The name collision, and how it was resolved**

Two different things shared the word "skill". The old router never routed among
capabilities, so it is renamed for what it actually does rather than overloaded:

| Before | After |
|---|---|
| `SkillRouter` (`agent/skill-router.ts`) | `PluginRouter` (`agent/plugin-router.ts`) |
| `selectPluginSkills()` | `selectPlugins()` |
| `SkillSelectionResult` | `PluginSelectionResult` |
| `getSkillSummaries()` | `getPluginSummaries()` |
| manifest `skillSummary` | manifest `summary` |
| manifest `tools[]` | manifest `skills[]` |

`skillSummary` and `tools` stay accepted as deprecated aliases, and a test asserts both
spellings normalize to a **byte-identical** canonical manifest, so nothing breaks on load.

**Built**
- `SKILLS.md` — written before implementation, as the plan required.
- `SkillDefinitionSchema`: `id`, `description`, `aiInvocable` (default true), `actionType`
  (default direct), `parameters`, optional `permissions`, optional `ui`.
- Manifest normalization: `tools` is now **derived** from AI-invocable skills, so the agent
  loop, tool router and prompt assembly are untouched.
- `PluginManager.getAllSkills()` / `getSkill(id)`, and the `RegisteredSkill` type.
- `GET /api/skills` (+ `?plugin=`, `?aiInvocable=`) and `POST /api/skills/:id/invoke`.
- All six plugin manifests migrated (27 skills total).

**Concrete evidence — against the live server, not mocks**

`GET /api/skills` returned **15 real skills** across the 4 loaded plugins, with
`todoist.delete-task` correctly typed `workflow`; `?plugin=reminders` filtered to 3;
unauthenticated request returned 401.

`POST /api/skills/:id/invoke` against real plugin handlers:

| Case | Result |
|---|---|
| `test-plugin.ping` | 200 `{"pong":true,"echo":"hello from test-plugin"}` |
| `reminders.list-reminders` | 200 `{"reminders":[],...}` |
| `time-tracker.status` | 200 `{"sessions":[],...}` |
| `time-tracker.start` with no args | 400 `VALIDATION_ERROR` (real ToolRouter message) |
| `todoist.delete-task` | 409 `APPROVAL_REQUIRED`, handler **not** called |
| `nope.missing` | 404 `SKILL_NOT_FOUND` |

`PluginRouter` re-verified against live Gemma after the rename — the agent's critical path:
`remind me to stretch` → `[reminders]` (3 tools), `start a timer` → `[time-tracker]` (6),
`what's on my todo list?` → `[todoist]` (5), `hello how are you` → `[]` (chatbot mode).

Suite: 595 pass / 1 known pre-existing fail. `tsc --noEmit` clean in all three packages.

**Judgment call, flagged**

The plan named only `GET /api/skills`. I added `POST /api/skills/:id/invoke` in this phase
too: a discovery endpoint with no way to act is not a usable contract, `aiInvocable: false`
would define an unreachable capability, and Phase D's gate depends on invocation. It reuses
`ToolRouter`, so direct invocation is the same validated path the agent loop takes — and a
`workflow` skill reached over HTTP returns `APPROVAL_REQUIRED` rather than executing, which
is verified above rather than asserted.

**Not done here**: no `ui` descriptors are populated yet — every skill returns `ui: null`.
That vocabulary is Phase C, which is next.


### 2026-08-26 — Phase C: hybrid UI contract

**Verified true before starting**
- `main @ eb81e6f`, clean. Suite 595 pass / 1 known fail.
- Only **4 of 6** plugins loaded in production; `notes` and `google-calendar` were dead.
- Dumped all 27 real skill signatures before designing anything.

**Unblocked the two broken plugins** (prerequisites for deriving their blocks)

Both had the *same bug class* — leftover duplicate declarations from incomplete edits:

| Plugin | Bug |
|---|---|
| `notes` | duplicate `tagFilter`; the pre-`IGNORE_TAGS` version survived alongside the fixed one |
| `google-calendar` | duplicate `date` / `startTime` / `endTime` across two hunks, where the `resolveDate`/`addOneHour` lines from the timezone fix (2830f9b) were the intended ones |

All six plugins now load — **27 skills**, confirmed through the real `PluginManager`, and
production went from `Loaded 4 plugin(s)` to `Loaded 6 plugin(s)`.

**The vocabulary came from the plugins, not from imagination**

Grouping the 26 real signatures by shape produced five blocks that cover all of them:
`action`, `form`, `list`, `timer`, `detail`. The things that looked like extra blocks are
not — a notes text editor is a `form` with a `textarea` field, a calendar date picker is a
`form` with `date`/`time` fields, a todoist checkbox is a `list` item action. Keeping those
as *field types* is what stops the vocabulary growing once per plugin, which is the failure
this contract exists to prevent.

**The escape hatch is enforced, not documented**

`SkillUiDescriptorSchema` rejects a descriptor carrying `custom` UI without a complete
standard-block fallback, and still enforces block completeness when `custom` is present —
a bespoke mobile screen does not excuse an unrenderable TUI fallback. This is in the schema
because the failure mode is silent: the first plugin to ship custom-only UI breaks the
terminal and nobody notices until someone opens one.

**Concrete evidence — live server**

`GET /api/skills` on production returns **27 skills across all 6 plugins, 18 with a
descriptor**, and every block is exercised by real plugins:

| block | count |
|---|---|
| form | 10 |
| list | 4 |
| timer | 2 |
| action | 1 |
| detail | 1 |

The 8 skills without a descriptor are exactly the item-action skills
(`cancel-reminder`, `stop`/`pause`/`resume`, `complete-task`, `delete-*`) — reachable
through their parent list's `actions`, by design.

**Descriptor vs reality** — each `list`/`timer` descriptor's declared `resultPath` checked
against the real handler output:

| Skill | resultPath | Verified |
|---|---|---|
| `notes.list-notes` | `notes` | yes (list) |
| `reminders.list-reminders` | `reminders` | yes (list) |
| `time-tracker.status` | `sessions` | yes (list) |
| `time-tracker.history` | `sessions` | yes (list) |
| `todoist.list-tasks` | `tasks` | **no — Todoist API token not configured** |
| `google-calendar.list-events` | `events` | **no — Google OAuth not connected** |

The last two are correct by source inspection but **unverified at runtime**, blocked on
external credentials rather than on the contract.

**Also fixed**: `reminders.list-reminders` now returns `fireAtMs` alongside the localised
`fireAt` string. A countdown timer cannot bind to `"26 Aug 2026, 19:45"`.

**New test**: `manifest-conformance.test.ts` asserts the *shipped* manifests obey the
contract — ids namespaced to their plugin, `ui.fields` naming only parameters the skill
actually accepts, and item actions pointing at skills that exist. Schema tests prove the
rules; this proves the real plugins follow them.

Suite: 637 pass / 1 known pre-existing fail. `tsc --noEmit` clean in all three packages.

**Open dependency for Phase D**: the Phase D gate needs a real database change from the
app. `todoist` cannot serve as that proof until its API token is configured, and
`google-calendar` needs OAuth. `reminders`, `notes` and `time-tracker` are fully working
and can carry the gate instead — I will use those unless Mohammad supplies a Todoist token.

**Next**: Phase D — new `tardis-app` repo (Expo mobile + Next.js web, shared
`packages/core` and `packages/ui-contract`), JWT auth, generic block renderers, and a
skills dashboard driven by `GET /api/skills`.


### 2026-08-26 — Phase D (part 1): client foundation, web, and the gate

**Verified true before starting**
- `main @ 5b4f092`, clean. TARDIS reachable from this machine at
  `http://192.168.100.229:3000` (health 200). `m7md179/tardis-app` did not exist.

**Repo**: **github.com/m7md179/tardis-app** — created **private**, because it embeds
homelab addresses and an admin auth flow. TARDIS itself is public; say the word and I will
flip it.

```
packages/ui-contract/  contract types mirrored from the server + forward-compat guard
packages/core/         TardisClient + binding logic, framework-agnostic
apps/web/              Next.js App Router + Tailwind, all five blocks
```

**Two real obstacles, both worth recording**

1. **TARDIS sets no CORS headers.** A browser at `localhost:3001` cannot call the API at
   all — the preflight is not even handled. Rather than opening a private API to arbitrary
   origins, the web app proxies through a Next route handler. Mobile and the TUI are not
   subject to CORS and call TARDIS directly, so the shared client is unchanged either way.
   happy-dom later reproduced this independently by blocking the same request.
2. **Label/field association was missing** in my first FormBlock — labels were text next to
   controls, so screen readers would not announce them and clicking a label did nothing.
   Caught because the gate test selected by label and failed. Fixed with `htmlFor`/`id`.

**THE GATE — passed, with database evidence**

`apps/web/src/components/gate.e2e.test.tsx` mounts the **real** block components, fires
**real** DOM events, and talks to the **real** server. Nothing is mocked; if TARDIS is down
it fails rather than passing against a stub. 4/4 passing:

1. the server serves a contract the app can render
2. typing into the real `FormBlock` and clicking submit **creates a real session row**
3. that same session renders through the generic `TimerBlock` with a live elapsed clock
4. clicking **Stop** — an item action declared by the descriptor — **removes it**

Independent confirmation, read straight out of production sqlite rather than through the
API the app just called:

```
sessions rows: [completed] "phase-d-gate-check"  id=580a86be  start=2026-08-25T23:35:03.576Z
```

That row was created by a click in `FormBlock` and completed by a click in `TimerBlock`.
Neither component contains one line of time-tracker-specific code.

**Also**: `packages/core` tests (16, passing) use a **real capture of `GET /api/skills`** as
their fixture, so they fail if the contract drifts rather than only if the helpers regress.
One asserts the client can render *every* descriptor the server actually ships.

**Honest gaps**
- **Mobile renderers are not built yet.** Phase D asks for the blocks on mobile *and* web;
  only web exists. Phase D is not complete until that lands.
- **No human-driven browser click was verified** — the Chrome extension is not connected in
  this environment. The gate drives real components and real events headlessly, which is
  strong, but it is not the same as a person clicking. Saying so rather than implying it.
- A hardcoded default admin password in the gate test was removed before the first push;
  it now requires `TARDIS_PASSWORD` and fails loudly without it.

**Next**: mobile renderers (Expo) sharing `packages/core`, then Phase D closes.
