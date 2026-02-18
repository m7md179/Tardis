# Skill Engine Plugin

Self-evolving skill tracking system with adaptive training, difficulty calibration, weak area detection, and analytics. Tracks both tech and non-tech skills, awards XP for training sessions, and auto-creates Todoist tasks when you fall behind.

## Overview

The Skill Engine turns TARDIS into a personal growth system:

- **Track skills** you want to improve (e.g. TypeScript, cooking, public speaking)
- **Log training sessions** with a difficulty and score
- **Adaptive difficulty** targets 85% success rate — harder when you're cruising, easier when struggling
- **Weak area detection** flags topics where you consistently score low
- **XP & leveling** rewards consistent practice with visible progress
- **Todoist integration** auto-creates practice tasks for weak areas and stale skills
- **Analytics** tracks streaks, trends, and progress over time

All commands are available through Telegram (via Gemini natural language or direct commands) and CLI.

---

## Setup

The Skill Engine is deployed with the repo. No additional setup needed — it activates automatically on server start.

Verify it's loaded:

```bash
tardis plugin list
```

Or from Telegram:

```
plugin skill-engine help
```

### Requirements

- TARDIS v2.0.0+
- The plugin uses a shared SQLite database (`/var/lib/tardis/tardis.db`). The database and tables are created automatically on first use.

---

## Quick Start

**1. Add a skill:**

```
plugin skill-engine add-skill typescript tech
```
Or via Gemini: *"I want to learn TypeScript"*

**2. Start training:**

```
plugin skill-engine train typescript
```
Or via Gemini: *"Let's practice TypeScript"*

The engine picks a difficulty level based on your history (starts at 5/10).

**3. Complete training with a score:**

```
plugin skill-engine complete-training 85
```
Or via Gemini: *"I scored 85% on that"*

You'll see XP earned, your new level, and the recommended difficulty for next time.

**4. Check progress:**

```
plugin skill-engine progress typescript
```
Or via Gemini: *"How's my TypeScript going?"*

---

## Commands

All commands work from CLI (`tardis plugin run skill-engine <command>`) and Telegram (`plugin skill-engine <command>`).

### `add-skill <name> [category]`

Add a new skill to track.

- `name` — Skill name (stored lowercase)
- `category` — `tech` or `non-tech` (defaults to `tech`)

```
plugin skill-engine add-skill python tech
plugin skill-engine add-skill cooking non-tech
plugin skill-engine add-skill "public speaking" non-tech
```

### `remove-skill <name>`

Remove a tracked skill. Fuzzy-matches the name.

```
plugin skill-engine remove-skill python
```

### `skills`

List all tracked skills with their levels and XP progress.

```
plugin skill-engine skills
```

Output:
```
Skills:

Tech:
  typescript — Lv.3 [████████░░] 78%
  python — Lv.1 [██░░░░░░░░] 20%

Non-Tech:
  cooking — Lv.2 [█████░░░░░] 50%
```

### `train <skill> [type]`

Start a training session. The engine picks a difficulty level based on your recent performance.

- `skill` — Skill name (fuzzy-matched)
- `type` — `practice`, `quiz`, `challenge`, or `review` (defaults to `practice`)

Only one training session can be active at a time.

```
plugin skill-engine train typescript
plugin skill-engine train python quiz
```

### `complete-training <score>`

Complete the active training session with a score (0-100).

```
plugin skill-engine complete-training 85
plugin skill-engine complete-training 60
```

