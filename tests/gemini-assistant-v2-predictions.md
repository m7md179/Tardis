# Gemini Assistant v2 — Test Predictions

> Generated from code review on 2026-02-14
> Compare with actual results to identify gaps.

---

## Routing Note

Messages in Telegram go through `commands.ts`. Known commands (`start`, `stop`, `pause`, `resume`, `status`, `list`, `tasks`, `add`, `help`, `test`, `plugin`) are handled directly. **Everything else** falls through to the Gemini assistant via `pluginManager.runCommand('gemini-assistant', 'ask', [ctx.message.text])`.

This means:

- `add buy groceries` → handled by **Telegram's `handleAdd`**, NOT Gemini
- `I need to submit the proposal by Friday` → handled by **Gemini** (no matching command)
- `start working on the API` → handled by **Telegram's `handleStart`** with args "working on the API"

---

## Group 1: Adding Tasks (basic)

### `add buy groceries`

**Route:** Telegram `handleAdd` (direct command match)
**Predicted behavior:** `parseAddFlags("buy groceries")` extracts content="buy groceries", no due date, no time window, no priority. Calls `todoist.createTask("buy groceries")`.
**Predicted response:** `✅ Task created: *buy groceries*`
**Todoist:** Task "buy groceries" with no due date.
**Potential issue:** None expected.

### `add finish the report due tomorrow`

**Route:** Telegram `handleAdd`
**Predicted behavior:** Depends on `parseAddFlags`. If it recognizes `due:tomorrow` syntax only (colon-separated), then the full string "finish the report due tomorrow" becomes the task name with no due date parsed. If it parses `due tomorrow` (space-separated), then content="finish the report" with due="tomorrow".
**Predicted response (likely):** `✅ Task created: *finish the report due tomorrow*` (no due date parsed)
**Todoist:** Task named "finish the report due tomorrow" with NO due date — the word "due" is treated as part of the task name.
**Potential issue:** The `add` command uses `due:value` flag syntax (colon, no space). "due tomorrow" won't be parsed as a due date flag. The user likely expects "tomorrow" as the due date. This is a **UX gap** — natural language due dates don't work with the direct `add` command; they only work through Gemini.

### `I need to submit the proposal by Friday`

**Route:** Gemini assistant (no command prefix match)
**Predicted behavior:** Gemini interprets natural language, calls `add_task` with `name: "Submit the proposal"` and `due_date: "Friday"`.
**Predicted response:** Something like "Added 'Submit the proposal' due Friday." (short, casual per system prompt)
**Todoist:** Task "Submit the proposal" due next Friday.
**Potential issue:** None expected — this is Gemini's sweet spot.

---

## Group 2: Adding Tasks with Time

### `add meeting tomorrow at 3pm`

**Route:** Telegram `handleAdd`
**Predicted behavior:** `parseAddFlags("meeting tomorrow at 3pm")` — content becomes "meeting tomorrow at 3pm" literally. No `[time]` brackets, no `due:` flag.
**Predicted response:** `✅ Task created: *meeting tomorrow at 3pm*`
**Todoist:** Task named "meeting tomorrow at 3pm" with NO due date and NO time. The natural language is in the name, not parsed.
**Potential issue:** **Major UX gap.** User expects a task called "meeting" due tomorrow at 3pm. The direct `add` command doesn't parse natural language dates/times — it requires `add Meeting [3pm-4pm] due:tomorrow` syntax.

### `add interview tomorrow 15:00-16:00`

**Route:** Telegram `handleAdd`
**Predicted behavior:** `parseAddFlags` looks for `[brackets]` for time windows. "15:00-16:00" without brackets won't be parsed as a time window.
**Predicted response:** `✅ Task created: *interview tomorrow 15:00-16:00*`
**Todoist:** Task named "interview tomorrow 15:00-16:00" with no due date, no time window.
**Potential issue:** Same as above — no natural language parsing in the direct command.

### `I have a meeting with client tomorrow at 10am it'll be 1 hour`

