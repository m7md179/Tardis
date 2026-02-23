# Gemini Assistant v2 — Manual Test Script

Send each message below in Telegram to the **TARDIS bot**.  
Copy the bot's response after each one. After all tests, share the full chat so I can analyze what's working and what needs fixing.

> 💡 **Tip:** Between test groups, send  
> `plugin gemini-assistant clear`  
> to reset conversation history.

---

## Group 1: Adding Tasks (Basic)

- `add buy groceries`
- `add finish the report due tomorrow`
- `I need to submit the proposal by Friday`

---

## Group 2: Adding Tasks with Time

- `add meeting tomorrow at 3pm`
- `add interview tomorrow 15:00-16:00`
- `I have a meeting with client tomorrow at 10am it'll be 1 hour`
- `schedule dentist appointment next Monday 9am to 10am`
- `add standup meeting today 09:00-09:30`

---

## Group 3: Reschedule

- `reschedule the meeting to Friday`
- `move the interview to next week`
- `reschedule dentist to tomorrow at 2pm`

---

## Group 4: Update / Complete / Delete

- `rename the report to quarterly report`
- `change priority of groceries to urgent`
- `complete the groceries task`
- `delete the standup meeting`

---

## Group 5: Time Tracking

- `start working on the API`
- `what am I working on?`
- `take a break`
- `back at it`
- `I'm done`

---

## Group 6: Reminders

- `remind me to take a break in 30 minutes`
- `remind me to check email in 5 minutes`

---

## Group 7: Multi-step / Chaining

- `reschedule the meeting to Friday and start working on the report`
- `show me my tasks and then start working on the first one`

---

## Group 8: Conversation / Edge Cases

- `hello`
- `what can you do?`
- `start`
- `add`
- `list my tasks`

---

# What to Record

For each message, copy:

1. **Your message** (exactly as sent)
2. **Bot's response** (full text)
3. **Todoist check**
   - Did the task appear correctly in Todoist?
   - What due date/time does it show?

---

📸 Screenshot the full chat or copy-paste the text after completing all groups.
