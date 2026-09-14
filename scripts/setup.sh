#!/bin/bash

# Setup script for Peoplo development environment
# Installs git hooks and prepares the development environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"
CUSTOM_HOOKS_DIR="$PROJECT_ROOT/scripts/hooks"

echo "🔧 Setting up Peoplo development environment..."
echo ""

# Check if we're in a git repository
if [ ! -d "$PROJECT_ROOT/.git" ]; then
  echo "❌ Error: Not a git repository. Please run from the project root."
  exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Install pre-commit hook
if [ -f "$CUSTOM_HOOKS_DIR/pre-commit" ]; then
  echo "📦 Installing pre-commit hook..."
  cp "$CUSTOM_HOOKS_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
  chmod +x "$HOOKS_DIR/pre-commit"
  echo "   ✅ Pre-commit hook installed"
else
  echo "   ⚠️  Pre-commit hook not found at $CUSTOM_HOOKS_DIR/pre-commit"
fi

# Make scripts executable
echo ""
echo "📦 Making scripts executable..."
chmod +x "$SCRIPT_DIR/bump-version.sh" 2>/dev/null && echo "   ✅ bump-version.sh" || true
chmod +x "$SCRIPT_DIR/setup.sh" 2>/dev/null && echo "   ✅ setup.sh" || true

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Available commands:"
echo "  ./scripts/bump-version.sh <major|minor|patch>  - Bump version"
echo ""
echo "Git hooks installed:"
echo "  pre-commit - Validates version format and changelog"
