# Installation Guide

This guide covers all methods for installing TARDIS on your system.

## Prerequisites

- **Bun** 1.0 or later
- **Node.js** 18 or later (alternative to Bun)
- **Git** (for source installation)

### Install Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Installation Methods

### Method 1: Install from Source (Recommended)

This method gives you the latest features and easy updates.

```bash
# Clone the repository
git clone https://github.com/yourusername/tardis.git
cd tardis

# Install dependencies
bun install

# Build packages
bun run build

# Test installation
./packages/cli/bin/tardis.ts --version

# Create global symlink (optional)
sudo ln -s $(pwd)/packages/cli/bin/tardis.ts /usr/local/bin/tardis

# Now you can use it globally
tardis --version
```

### Method 2: Build Standalone Binary

This creates a single executable file with no dependencies.

```bash
# Clone and build
git clone https://github.com/yourusername/tardis.git
cd tardis
bun install

# Build binary
cd packages/cli
bun build --compile --minify --sourcemap ./bin/tardis.ts --outfile tardis

# The binary is now at: packages/cli/tardis
# Test it
./tardis --version

# Move to PATH
sudo mv tardis /usr/local/bin/

# Or install to user bin
mkdir -p ~/bin
mv tardis ~/bin/
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc  # or ~/.zshrc
```

**Binary sizes:**
- macOS: ~40-50 MB
- Linux: ~35-45 MB
- Windows: ~40-50 MB

### Method 3: npm Package (Coming Soon)

```bash
# Global installation
npm install -g @tardis/cli

# Or with Bun
bun install -g @tardis/cli

# Or with pnpm
pnpm install -g @tardis/cli
```

### Method 4: Development Installation

For development and contributing:

```bash
# Clone repository
git clone https://github.com/yourusername/tardis.git
cd tardis

# Install dependencies
bun install

# Run in development mode
bun run dev

# Run tests
bun test

# Run type checking
bun run typecheck

# Run linter
bun run lint
```

## Post-Installation

### 1. Verify Installation

```bash
tardis --version
# Should output: 2.0.0

tardis --help
# Should show all available commands
```

### 2. Run Setup Wizard

```bash
tardis setup
```

This will guide you through:
- Todoist API token configuration
- Storage location setup
- Initial configuration

### 3. Get Todoist API Token

1. Go to https://todoist.com/app/settings/integrations/developer
2. Scroll to "API token"
3. Copy your token (40-character hexadecimal string)
4. Paste it when prompted during setup

### 4. Test Basic Commands

```bash
# Start a test session
tardis start "Test task"

# Check status
tardis status

# Stop the session
tardis stop
```

## Platform-Specific Instructions

### macOS

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and install TARDIS
git clone https://github.com/yourusername/tardis.git
cd tardis
bun install
bun run build

# Create symlink
sudo ln -s $(pwd)/packages/cli/bin/tardis.ts /usr/local/bin/tardis

# Or add to PATH in ~/.zshrc
echo 'export PATH="$PATH:/path/to/tardis/packages/cli/bin"' >> ~/.zshrc
source ~/.zshrc
```

### Linux

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and install TARDIS
git clone https://github.com/yourusername/tardis.git
cd tardis
bun install
bun run build

# Create symlink
sudo ln -s $(pwd)/packages/cli/bin/tardis.ts /usr/local/bin/tardis

# Or add to PATH in ~/.bashrc
echo 'export PATH="$PATH:/path/to/tardis/packages/cli/bin"' >> ~/.bashrc
source ~/.bashrc
```

### Windows

```powershell
# Install Bun
powershell -c "irm bun.sh/install.ps1 | iex"

# Clone and install TARDIS
git clone https://github.com/yourusername/tardis.git
cd tardis
bun install
bun run build

# Add to PATH
# Right-click "This PC" > Properties > Advanced System Settings
# Environment Variables > System Variables > Path > Edit
# Add: C:\path\to\tardis\packages\cli\bin

# Or use PowerShell profile
$profile
# Add: $env:PATH += ";C:\path\to\tardis\packages\cli\bin"
```

## Updating

### Source Installation

```bash
cd tardis
git pull origin main
bun install
bun run build
```

### Binary Installation

Download the latest binary and replace the old one:

```bash
# Backup current version
cp /usr/local/bin/tardis /usr/local/bin/tardis.backup

# Download and install new version
# (Replace with actual download steps when available)
```

## Uninstalling

### Remove Binary

```bash
# If installed globally
sudo rm /usr/local/bin/tardis

# If installed to ~/bin
rm ~/bin/tardis
```

### Remove Source Installation

```bash
# Remove symlink
sudo rm /usr/local/bin/tardis

# Remove source
rm -rf /path/to/tardis
```

### Remove Data (Optional)

```bash
# Remove all TARDIS data and configuration
rm -rf ~/.tardis

# Or backup first
mv ~/.tardis ~/.tardis.backup
```

## Troubleshooting

### Command Not Found

If `tardis` command is not found:

```bash
# Check if symlink exists
ls -la /usr/local/bin/tardis

# Check PATH
echo $PATH

# Try running directly
/path/to/tardis/packages/cli/bin/tardis.ts --version
```

### Permission Denied

If you get permission errors:

```bash
# Make script executable
chmod +x /path/to/tardis/packages/cli/bin/tardis.ts

# Or use sudo for symlink
sudo ln -sf $(pwd)/packages/cli/bin/tardis.ts /usr/local/bin/tardis
```

### Bun Not Found

If Bun is not installed:

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc

# Verify installation
bun --version
```

### TypeScript Errors

If you see TypeScript errors during build:

```bash
# Clean and rebuild
bun run clean
bun install
bun run build
```

## Next Steps

- Read the [Commands Reference](commands.md)
- Configure [Todoist Integration](todoist-setup.md)
- Learn about [Configuration Options](configuration.md)

## Getting Help

If you encounter issues:

1. Check [Troubleshooting](troubleshooting.md)
2. Search [GitHub Issues](https://github.com/yourusername/tardis/issues)
3. Ask in [Discussions](https://github.com/yourusername/tardis/discussions)
4. Open a new [Issue](https://github.com/yourusername/tardis/issues/new)
