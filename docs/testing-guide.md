# Testing Guide — v2.1 Features

Step-by-step guide to deploy, test, and verify every new feature.

---

## 1. Deploy

Push and deploy to the server:

```bash
git add -A && git commit -m "feat: Skill Engine, shared DB, Gemini improvements"
./scripts/deploy.sh
```

Check the logs for successful startup:

```bash
ssh root@192.168.100.9 "pct exec 106 -- journalctl -u tardis -n 30 --no-pager"
```

You should see:
- `Starting TARDIS Server v2.0.0`
- `[plugin:skill-engine] Skill Engine activated`
- `[plugin:gemini-assistant] Gemini Assistant v2 active`
- `TARDIS Server ready!`

---

## 2. Todoist Token from Telegram

### Test: Set token

Open your Telegram chat with the TARDIS bot and send:

```
config todoist YOUR_TODOIST_API_TOKEN
```

Expected response: confirms the token was set.

### Test: Verify it works

```
tasks
```

Should show your Todoist tasks. If you see them, the token is working.

### Test: Persistence

Restart the server:

```bash
ssh root@192.168.100.9 "pct exec 106 -- systemctl restart tardis"
```

Then in Telegram:

```
tasks
```

Should still work — the token was saved to `config.json`.

### Test: Check token status

```
config todoist
```

Should tell you the token is set (without showing the full token).

---

## 3. Telegram Autocomplete

### Test: Slash menu

In the Telegram chat, type `/` and wait. You should see a menu pop up with all commands:

- `/start` — Start tracking a task
- `/stop` — Stop current task
- `/pause` — Pause current session
- `/tasks` — Show Todoist tasks
- etc.

Tap any command to auto-fill it.

---

## 4. Plugin Help Command

### Test: From Telegram

```
plugin skill-engine help
```

Should show:
- Plugin name, version, description
- All 10 commands with arguments
- Hooks: `session:stop`
- Config keys

```
plugin gemini-assistant help
```

Should show Gemini's commands: `ask`, `config`, `clear`.

```
plugin pomodoro-timer help
```

Should show pomodoro commands: `start`, `config`, `stats`.

### Test: From CLI

```bash
tardis plugin run skill-engine help
tardis plugin run gemini-assistant help
```

Same output through the CLI.

---

## 5. Skill Engine

### 5a. Add skills

From Telegram:

```
plugin skill-engine add-skill typescript tech
plugin skill-engine add-skill python tech
plugin skill-engine add-skill cooking non-tech
```

Each should confirm the skill was added at Lv.1.

**Test duplicate:** Send `plugin skill-engine add-skill typescript tech` again — should tell you it already exists.

### 5b. List skills

```
plugin skill-engine skills
```

Should show all 3 skills grouped by category (Tech / Non-Tech), each at Lv.1 with a progress bar.

### 5c. Start training

```
plugin skill-engine train typescript
```

Should respond with:
- Training started: typescript
- Type: practice
- Difficulty: 5/10 (default for new skills)
- Instructions to complete

**Test double start:** Send `plugin skill-engine train python` — should tell you there's already an active session.

### 5d. Complete training

```
plugin skill-engine complete-training 85
```

Should respond with:
- Score: 85%
- XP earned (should be ~85 XP for difficulty 5, score 0.85)
- Current level
- Success rate and recommended difficulty for next time

**Test low score:**

```
plugin skill-engine train typescript
plugin skill-engine complete-training 30
```

Should show a weak area warning (if `notifyOnWeakness` is on). Do this 2 more times with low scores to trigger weak area detection.

### 5e. Check progress

```
plugin skill-engine progress typescript
```

Should show: level, XP bar, success rate, trend, streak, weak areas (if any), recent sessions.

```
plugin skill-engine progress
```

Without a skill name — shows overall stats across all skills.

### 5f. Weak areas

After several low scores on a topic:

```
plugin skill-engine weak-areas
```

Should list detected weak areas with severity scores.

### 5g. Stats

```
plugin skill-engine stats
plugin skill-engine stats daily
plugin skill-engine stats monthly
```

Each should show session counts, XP, success rate, and skill breakdown for the period.

### 5h. Calibrate difficulty

