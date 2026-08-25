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
| A | Core completion: real persistent memory | NOT STARTED |
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

_(none yet — Phase A next)_