**Route:** Gemini assistant (natural language)
**Predicted behavior:** Gemini calls `add_task` with `name: "Meeting with client"`, `due_date: "tomorrow"`, `time_window: "10am-11am"`.
**Predicted response:** Something like "Added 'Meeting with client' for tomorrow, 10am-11am."
**Todoist:** Task "Meeting with client" due tomorrow, description contains `[10am-11am]`.
**Potential issue:** Gemini might calculate 10am + 1 hour = 11am correctly. If not, time_window might be missing or wrong.

### `schedule dentist appointment next Monday 9am to 10am`

**Route:** Gemini assistant ("schedule" is not a recognized command)
**Predicted behavior:** Gemini calls `add_task` with `name: "Dentist appointment"`, `due_date: "next Monday"`, `time_window: "9am-10am"`.
**Predicted response:** Something like "Scheduled 'Dentist appointment' for next Monday, 9am-10am."
**Todoist:** Task "Dentist appointment" due next Monday, description `[9am-10am]`.
**Potential issue:** None expected.

### `add standup meeting today 09:00-09:30`

**Route:** Telegram `handleAdd`
**Predicted behavior:** `parseAddFlags("standup meeting today 09:00-09:30")` — no brackets, no `due:` flag. Everything becomes the task name.
**Predicted response:** `✅ Task created: *standup meeting today 09:00-09:30*`
**Todoist:** Task named literally "standup meeting today 09:00-09:30" with no due date.
**Potential issue:** Same `add` command limitation. User expects parsed time.

---

## Group 3: Reschedule

> All these should route to Gemini since "reschedule" and "move" are not recognized Telegram commands.

### `reschedule the meeting to Friday`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `reschedule_task` with `task_query: "meeting"`, `new_due_date: "Friday"`.

- Fuzzy match searches for tasks containing "meeting".
- If tasks from Group 2 were created, multiple may match ("meeting tomorrow at 3pm", "Meeting with client", "standup meeting today 09:00-09:30").
- If multiple non-exact matches → returns "Multiple tasks match" error with list.
- Gemini would then present the list to the user and ask which one.
  **Predicted response:** Likely asks "Which meeting? I found: [list]" OR reschedules if only one match.
  **Todoist:** Depends on disambiguation result.
  **Potential issue:** Multiple fuzzy matches expected given test data.

### `move the interview to next week`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `reschedule_task` with `task_query: "interview"`, `new_due_date: "next week"`.

- Fuzzy match finds "interview tomorrow 15:00-16:00" (contains "interview").
- Single match → reschedules.
  **Predicted response:** "Moved 'interview tomorrow 15:00-16:00' to next week."
  **Todoist:** Due date changes to next week (Todoist interprets "next week" as next Monday typically).
  **Potential issue:** The task NAME still contains "tomorrow 15:00-16:00" which is now stale/misleading. The name won't be updated, only the due date.

### `reschedule dentist to tomorrow at 2pm`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `reschedule_task` with `task_query: "dentist"`, `new_due_date: "tomorrow at 2pm"`.

- Fuzzy match finds "Dentist appointment".
- Reschedules with `due_string: "tomorrow at 2pm"`.
  **Predicted response:** "Rescheduled 'Dentist appointment' to tomorrow at 2pm."
  **Todoist:** Due date updated to tomorrow at 2pm. The time window in description (`[9am-10am]`) remains unchanged (stale).
  **Potential issue:** Description time window is NOT updated. Only `due_string` changes. The old `[9am-10am]` in the description is now wrong.

---

## Group 4: Update/Complete/Delete

### `rename the report to quarterly report`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `update_task` with `task_query: "report"`, `new_name: "quarterly report"`.

- Fuzzy match for "report" — finds "finish the report due tomorrow" (contains "report").
- Updates content to "quarterly report".
  **Predicted response:** "Renamed to 'quarterly report'."
  **Todoist:** Task name changes from "finish the report due tomorrow" to "quarterly report".
  **Potential issue:** If "quarterly report" was also created earlier as "Submit the proposal" and "report" matches multiple, disambiguation needed.

### `change priority of groceries to urgent`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `update_task` with `task_query: "groceries"`, `new_priority: 4`.

