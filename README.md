# TARDIS - Time Tracking CLI

⏰ **TARDIS** (Time And Resource Documentation & Insight System) is a powerful command-line time tracking tool that syncs seamlessly with Todoist.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black.svg)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

✨ **Smart Task Matching**
- Fuzzy search your Todoist tasks
- Auto-complete task names
- Extract time windows from descriptions

⏱️ **Session Management**
- Start, stop, pause, and resume sessions
- Track multiple tasks simultaneously
- Automatic duration calculation

📊 **Time Analytics**
- View daily, weekly, or all-time logs
- Formatted tables with colored output
- Export to CSV or JSON

🔄 **Todoist Integration**
- Automatic sync on session completion
- Manual sync for batch operations
- Mark tasks complete from CLI

💾 **Smart Storage**
- JSON-based local storage
- Automatic session archiving by date
- Migration from Go version included

## Quick Start

```bash
# Install dependencies
bun install

# Run setup wizard
bun run packages/cli/bin/tardis.ts setup

# Start tracking
bun run packages/cli/bin/tardis.ts start "Write documentation"

# Check status
bun run packages/cli/bin/tardis.ts status

# Stop and sync
bun run packages/cli/bin/tardis.ts stop
```

## Installation

### Option 1: From Source

```bash
git clone https://github.com/yourusername/tardis.git
cd tardis
bun install
bun run build

# Create symlink (optional)
ln -s $(pwd)/packages/cli/bin/tardis.ts /usr/local/bin/tardis
```

### Option 2: Build Binary

```bash
bun install
cd packages/cli
bun build --compile --minify --sourcemap ./bin/tardis.ts --outfile tardis

# Move to PATH
sudo mv tardis /usr/local/bin/
```

## Commands

### Session Management

```bash
# Start a task
tardis start "Write documentation"
tardis start "Code review" --time-window "[9am-5pm]"

# Stop current task
tardis stop

# Stop specific task
tardis stop "Write documentation"

# Pause task
tardis pause

# Resume task
tardis resume

# Check status
tardis status

# List all active sessions
tardis list
```

### History & Analytics

```bash
# View today's log
tardis log

# View specific date
tardis log 2024-01-15

# View all history
tardis log all
```

### Todoist Integration

```bash
# View Todoist tasks
tardis tasks

# Sync completed sessions
tardis sync

# Complete task in Todoist
tardis complete "Task name"
```

### Data Management

```bash
# Delete session by task name
tardis delete "Old task"

# Wipe all data (requires confirmation)
tardis wipe
```

### Configuration

```bash
# Run setup wizard
tardis setup

# Show configuration
tardis config --show

# Set Todoist token
tardis config --todoist-token YOUR_TOKEN
```

## Time Windows

Add time windows to your Todoist task descriptions:

```
[9am-5pm] Write documentation
[14:00-15:30] Team meeting
```

TARDIS will extract and display these time windows automatically.

## Configuration

Configuration is stored at `~/.tardis/config.json`:

```json
{
  "todoist": {
    "apiToken": "your-token-here",
    "syncInterval": 300
  },
  "storage": {
    "type": "json",
    "archiveAfterDays": 30
  }
}
```

Get your Todoist API token from:
https://todoist.com/app/settings/integrations/developer

## Data Storage

TARDIS stores data in `~/.tardis/`:

```
~/.tardis/
├── config.json              # Configuration
├── active_sessions/         # Currently active sessions
│   └── task_*.json
└── sessions/                # Archived sessions by date
    ├── 2024-01-15/
    │   ├── task1_*.json
    │   └── task2_*.json
    └── 2024-01-16/
        └── task3_*.json
```

## Migration from Go Version

If you have data from the Go version of TARDIS:

```bash
# Automatic migration (happens on first use)
tardis status

# Or run manual migration script
bun run scripts/migrate-from-go.ts
```

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run dev

# Run tests
bun test

# Run linter
bun run lint

# Type check
bun run typecheck

# Build all packages
bun run build
```

## Project Structure

```
tardis/
├── packages/
│   ├── shared/           # Shared types and utilities
│   └── cli/             # CLI application
├── scripts/             # Build and migration scripts
└── docs/               # Documentation
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © [Your Name]

## Acknowledgments

- Built with [Bun](https://bun.sh/)
- Powered by [Todoist API](https://developer.todoist.com/)
- Inspired by the original Go implementation

## Support

- 📖 [Documentation](docs/)
- 🐛 [Issue Tracker](https://github.com/yourusername/tardis/issues)
- 💬 [Discussions](https://github.com/yourusername/tardis/discussions)

---

Made with ❤️ and TypeScript
