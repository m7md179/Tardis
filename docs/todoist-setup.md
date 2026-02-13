# Todoist Setup Guide

This guide explains how to set up and configure Todoist integration with TARDIS.

## Getting Your API Token

### Step 1: Access Todoist Settings

1. Go to [Todoist](https://todoist.com/)
2. Log in to your account
3. Click your profile picture (top right)
4. Select "Settings"

### Step 2: Navigate to Integrations

1. In settings, click "Integrations"
2. Scroll to "Developer" section
3. Find "API token"

### Step 3: Copy Your Token

1. Click "Copy to clipboard" next to your API token
2. Your token is a 40-character hexadecimal string
3. Keep it secure - treat it like a password!

**Example token format:**
```
abc123def456...xyz789
```

## Configuring TARDIS

### Method 1: Setup Wizard (Recommended)

Run the interactive setup wizard:

```bash
tardis setup
```

Follow the prompts:
1. Paste your Todoist API token when asked
2. TARDIS will validate the token
3. Configuration is saved automatically

### Method 2: Manual Configuration

Set the token directly:

```bash
tardis config --todoist-token YOUR_TOKEN_HERE
```

### Method 3: Edit Config File

Edit `~/.tardis/config.json`:

```json
{
  "todoist": {
    "apiToken": "your-token-here",
    "syncInterval": 300
  }
}
```

## Verifying Configuration

Test your Todoist connection:

```bash
# View your tasks
tardis tasks

# If successful, you'll see your Todoist tasks
```

## Using Todoist Integration

### Time Windows in Task Descriptions

Add time windows to your Todoist task descriptions:

**Format:**
```
[START-END] Task description
```

**Examples:**
```
[9am-5pm] Write documentation
[14:00-15:30] Team meeting
[09:00-12:00] Morning development
```

**Supported formats:**
- 12-hour: `[9am-5pm]`, `[1PM-3PM]`
- 24-hour: `[09:00-17:00]`, `[14:00-15:30]`

### Starting Tasks from Todoist

TARDIS automatically matches your input with Todoist tasks:

```bash
# Exact match
tardis start "Write documentation"

# Fuzzy match (finds "Write documentation")
tardis start "write"
tardis start "docs"

# If multiple matches, you'll see a picker
```

### Automatic Syncing

When you stop a session, TARDIS automatically marks the task complete in Todoist:

```bash
tardis start "Write docs"  # Matches Todoist task
# ... work on task ...
tardis stop                # Marks task complete in Todoist
```

### Manual Syncing

Sync all unsynced sessions at once:

```bash
tardis sync
```

This is useful if:
- You used `--no-sync` when stopping
- Previous sync attempts failed
- You want to batch sync multiple sessions

## Todoist Workflows

### Workflow 1: Task-Driven Time Tracking

1. Create tasks in Todoist with time windows
2. Use `tardis tasks` to view them
3. Start tasks directly: `tardis start "task name"`
4. TARDIS extracts time window automatically
5. When done, `tardis stop` marks task complete

```bash
# Morning routine
tardis tasks                    # View today's tasks
tardis start "Morning emails"   # Start first task
tardis stop                     # Complete and sync
tardis start "Write code"       # Next task
```

### Workflow 2: Offline Mode

TARDIS works without Todoist:

```bash
# Start task without Todoist
tardis start "Local task"

# Track normally
tardis pause
tardis resume
tardis stop --no-sync  # Stop without syncing
```

### Workflow 3: Retrospective Sync

Track tasks offline, sync later:

```bash
# Work offline
tardis start "Task 1" --no-sync
tardis stop --no-sync

tardis start "Task 2" --no-sync
tardis stop --no-sync

# Sync all at once when online
tardis sync
```

## Troubleshooting

### Token Validation Failed

**Problem:** "Invalid token" or "Could not connect to Todoist"

**Solutions:**
1. Verify token is exactly 40 hexadecimal characters
2. Check for extra spaces or newlines
3. Ensure you copied the entire token
4. Try generating a new token in Todoist

```bash
# Test token directly
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.todoist.com/api/v1/tasks
```

### No Tasks Found

**Problem:** `tardis tasks` shows "No tasks found"

**Solutions:**
1. Check you have active tasks in Todoist
2. Verify token has correct permissions
3. Check internet connection
4. Try refreshing: `tardis sync`

### Sync Failures

**Problem:** Tasks not syncing to Todoist

**Solutions:**
1. Check internet connection
2. Verify Todoist is accessible
3. Check task has valid Todoist ID
4. Try manual sync: `tardis sync`
5. Check logs for specific errors

### Time Windows Not Detected

**Problem:** Time windows not showing in `tardis tasks`

**Solutions:**
1. Verify format: `[9am-5pm]` or `[09:00-17:00]`
2. Check brackets are square brackets `[]`
3. Ensure time window is in task description (not title)
4. Start time must be before end time

**Example task description:**
```
[9am-5pm] Complete API documentation

This task involves writing comprehensive API docs.
```

### Multiple Matches

**Problem:** Too many tasks match your search

**Solution:** Be more specific:

```bash
# Instead of:
tardis start "doc"  # Might match many tasks

# Use:
tardis start "api doc"  # More specific
tardis start "Write API documentation"  # Exact match
```

## Best Practices

### 1. Consistent Task Naming

Use clear, unique task names in Todoist:

✅ Good:
- "Write API documentation"
- "Code review: PR #123"
- "Team standup meeting"

❌ Avoid:
- "Work"
- "Task"
- "Meeting" (too generic)

### 2. Time Window Format

Always use brackets and valid times:

✅ Good:
- `[9am-5pm] Task`
- `[09:00-17:00] Task`
- `[14:00-15:30] Task`

❌ Avoid:
- `9am-5pm Task` (no brackets)
- `[9-5] Task` (missing am/pm)
- `[17:00-09:00] Task` (end before start)

### 3. Organize with Projects

Use Todoist projects to organize work:

```
Work Project:
  [9am-12pm] Morning development
  [14:00-16:00] Code review

Personal Project:
  [19:00-20:00] Exercise
  [20:00-21:00] Reading
```

### 4. Use Labels

Tag tasks with labels for better organization:

```
@work @coding [9am-12pm] Implement feature
@work @meeting [14:00-15:00] Team standup
@personal [19:00-20:00] Gym workout
```

Filter by label in Todoist, start from TARDIS:

```bash
tardis tasks
# Shows tasks with their labels
```

### 5. Regular Syncing

Sync regularly to keep data current:

```bash
# At end of day
tardis sync

# Check what was synced
tardis log
```

## Advanced Configuration

### Custom Sync Interval

Edit `~/.tardis/config.json`:

```json
{
  "todoist": {
    "apiToken": "your-token",
    "syncInterval": 600  // 10 minutes (default: 300)
  }
}
```

### Project Filtering (Future Feature)

```json
{
  "todoist": {
    "apiToken": "your-token",
    "projectId": "123456789",  // Only show this project
    "labelFilter": ["work", "coding"]  // Only these labels
  }
}
```

## Security

### Token Security

Your Todoist API token is stored in plain text at `~/.tardis/config.json`.

**Security recommendations:**
1. Set appropriate file permissions:
   ```bash
   chmod 600 ~/.tardis/config.json
   ```

2. Don't commit config to git:
   ```bash
   echo ".tardis/" >> ~/.gitignore
   ```

3. Revoke token if compromised:
   - Go to Todoist Settings > Integrations
   - Click "Revoke" next to API token
   - Generate new token
   - Update TARDIS: `tardis setup`

### Rate Limits

Todoist API has rate limits:
- 450 requests per 15 minutes
- TARDIS makes minimal requests
- Caches tasks locally
- Syncs only when needed

## Getting Help

If you're still having issues:

1. Check [Todoist API Status](https://status.todoist.com/)
2. Review [Todoist API Documentation](https://developer.todoist.com/api/v1/)
3. Search [TARDIS Issues](https://github.com/yourusername/tardis/issues)
4. Ask in [Discussions](https://github.com/yourusername/tardis/discussions)

## Related Documentation

- [Installation Guide](installation.md)
- [Commands Reference](commands.md)
- [Configuration Guide](configuration.md)
