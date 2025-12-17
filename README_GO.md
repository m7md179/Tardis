# TARDIS (Go Implementation)

A lightweight, offline-first CLI tool for tracking focused work time, built with Go.

TARDIS lets you start, pause, resume, and end work sessions directly from the terminal, automatically recording how long each task takes throughout the day. Sessions are stored locally and can be synced to a Google Sheet for easy review, reporting, and long-term tracking.

## Features

- **Zero friction**: One command, instant tracking
- **Multiple concurrent tasks**: Track multiple tasks simultaneously
- **Unique task names**: Prevents duplicate task names to keep your sessions organized
- **Task selection**: Specify which task to pause, resume, stop, or check status
- **Local-first**: Your data stays on your machine
- **Human-readable logs**: Easy to audit and export
- **Built for developers**: Terminal-first workflow
- **Optional Google Sheets sync**: Sync your sessions to Google Sheets for long-term tracking
- **Session management**: List, delete, or wipe sessions as needed

## Installation

### Prerequisites

- Go 1.21 or higher

### Option 1: Install Globally (Recommended)

**For macOS/Linux:**

1. Clone this repository:
```bash
git clone <repository-url>
cd tardis
```

2. Build and install:
```bash
go build -o tardis main.go
sudo cp tardis /usr/local/bin/
```

Or use a symlink (no sudo needed if `/usr/local/bin` is writable):
```bash
go build -o tardis main.go
ln -s $(pwd)/tardis /usr/local/bin/tardis
```

**For Homebrew users (macOS):**
```bash
# If /opt/homebrew/bin is in your PATH
go build -o tardis main.go
cp tardis /opt/homebrew/bin/
```

3. Verify installation:
```bash
tardis --help
```

### Option 2: Install to User Directory

1. Build the binary:
```bash
go build -o tardis main.go
```

2. Add to your local bin directory:
```bash
mkdir -p ~/bin
cp tardis ~/bin/
```

3. Add `~/bin` to your PATH (add to `~/.zshrc` or `~/.bashrc`):
```bash
export PATH="$HOME/bin:$PATH"
```

4. Reload your shell:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

### Option 3: Use Go Install (if module is published)

If this module is published to a repository:
```bash
go install <repository-url>@latest
```

### Option 4: Build from Source (Development)

1. Clone this repository:
```bash
git clone <repository-url>
cd tardis
```

2. Install dependencies:
```bash
go mod download
```

3. Build the binary:
```bash
go build -o tardis main.go
```

4. Run directly:
```bash
./tardis --help
```

## Usage

### Basic Commands

**Start a session:**
```bash
tardis start "Working on feature X"
```
Note: Task names must be unique among active sessions. If you try to start a task with the same name as an active task, you'll be prompted to stop the existing one first.

**List all active sessions:**
```bash
tardis list
```
Shows all currently active and paused sessions with their status, duration, and start time.

**Check status:**
```bash
tardis status              # Shows status of most recent session
tardis status "task name"  # Shows status of specific task
```

**Pause a session:**
```bash
tardis pause               # Pauses most recent session
tardis pause "task name"   # Pauses specific task
```

**Resume a paused session:**
```bash
tardis resume              # Resumes most recent paused session
tardis resume "task name"  # Resumes specific task
```

**Stop a session:**
```bash
tardis stop                # Stops most recent session
tardis stop "task name"    # Stops specific task
tardis stop --no-sync      # Stops without syncing to Google Sheets
```

**View today's logs:**
```bash
tardis log
```

**View logs for a specific date:**
```bash
tardis log 2024-01-15
```

**View all historical logs:**
```bash
tardis log all
```

**Delete a session:**
```bash
tardis delete "task name"
```
Deletes a session (active or archived) by task name. This permanently removes the session from storage.

**Wipe all sessions:**
```bash
tardis wipe
```
Deletes all active and archived sessions. This action cannot be undone and requires confirmation.

### Task Name Matching

When specifying a task name for pause, resume, stop, status, or delete commands:
- **Exact match** (case-insensitive): `tardis pause "My Task"` matches exactly "My Task"
- **Prefix match**: If the search term is shorter and the task name starts with it, it will match. For example, `tardis pause "test"` can match "test3" or "test4" (if only one matches)
- If multiple tasks match, you'll be asked to be more specific

### Google Sheets Sync (Optional)

1. **Set up Google Cloud credentials:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the Google Sheets API
   - Create credentials (OAuth 2.0 Client ID) for a Desktop application
   - Download the credentials JSON file
   - Save it as `~/.tardis/credentials.json`

2. **Authenticate:**
```bash
tardis auth
```
   This will display a URL. Visit it in your browser. After authorizing, you'll get a code. Run:
```bash
tardis auth <code>
```

