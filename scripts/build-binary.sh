#!/bin/bash
#
# Build standalone TARDIS binary
# Creates a single executable with no runtime dependencies
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$PROJECT_ROOT/packages/cli"
OUTPUT_NAME="tardis"
MAX_SIZE=$((10 * 1024 * 1024))  # 10MB

echo -e "${BLUE}🔨 Building TARDIS Binary${NC}\n"

# Step 1: Check dependencies
echo -e "${YELLOW}Step 1: Checking dependencies...${NC}"

if ! command -v bun &> /dev/null; then
    echo -e "${RED}✗ Error: Bun is not installed${NC}"
    echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo -e "${GREEN}✓ Bun found: $(bun --version)${NC}"

# Step 2: Install dependencies
echo -e "\n${YELLOW}Step 2: Installing dependencies...${NC}"
cd "$PROJECT_ROOT"

if [ ! -d "node_modules" ]; then
    echo "Installing root dependencies..."
    bun install
fi

cd "$CLI_DIR"
if [ ! -d "node_modules" ]; then
    echo "Installing CLI dependencies..."
    bun install
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"

# Step 3: Build binary
echo -e "\n${YELLOW}Step 3: Building binary...${NC}"
cd "$CLI_DIR"

# Detect platform
PLATFORM="$(uname -s)"
case "$PLATFORM" in
    Darwin*)
        OUTPUT_FILE="${OUTPUT_NAME}-macos"
        echo "Building for macOS..."
        ;;
    Linux*)
        OUTPUT_FILE="${OUTPUT_NAME}-linux"
        echo "Building for Linux..."
        ;;
    MINGW*|MSYS*|CYGWIN*)
        OUTPUT_FILE="${OUTPUT_NAME}-windows.exe"
        echo "Building for Windows..."
        ;;
    *)
        OUTPUT_FILE="${OUTPUT_NAME}"
        echo "Building for unknown platform: $PLATFORM"
        ;;
esac

# Build with Bun
echo "Compiling TypeScript to binary..."
bun build --compile --minify --sourcemap ./bin/tardis.ts --outfile "$OUTPUT_FILE"

if [ ! -f "$OUTPUT_FILE" ]; then
    echo -e "${RED}✗ Error: Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Binary built: $OUTPUT_FILE${NC}"

# Step 4: Check binary size
echo -e "\n${YELLOW}Step 4: Checking binary size...${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    BINARY_SIZE=$(stat -f%z "$OUTPUT_FILE")
else
    BINARY_SIZE=$(stat -c%s "$OUTPUT_FILE")
fi

BINARY_SIZE_MB=$(echo "scale=2; $BINARY_SIZE / 1024 / 1024" | bc)

echo "Binary size: ${BINARY_SIZE_MB} MB"

if [ "$BINARY_SIZE" -gt "$MAX_SIZE" ]; then
    echo -e "${YELLOW}⚠ Warning: Binary size (${BINARY_SIZE_MB} MB) exceeds target (10 MB)${NC}"
else
    echo -e "${GREEN}✓ Binary size OK${NC}"
fi

# Step 5: Test binary
echo -e "\n${YELLOW}Step 5: Testing binary...${NC}"

# Make executable
chmod +x "$OUTPUT_FILE"

# Test version
if ./"$OUTPUT_FILE" --version &> /dev/null; then
    VERSION=$(./"$OUTPUT_FILE" --version)
    echo -e "${GREEN}✓ Binary works! Version: $VERSION${NC}"
else
    echo -e "${RED}✗ Error: Binary test failed${NC}"
    exit 1
fi

# Test help
if ./"$OUTPUT_FILE" --help &> /dev/null; then
    echo -e "${GREEN}✓ Help command works${NC}"
else
    echo -e "${YELLOW}⚠ Warning: Help command test failed${NC}"
fi

# Step 6: Installation instructions
echo -e "\n${GREEN}✓ Build completed successfully!${NC}\n"

echo -e "${BLUE}Installation:${NC}"
echo ""
echo "# Move to system PATH:"
echo "  sudo mv $OUTPUT_FILE /usr/local/bin/tardis"
echo ""
echo "# Or install to user bin:"
echo "  mkdir -p ~/bin"
echo "  mv $OUTPUT_FILE ~/bin/tardis"
echo "  echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> ~/.bashrc"
echo ""
echo "# Or use from current directory:"
echo "  ./$OUTPUT_FILE --help"
echo ""

# Step 7: Show binary info
echo -e "${BLUE}Binary Information:${NC}"
echo "  Location: $CLI_DIR/$OUTPUT_FILE"
echo "  Size:     ${BINARY_SIZE_MB} MB"
echo "  Platform: $PLATFORM"
echo ""

# Optional: Create dist directory and copy binary
DIST_DIR="$PROJECT_ROOT/dist"
mkdir -p "$DIST_DIR"
cp "$OUTPUT_FILE" "$DIST_DIR/"
echo -e "${GREEN}✓ Binary also copied to: $DIST_DIR/$OUTPUT_FILE${NC}"

echo -e "\n${GREEN}🎉 Build complete!${NC}"
