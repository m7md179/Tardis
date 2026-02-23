# Commands Reference

Complete reference for all TARDIS commands.

## Table of Contents

- [Session Management](#session-management)
- [History & Analytics](#history--analytics)
- [Todoist Integration](#todoist-integration)
- [Data Management](#data-management)
- [Configuration](#configuration)

## Session Management

### `start <task>`

Start tracking a new task.

**Usage:**

```bash
tardis start "Write documentation"
tardis start "Code review" --time-window "[9am-5pm]"
```

**Arguments:**

- `task` (required) - Task name or search query

**Options:**

- `-t, --time-window <window>` - Time window (e.g., [9am-5pm])

**Behavior:**

1. Checks for duplicate active sessions
2. Searches Todoist for matching tasks
3. If multiple matches, shows picker
4. Extracts time window from Todoist description
5. Creates and saves active session

**Examples:**

```bash
# Start with exact task name
tardis start "Write API documentation"

# Start with fuzzy search (matches "Documentation")
tardis start "docs"

# Start with manual time window
tardis start "Meeting" --time-window "[14:00-15:00]"
```

---

### `stop [task]`

Stop tracking a task.

**Usage:**

```bash
tardis stop
tardis stop "Write documentation"
tardis stop --no-sync
```

**Arguments:**

- `task` (optional) - Task name to stop (uses current if omitted)

**Options:**

- `--no-sync` - Skip syncing to Todoist

**Behavior:**

1. Finds session to stop
2. Calculates total duration
3. Marks as COMPLETED
4. Syncs to Todoist (unless --no-sync)
5. Archives session to date folder

**Examples:**

```bash
# Stop current session
tardis stop

# Stop specific session
tardis stop "Documentation"

# Stop without syncing
tardis stop --no-sync
```

---

### `pause [task]`

Pause an active task.

**Usage:**

```bash
tardis pause
tardis pause "Write documentation"
```

**Arguments:**

- `task` (optional) - Task name to pause

**Behavior:**

1. Finds active session
2. Records pause timestamp
3. Changes status to PAUSED
4. Preserves session data

**Examples:**

```bash
# Pause current session
tardis pause

# Pause specific session
tardis pause "docs"
```

---

### `resume [task]`

Resume a paused task.

**Usage:**

```bash
tardis resume
tardis resume "Write documentation"
```

**Arguments:**

- `task` (optional) - Task name to resume

**Behavior:**

1. Finds paused session
2. Calculates pause duration
3. Records resume timestamp
4. Changes status back to ACTIVE

**Examples:**

```bash
# Resume most recent paused session
tardis resume

# Resume specific paused session
tardis resume "docs"
```

---

### `status [task]`

Show session status.

**Usage:**

```bash
tardis status
tardis status "Write documentation"
```

**Arguments:**

- `task` (optional) - Specific task to show (shows all if omitted)

**Output:**

```
Write documentation
Status:      ACTIVE
Started:     2024-01-15 09:00:00
Duration:    2h 15m
Time window: 09:00 - 17:00
Todoist:     task-123
```

**Examples:**

```bash
# Show all active sessions
tardis status

# Show specific task status
tardis status "docs"
```

---

### `list` / `ls`

List all active sessions in table format.

**Usage:**

```bash
tardis list
tardis ls
```

**Output:**

```
Active Sessions (2)

Task                  Status      Duration    Started
--------------------------------------------------------
Write documentation   ACTIVE      2h 15m      09:00:00
Code review          PAUSED      1h 30m      08:00:00

Use "tardis status <task>" for detailed status.
Use "tardis stop [task]" to end a session.
```

---

## History & Analytics

### `log [date]`

View session history.

**Usage:**

```bash
tardis log
tardis log 2024-01-15
tardis log all
```

**Arguments:**

- `date` (optional) - Date (YYYY-MM-DD), "all", or omit for today

**Examples:**

```bash
# View today's log
tardis log

# View specific date
tardis log 2024-01-15

# View all history (grouped by date)
tardis log all
```

**Output:**

```
Sessions for 2024-01-15 (5h 30m)

Task                  Status      Duration    Started
--------------------------------------------------------
Write documentation   COMPLETED   2h 15m      09:00:00
Code review          COMPLETED   1h 30m      11:30:00
Meeting              COMPLETED   45m         14:00:00

Total duration: 5h 30m
```

---

## Todoist Integration

### `tasks`

View tasks from Todoist.

**Usage:**

```bash
tardis tasks
tardis tasks --tomorrow
tardis tasks --week
```

**Options:**

- `--tomorrow` - Show tomorrow's tasks (with time windows)
- `--week` - Show this week's tasks (with time windows)

**Output:**

```
Todoist Tasks (5)

Task                  Time Window      Priority    Labels
---------------------------------------------------------
Write documentation   09:00-17:00      P3          work, docs
Code review           -                -           work
Team meeting          14:00-15:00      -           meeting

Start a task with: tardis start "<task name>"
```

---

### `sync`

Manually sync completed sessions to Todoist.

**Usage:**

```bash
tardis sync
```

**Behavior:**

1. Finds unsynced completed sessions with task IDs
2. Marks corresponding Todoist tasks as complete
3. Shows progress and results

**Output:**

```
Found 3 unsynced session(s):
  - Write documentation
  - Code review
  - Team meeting

Syncing 3 session(s)...
✓ Synced 3 session(s) to Todoist
```

---

### `complete [task]`

Mark a task as complete in Todoist (without stopping session).

**Usage:**

```bash
tardis complete "Write documentation"
```

**Arguments:**

- `task` (required) - Task name to complete

**Examples:**

```bash
# Complete task with fuzzy search
tardis complete "docs"

# Complete with exact name
tardis complete "Write API documentation"
```

---

## Data Management

### `delete <task>`

Delete a session by task name.

**Usage:**

```bash
tardis delete "Old task"
```

**Arguments:**

- `task` (required) - Task name to delete

**Behavior:**

1. Searches archived sessions (cannot delete active)
2. Shows matching sessions
3. Requires confirmation
4. Deletes all matching sessions

**Safety:**

- Cannot delete active sessions (must stop first)
- Shows preview before deletion
- Requires explicit confirmation

**Examples:**

```bash
# Delete by task name
tardis delete "Old task"

# Case-insensitive search
tardis delete "old task"
```

---

### `wipe`

Delete ALL sessions (active and archived).

**Usage:**

```bash
tardis wipe
```

**Behavior:**

1. Shows count of sessions to delete
2. Requires THREE confirmations:
   - Initial yes/no
   - Type "DELETE ALL"
   - Final yes/no
3. Deletes all data
4. Cannot be undone

**Safety:**

- Triple confirmation required
- Shows clear warnings
- Displays session counts

---

## Configuration

### `setup`

Run interactive setup wizard.

**Usage:**

```bash
tardis setup
```

**Flow:**

1. Check for existing configuration
2. Prompt for Todoist API token
3. Validate token (format + API test)
4. Save configuration
5. Show next steps

**Output:**

```
🚀 TARDIS Setup Wizard

Todoist Integration
Get your token from:
https://todoist.com/app/settings/integrations/developer

Enter your Todoist API token: ...
Validating token...
✓ Token is valid!

✓ Configuration saved!

Next Steps:
  1. Start a session:  tardis start "task name"
  2. View your tasks:  tardis tasks
  3. Check status:     tardis status
```

---

### `config`

Show or update configuration.

**Usage:**

```bash
tardis config
tardis config --show
tardis config --todoist-token YOUR_TOKEN
```

**Options:**

- `--show` - Show current configuration (default)
- `--todoist-token <token>` - Set Todoist API token

**Examples:**

```bash
# Show configuration
tardis config

# Update Todoist token
tardis config --todoist-token abc123...
```

**Output:**

```
TARDIS Configuration

Todoist:
API Token:       ***configured***
Sync Interval:   300s

Storage:
Type:            json
Archive after:   30 days
Location:        ~/.tardis/
```

---

## Global Options

All commands support these global options:

- `--help` - Show help for command
- `--version` - Show version number

**Examples:**

```bash
# Show version
tardis --version

# Show general help
tardis --help

# Show command help
tardis start --help
```

---

## Tips & Tricks

### Fuzzy Matching

Commands with task names support fuzzy matching:

```bash
# These all match "Write documentation":
tardis start "write"
tardis start "doc"
tardis start "Write doc"
```

### Time Windows

Add time windows to Todoist descriptions:

```
[9am-5pm] Task description
[14:00-15:30] Another task
```

TARDIS automatically extracts and uses these.

### Multiple Sessions

Track multiple tasks simultaneously:

```bash
tardis start "Task 1"
tardis start "Task 2"
tardis start "Task 3"
tardis list  # Shows all active
```

### Quick Workflows

```bash
# Start → Work → Stop
tardis start "Task" && ... && tardis stop

# Check status periodically
watch -n 60 tardis status

# Daily review
tardis log | less
```

---

## Exit Codes

- `0` - Success
- `1` - Error (no sessions, invalid input, API failure, etc.)

Use in scripts:

```bash
if tardis stop; then
  echo "Session stopped successfully"
else
  echo "Failed to stop session"
fi
```