3. **Configure your spreadsheet:**
```bash
tardis config --spreadsheet-id <your-spreadsheet-id>
```
   You can find the spreadsheet ID in the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`

4. **Set up your Google Sheet:**
   Create a sheet with these headers in row 1:
   - Date
   - Start Time
   - End Time
   - Duration
   - Duration (seconds)
   - Task

5. **Sync sessions:**
   Sessions are automatically synced when you stop them. To skip sync:
```bash
tardis stop --no-sync
```

## Data Storage

All session data is stored locally in `~/.tardis/`:
- `active_sessions/` - Active sessions (one file per session)
- `sessions/` - Archived sessions organized by date
- `credentials.json` - Google OAuth credentials (if configured)
- `token.json` - Google OAuth token (if configured)
- `sheets_config.json` - Google Sheets configuration (if configured)

Note: The old `current_session.json` format is automatically migrated to the new `active_sessions/` directory structure.

## Examples

### Working with Multiple Tasks

```bash
# Start multiple tasks
$ tardis start "Frontend development"
Session started!
Task: Frontend development
Started at: 2024-01-15 09:00:00

$ tardis start "Backend API"
Session started!
Task: Backend API
Started at: 2024-01-15 09:15:00

# List all active tasks
$ tardis list
Active Sessions (2):

1. Backend API
   Status: ACTIVE
   Started: 2024-01-15 09:15:00
   Duration: 0:05

2. Frontend development
   Status: ACTIVE
   Started: 2024-01-15 09:00:00
   Duration: 0:20

# Check status of a specific task
$ tardis status "Frontend development"
Status: ACTIVE
Task: Frontend development
Started: 2024-01-15 09:00:00
Duration: 0:25

# Pause a specific task
$ tardis pause "Backend API"
Session paused.
Task: Backend API
Duration before pause: 0:10

# Resume the paused task
$ tardis resume "Backend API"
Session resumed.
Task: Backend API
Current duration: 0:10

# Stop a specific task
$ tardis stop "Frontend development"
Session stopped!
Task: Frontend development
Duration: 1:30
Ended at: 2024-01-15 10:30:00
✓ Synced to Google Sheets
```

### Unique Task Names

```bash
# Try to start a duplicate task name
$ tardis start "Project A"
Session started!
Task: Project A
Started at: 2024-01-15 09:00:00

$ tardis start "Project A"
Error: A task with the name 'Project A' is already active.
Started: 2024-01-15 09:00:00
Use 'tardis stop "Project A"' to end it first, or choose a different name.
```

### Session Management

```bash
# Delete a specific session from storage
$ tardis delete "Old Task Name"
Session 'Old Task Name' deleted successfully.

# Wipe all sessions (requires confirmation)
$ tardis wipe
Warning: This will delete ALL sessions (active and archived). Are you sure? (yes/no): yes
All sessions deleted successfully.
```

### Basic Workflow

```bash
# Start working on a task
$ tardis start "Implementing user authentication"
Session started!
Task: Implementing user authentication
Started at: 2024-01-15 09:00:00

# Check how long you've been working
$ tardis status
Status: ACTIVE
Task: Implementing user authentication
Started: 2024-01-15 09:00:00
Duration: 1:23

# Take a break
$ tardis pause
Session paused.
Task: Implementing user authentication
Duration before pause: 1:23

# Resume work
$ tardis resume
Session resumed.
Task: Implementing user authentication
Current duration: 1:23

# Finish the task
$ tardis stop
Session stopped!
Task: Implementing user authentication
Duration: 2:15
Ended at: 2024-01-15 11:15:00
✓ Synced to Google Sheets

# Review your day
$ tardis log
Sessions for 2024-01-15:

  Task: Implementing user authentication
  Time: 09:00:00 - 11:15:00
  Duration: 2:15

  Task: Code review
  Time: 14:00:00 - 15:30:00
  Duration: 1:30

Total time: 3:45
```

## Project Structure

```
tardis/
├── cmd/              # CLI commands
│   ├── root.go      # Root command and initialization
│   ├── start.go     # Start session command
│   ├── stop.go      # Stop session command
│   ├── pause.go     # Pause session command
│   ├── resume.go    # Resume session command
│   ├── status.go    # Status command
│   ├── list.go      # List active sessions command
│   ├── log.go       # Log viewing command
│   ├── delete.go    # Delete session command
│   ├── wipe.go      # Wipe all sessions command
│   ├── auth.go      # Google OAuth authentication
│   ├── config.go    # Configuration command
│   └── sheets.go    # Google Sheets sync helper
├── internal/
│   ├── session/     # Session management
│   │   └── session.go
│   ├── storage/     # Local storage
│   │   └── storage.go
│   └── sheets/      # Google Sheets integration
│       └── sheets.go
├── main.go          # Entry point
└── go.mod           # Go module definition
```

## Development

### Running Tests

```bash
go test ./...
```

### Building for Different Platforms

```bash
# Linux
GOOS=linux GOARCH=amd64 go build -o tardis-linux main.go

# macOS
GOOS=darwin GOARCH=amd64 go build -o tardis-darwin main.go

# Windows
GOOS=windows GOARCH=amd64 go build -o tardis-windows.exe main.go
```

## License

MIT