```
plugin skill-engine calibrate
```

Should show current target (85%).

```
plugin skill-engine calibrate 80
```

Should confirm the new target.

### 5i. Config

```
plugin skill-engine config
```

Should list all config keys and values.

```
plugin skill-engine config autoCreateTasks false
plugin skill-engine config autoCreateTasks
```

Should set and then show the updated value.

### 5j. Remove skill

```
plugin skill-engine remove-skill cooking
plugin skill-engine skills
```

Cooking should be gone from the list.

---

## 6. Gemini Natural Language

These tests verify that Gemini correctly routes natural language to the right functions, including the Skill Engine.

### 6a. Skill commands via natural language

Send these as plain text messages (no `/` prefix):

```
I want to learn React
```

Should add a new "react" skill.

```
What skills am I tracking?
```

Should list your skills.

```
Let's practice typescript
```

Should start a training session.

```
I scored 90% on that
```

Should complete the training with 90% score and show XP.

```
How's my typescript going?
```

Should show progress report.

```
What are my weak areas?
```

Should list weak areas (or say there are none).

### 6b. Multi-step chaining

Test that Gemini chains multiple functions:

```
Add a meeting tomorrow at 2pm and start tracking it
```

Should call `add_task` then `start_tracking` automatically.

```
I'm done with the meeting, mark it complete
```

Should call `stop_tracking` then `complete_task`.

```
Start working on the standup
```

If something is already being tracked, Gemini should stop the current session first, then start the new one.

### 6c. Task management

```
What's on my list?
```

Should show Todoist tasks.

```
Move the meeting to Friday
```

Should reschedule the task.

```
Remind me to take a break in 25 minutes
```

Should set a reminder (you'll get a notification in 25 minutes).

### 6d. Plugin command routing

```
Start a pomodoro for documentation
```

Should invoke the pomodoro-timer plugin via `run_plugin_command`.

---

## 7. Time Format Fix

### Test: 12hr format handling

Via Gemini:

```
Add a meeting tomorrow from 2pm to 3:30pm
```

Then check the task in Todoist — the description should contain `[14:00-15:30]` (24hr format), not `[2pm-3:30pm]`.

```
Schedule a standup today at 9:30am to 10am
```

Todoist description should show `[09:30-10:00]`.

---

## 8. Database Persistence

### Test: Data survives restart

1. Add a skill and complete a training session
2. Restart the server:
   ```bash
   ssh root@192.168.100.9 "pct exec 106 -- systemctl restart tardis"
   ```
3. Check skills:
   ```
   plugin skill-engine skills
   ```
   Should still show your skills with the correct XP and level.

4. Check progress:
   ```
   plugin skill-engine progress typescript
   ```
   Should show your training history.

### Test: Database file exists

```bash
ssh root@192.168.100.9 "pct exec 106 -- ls -la /var/lib/tardis/tardis.db"
```

Should show the SQLite file.

---

## 9. Todoist Auto-Tasks

### Test: Weak area task creation

1. Make sure `autoCreateTasks` is on:
   ```
   plugin skill-engine config autoCreateTasks true
   ```

2. Complete 3 training sessions with scores below 50%:
   ```
   plugin skill-engine train typescript
   plugin skill-engine complete-training 30
   ```
   (repeat 3 times)

3. Check Todoist:
   ```
   tasks
   ```

   Should see a task like "Practice typescript: general" created automatically.

---

## Troubleshooting

**Plugin not loading:**
Check logs: `journalctl -u tardis -n 50 --no-pager`
Look for errors like `Plugin "skill-engine" lacks permission: db:write` — means the manifest permissions don't match.

**Database errors:**
Check the DB file exists and is writable: `ls -la /var/lib/tardis/tardis.db`
The directory `/var/lib/tardis/` must be writable by the TARDIS process.

**Gemini not responding:**
Verify the API key is set: `plugin gemini-assistant config`
Check logs for rate limit or API errors.

**Token not persisting:**
Check `config.json` is writable: `ls -la /var/lib/tardis/config.json`
The server writes to this file when you run `config todoist <token>`.

**Skill not found:**
Skill names are stored lowercase. Use the exact name or a close match — the fuzzy matcher handles partial matches.
