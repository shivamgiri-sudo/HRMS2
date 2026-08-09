#!/bin/bash

# Version Bump Script for Peoplo
# Usage: ./scripts/bump-version.sh <major|minor|patch>

set -e

VERSION_FILE="src/lib/version.ts"

# Get current version
CURRENT_VERSION=$(grep -oP 'APP_VERSION = "\K[0-9]+\.[0-9]+\.[0-9]+' "$VERSION_FILE")

if [ -z "$CURRENT_VERSION" ]; then
  echo "Error: Could not read current version from $VERSION_FILE"
  exit 1
fi

echo "Current version: $CURRENT_VERSION"

# Parse version components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Determine bump type
case "${1:-patch}" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "Usage: $0 <major|minor|patch>"
    echo "  major: Breaking changes (1.0.0 -> 2.0.0)"
    echo "  minor: New features (1.0.0 -> 1.1.0)"
    echo "  patch: Bug fixes (1.0.0 -> 1.0.1)"
    exit 1
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
TODAY=$(date +%Y-%m-%d)

echo "New version: $NEW_VERSION"

# Update version.ts
sed -i "s/APP_VERSION = \"$CURRENT_VERSION\"/APP_VERSION = \"$NEW_VERSION\"/" "$VERSION_FILE"

# Update release date in LOCAL_CHANGELOG
sed -i "s/date: \"[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\"/date: \"$TODAY\"/" "$VERSION_FILE"

echo ""
echo "✅ Version bumped from $CURRENT_VERSION to $NEW_VERSION"
echo ""
echo "Next steps:"
echo "  1. Update the changelog in src/lib/version.ts (LOCAL_CHANGELOG)"
echo "  2. Commit changes: git add . && git commit -m \"chore: bump version to $NEW_VERSION\""
echo "  3. Tag the release: git tag v$NEW_VERSION"
echo "  4. Push with tags: git push origin main --tags"
echo "  5. Create a GitHub release at https://github.com/redmonkin/core-hr-hub/releases/new"