- Gemini should map "urgent" → priority 4.
- Fuzzy match finds "buy groceries".
  **Predicted response:** "Updated priority of 'buy groceries' to urgent."
  **Todoist:** Priority changes to 4 (p1 in Todoist UI — note: Todoist API priority 4 = Todoist UI "Priority 1"/urgent).
  **Potential issue:** Priority mapping (API vs UI numbering is inverted in Todoist). Gemini might send 4 for urgent which is correct per the function description.

### `complete the groceries task`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `complete_task` with `task_query: "groceries"`.

- Fuzzy match finds "buy groceries".
- Calls `api.tasks.complete(taskId)` → Todoist `/close` endpoint.
  **Predicted response:** "Done! 'buy groceries' marked as complete."
  **Todoist:** Task disappears from active list (completed).
  **Potential issue:** None expected.

### `delete the standup meeting`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `delete_task` with `task_query: "standup meeting"`.

- Fuzzy match finds the standup task.
- Calls `api.tasks.delete(taskId)`.
  **Predicted response:** "Deleted 'standup meeting today 09:00-09:30'."
  **Todoist:** Task permanently removed.
  **Potential issue:** If "standup meeting" also matches other meeting tasks, disambiguation may trigger.

---

## Group 5: Time Tracking

### `start working on the API`

**Route:** **Telegram `handleStart`** — "start" is a recognized command!
**Predicted behavior:** `handleStart(ctx, "working on the API", todoist)`. Fuzzy matches "working on the API" against Todoist tasks. Likely NO Todoist match (no task named that). Falls through to literal name.
**Predicted response:**

```
✅ Started tracking: *working on the API*
⏰ Started at: HH:MM
```

**Potential issue:** This goes through Telegram's direct handler, NOT Gemini. Works fine but bypasses Gemini's personality. The task name is literally "working on the API" — user might have expected just "API".

### `what am I working on?`

**Route:** Gemini assistant (not a recognized command)
**Predicted behavior:** Gemini calls `get_status`. Returns the active session "working on the API" with its duration.
**Predicted response:** "You're working on 'working on the API' — been at it for Xm."
**Potential issue:** None expected.

### `take a break`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `pause_tracking`. Pauses the active session.
**Predicted response:** "Paused. Enjoy your break!"
**Potential issue:** None expected.

### `back at it`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `resume_tracking`. Resumes the paused session.
**Predicted response:** "Resumed 'working on the API'. Let's go!"
**Potential issue:** None expected.

