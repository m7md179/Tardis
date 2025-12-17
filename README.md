# TARDIS

> A lightweight, offline-first CLI tool for tracking focused work time.

[![Go Version](https://img.shields.io/badge/go-1.21+-00ADD8?style=flat&logo=go)](https://golang.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Why TARDIS Exists

TARDIS started as a personal tool.

I wanted a simple way to answer a basic question at the end of the day:  
**"Did I actually work, or did I just feel busy?"**

I didn't set out to build a time-tracking product. I just needed something that could reliably tell me how long I was actually focused on a task, without forcing me into a workflow that didn't fit how I work.

I could have spent time trying and testing existing tools, but it was easier (and more flexible) to build something tailored to my own habits instead.

---

## What Problem It Solves (For Me)

TARDIS helps me keep an honest record of my work time.

Not to optimize productivity, and not to gamify anything — just to see:
- How long I spent on a task
- When I started and stopped focusing
- Whether a day was actually productive or just felt like it was

Being explicit about starting, pausing, and stopping a session makes it harder to lie to myself about how my time is spent.

---

## Design Philosophy

TARDIS is built around how I actually work:

- I spend most of my day in the terminal
- I want something fast enough that I won't avoid using it
- I want my data local and inspectable
- I don't want to depend on a service just to track time

That's why TARDIS is:
- **CLI-first**
- **Local-first**
- **Explicit**, not automatic

If I stop using it, my data is still there.  
If I want to inspect or modify it, I can.

---

## Why Google Sheets

Google Sheets wasn't chosen as a "backend" — it's used as a **convenient mirror**.

I wanted something that:
- Already exists
- Is reliable and well-tested
- Works as both a simple frontend and a cloud database
- Doesn't require me to build and maintain a UI

Sheets fits that role well.  
TARDIS continues to work without it, but syncing makes reviewing and organizing work over time easier.

---

## Quick Start

### Installation

Build and install TARDIS:

```bash
git clone <repository-url>
cd tardis
go build -o tardis main.go
sudo cp tardis /usr/local/bin/  # or use a symlink
```

Or install to your user directory:

```bash
mkdir -p ~/bin
cp tardis ~/bin/
# Add ~/bin to your PATH in ~/.zshrc or ~/.bashrc
```

### Basic Usage

**Start tracking a task:**
```bash
tardis start "Working on feature X"
```

**Check what's running:**
```bash
tardis list          # List all active sessions
tardis status        # Show status of current session
```

**Pause and resume:**
```bash
tardis pause         # Pause current session
tardis resume        # Resume paused session
```

**End a session:**
```bash
tardis stop          # Stop and save session
```

**View your logs:**
```bash
tardis log           # Today's sessions
tardis log 2024-01-15  # Specific date
tardis log all       # All historical sessions
```

**Manage sessions:**
```bash
tardis delete "task name"  # Delete a specific session
tardis wipe                # Delete all sessions (with confirmation)
```

That's it! TARDIS stores everything locally in `~/.tardis/`.

For detailed documentation, installation options, Google Sheets sync, and more examples, see **[README_GO.md](README_GO.md)**.

---

## Scope and Direction

TARDIS is primarily built for my own daily use.  
If other people find it useful, that's a bonus — not the main goal.

The project is intentionally kept small, but it's expected to evolve as my workflow evolves. Planned ideas include:

- Linking tracked tasks to **Git and GitHub workflows**
- Expanding session data to better reflect how work actually happens
- Improving logs and summaries in ways that are useful in day-to-day work

Anything added should make TARDIS more useful **without making it heavier or more complicated**.

---

## What TARDIS Is Not

TARDIS is not:
- A productivity system
- A task manager
- A project planner
- A SaaS product

It's simply a way to record work time honestly, with as little friction as possible.

---

## Documentation

For detailed information including:
- Complete installation instructions
- All available commands and options
- Google Sheets sync setup
- Task name matching rules
- Data storage structure
- Advanced usage examples

👉 See **[README_GO.md](README_GO.md)** for the full technical documentation.

---

## License

MIT
