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
| B | Skills architecture + `SKILLS.md` + `GET /api/skills` + migrate plugins | NOT STARTED |
| C | Hybrid UI contract + `UI-CONTRACT.md` | NOT STARTED |
| D | Client app foundation (new repo) — **gate: real DB change from the app** | NOT STARTED |
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