### `I'm done`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `stop_tracking`. Stops the active session, returns duration.
**Predicted response:** "Stopped 'working on the API' — total time: Xm. Nice work!"
**Potential issue:** None expected. Note: this does NOT auto-complete in Todoist (the Gemini `stop_tracking` handler doesn't call `completeTask`, unlike the direct Telegram `stop` command).

---

## Group 6: Reminders

### `remind me to take a break in 30 minutes`

**Route:** Gemini assistant
**Predicted behavior:** Gemini calls `set_reminder` with `message: "take a break"`, `delay_minutes: 30`. Timer created via `setTimeout`. After 30 min, sends notification "🔔 Reminder: take a break".
**Predicted response:** "Got it! I'll remind you to take a break in 30 minutes."
**Potential issue:** Timer is in-memory only. If the server restarts, the reminder is lost.

### `remind me to check email in 5 minutes`

**Route:** Gemini assistant
**Predicted behavior:** Same as above, `message: "check email"`, `delay_minutes: 5`.
**Predicted response:** "I'll remind you in 5 minutes to check your email."
**Potential issue:** Same in-memory limitation.

---

## Group 7: Multi-step / Chaining

### `reschedule the meeting to Friday and start working on the report`

**Route:** Gemini assistant
**Predicted behavior:** Gemini should chain two function calls (up to 5 iterations):

1. `reschedule_task(task_query: "meeting", new_due_date: "Friday")`
2. `start_tracking(task_name: "report")` or `start_tracking(task_name: "quarterly report")`
   **Predicted response:** "Rescheduled the meeting to Friday and started tracking 'quarterly report'."
   **Potential issue:**

- "meeting" may hit multiple fuzzy matches → first call fails → Gemini asks for clarification instead of chaining
- If first call fails, second may still be attempted or skipped depending on Gemini's behavior

### `show me my tasks and then start working on the first one`

**Route:** Gemini assistant
**Predicted behavior:** Gemini chains:

1. `list_tasks()` — gets all tasks
2. `start_tracking(task_name: <first task's name>)` — starts tracking the first one
   **Predicted response:** Lists tasks, then confirms started tracking the first one.
   **Potential issue:** Gemini might only call `list_tasks` and present the list, then wait for user input instead of automatically starting the first task. The system prompt says "bias toward action" but "first one" is contextual.

---

## Group 8: Conversation / Edge Cases

### `hello`

**Route:** Gemini assistant (not a recognized command)
**Predicted behavior:** No function call. Gemini responds conversationally per personality.
**Predicted response:** Something like "Hey Mohammad! What are you working on?" or "Hey! Need help with anything?"
**Potential issue:** None.

### `what can you do?`

**Route:** Gemini assistant
**Predicted behavior:** Gemini describes its capabilities based on system prompt.
**Predicted response:** Brief list: track time, manage Todoist tasks, set reminders, etc.
**Potential issue:** None.

### `start`

**Route:** Telegram `start` command handler (line 93-99)
**Predicted behavior:** `args` is empty string. The handler checks `if (args)` — false, so it falls through. Then lines 93-99 show it checks for args and if empty, it likely shows a welcome message or usage.
**Predicted response:** `Usage: start <task name>\n\nExample: start Write documentation` (from line 141)
**Potential issue:** None — but this bypasses Gemini entirely.

### `add`

**Route:** Telegram `handleAdd` (line 163-164 checks `if (!args)`)
**Predicted behavior:** Empty args → shows usage message.
**Predicted response:**

```
❌ Task name is required.

Usage: add <task name> [time window] [due:value] [p:1-4]

Examples:
  add Buy groceries
  add Meeting [2pm-3pm] due:tomorrow
  add Urgent fix [14:00-16:00] p:4
```

**Potential issue:** None — correct behavior.

### `list my tasks`

**Route:** Gemini assistant ("list my tasks" doesn't match "list" exactly as a first word... actually let me check)
**Actually:** The command parser splits on first space. First word is "list" → matches case 'list' → calls `handleList(ctx)` which shows active **sessions**, not Todoist tasks.
**Predicted behavior:** Shows active tracking sessions (not Todoist tasks).
**Predicted response:** Either "No active sessions." or lists any active sessions.
**Potential issue:** **Confusing!** User said "list my tasks" (meaning Todoist) but gets session list. The "list" command shows sessions, "tasks" command shows Todoist tasks. "my tasks" gets stripped as args to `handleList`. User likely wants `tasks` or Gemini's `list_tasks`.

---

## Summary of Predicted Issues

| #   | Issue                                                                                               | Severity   | Affected Tests                     |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| 1   | `add` command doesn't parse natural language dates/times — requires `due:value` and `[time]` syntax | **High**   | Group 1 (#2), Group 2 (#1, #2, #5) |
| 2   | `start` command intercepts before Gemini — loses personality/smart parsing                          | **Low**    | Group 5 (#1)                       |
| 3   | Reschedule doesn't update description time windows (stale `[9am-10am]`)                             | **Medium** | Group 3 (#3)                       |
| 4   | Task names include unparsed date/time text (e.g. "meeting tomorrow at 3pm")                         | **Medium** | Group 2 (#1, #2, #5)               |
| 5   | `list` command shows sessions, not tasks — "list my tasks" is misleading                            | **Medium** | Group 8 (#5)                       |
| 6   | `stop_tracking` via Gemini doesn't auto-complete Todoist task (direct `stop` does)                  | **Low**    | Group 5 (#5)                       |
| 7   | Reminders are in-memory only, lost on restart                                                       | **Low**    | Group 6                            |
| 8   | Multiple "meeting" tasks cause disambiguation in reschedule                                         | **Low**    | Group 3 (#1)                       |
