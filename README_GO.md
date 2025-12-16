# TARDIS (Go Implementation)

A lightweight, offline-first CLI tool for tracking focused work time, built with Go.

TARDIS lets you start, pause, resume, and end work sessions directly from the terminal, automatically recording how long each task takes throughout the day. Sessions are stored locally and can be synced to a Google Sheet for easy review, reporting, and long-term tracking.

## Features

- **Zero friction**: One command, instant tracking
- **Local-first**: Your data stays on your machine
- **Human-readable logs**: Easy to audit and export
- **Built for developers**: Terminal-first workflow
- **Optional Google Sheets sync**: Sync your sessions to Google Sheets for long-term tracking

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

**Check status:**
```bash
tardis status
```

**Pause a session:**
```bash
tardis pause
```

**Resume a paused session:**
```bash
tardis resume
```

**Stop a session:**
```bash
tardis stop
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
- `current_session.json` - Active session (if any)
- `sessions/` - Archived sessions organized by date
- `credentials.json` - Google OAuth credentials (if configured)
- `token.json` - Google OAuth token (if configured)
- `sheets_config.json` - Google Sheets configuration (if configured)

## Examples

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
│   ├── log.go       # Log viewing command
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