What happens on completion:
1. **XP is awarded** based on difficulty and score
2. **Level may increase** (you'll be notified)
3. **Difficulty adjusts** for next time
4. **Weak areas checked** — if score < 50%, the topic gets flagged
5. **Todoist task created** if a weak area is detected and `autoCreateTasks` is enabled

### `progress [skill]`

Show progress report. Without a skill name, shows overall stats.

```
plugin skill-engine progress              # Overall
plugin skill-engine progress typescript   # Specific skill
```

Skill progress includes: level, XP bar, success rate, trend (improving/stable/declining), streak, weak areas, and recent sessions.

### `weak-areas [skill]`

Show detected weak areas (unresolved).

```
plugin skill-engine weak-areas
plugin skill-engine weak-areas typescript
```

Weak areas are detected when you score below 50% on a topic 3+ times. They auto-resolve when you consistently score above 80%.

### `stats [period]`

Show analytics for a time period.

- `period` — `daily`, `weekly` (default), or `monthly`

```
plugin skill-engine stats
plugin skill-engine stats monthly
```

### `calibrate [target]`

View or set the target success rate for adaptive difficulty.

```
plugin skill-engine calibrate          # View current target
plugin skill-engine calibrate 80       # Set to 80%
```

Default: 85%. Range: 50-95%.

### `config [key] [value]`

View or set engine configuration.

```
plugin skill-engine config                          # View all
plugin skill-engine config autoCreateTasks          # View one
plugin skill-engine config autoCreateTasks false     # Set value
```

---

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `targetSuccessRate` | `0.85` | Target success rate for difficulty calibration (0.5-0.95) |
| `autoCreateTasks` | `true` | Auto-create Todoist tasks for weak areas and stale skills |
| `snapshotInterval` | `"daily"` | How often to take skill snapshots |
| `notifyOnLevelUp` | `true` | Send notification on level-up |
| `notifyOnWeakness` | `true` | Send notification when a weak area is detected |

---

## How It Works

### XP & Leveling

Every completed training session awards XP:

```
XP earned = 100 * (difficulty / 5) * score
```

- Difficulty 5, score 80% = 80 XP
- Difficulty 10, score 90% = 180 XP
- Difficulty 1, score 100% = 20 XP

Higher difficulty and higher scores earn more XP. The multiplier incentivizes attempting harder challenges.

Level is calculated from total XP with diminishing returns:

```
level = floor(sqrt(xp / 100))
```

| Level | XP Required |
|-------|-------------|
| 1 | 100 |
| 5 | 2,500 |
| 10 | 10,000 |
| 20 | 40,000 |
| 50 | 250,000 |

### Adaptive Difficulty

The engine analyzes your last 10 completed sessions for each skill:

| Avg Score | Action |
|-----------|--------|
| > 90% | Increase difficulty by 1 |
| 75% - 90% | Hold (in the zone) |
| < 75% | Decrease difficulty by 1 |

Difficulty is clamped between 1 and 10. The default target is 85% success rate, adjustable via the `calibrate` command.

### Weak Area Detection

When you score below 50% on a topic, the engine flags it as a potential weak area with a severity score (0.0-1.0):

- Each subsequent low score increases severity by 0.15
- Scoring above 80% decreases severity by 0.2
- Severity reaching 0 resolves the weak area

If `autoCreateTasks` is enabled, a Todoist task is created: *"Practice [skill]: [topic]"* with priority 3.

### Streaks

The engine tracks consecutive days with at least one completed training session. Streaks are shown in progress reports and stats.

### Session Hook

When a TARDIS time-tracking session is stopped, the Skill Engine checks if the session name matches any tracked skill. If a training session is active for that skill, it prompts you to complete it with a score.

---

## Gemini Integration

The Gemini assistant knows about the Skill Engine and can route natural language commands automatically:

| You say | What happens |
|---------|-------------|
| "I want to learn TypeScript" | Adds a new tech skill |
| "Let's practice Python" | Starts a training session |
| "I scored 85%" | Completes training with that score |
| "How's my cooking going?" | Shows progress report |
| "What skills am I tracking?" | Lists all skills |
| "Show my weekly stats" | Shows analytics |
| "What are my weak areas?" | Lists unresolved weak areas |

The assistant uses `run_plugin_command` to invoke skill-engine commands, so all functionality is available through natural conversation in Telegram.

---

## Database

The Skill Engine uses a shared SQLite database at `/var/lib/tardis/tardis.db`. Tables are created automatically on first use.

| Table | Purpose |
|-------|---------|
| `skills` | Tracked skills with name, category, level, XP |
| `training_sessions` | Training history with type, difficulty, score |
| `weak_areas` | Detected weak points with severity tracking |
| `skill_snapshots` | Periodic snapshots of skill levels for trend analysis |
| `engine_config` | Engine calibration data |

Data persists across server restarts and deploys. The database file is not backed up by the deploy script — back it up separately if needed.
