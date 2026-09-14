#!/bin/bash

# =============================================================================
# Update APP_VERSION in src/lib/version.ts based on the latest GitHub tag
# Fetches directly from https://github.com/redmonkin/core-hr-hub/tags
# =============================================================================

set -e

VERSION_FILE="src/lib/version.ts"
GITHUB_REPO="redmonkin/core-hr-hub"

# Fetch the latest tag from GitHub API
echo "📡 Fetching latest tag from GitHub..."
LATEST_TAG=$(curl -s "https://api.github.com/repos/${GITHUB_REPO}/tags" | grep -o '"name": "[^"]*"' | head -1 | sed 's/"name": "//;s/"//')

if [ -z "$LATEST_TAG" ]; then
  echo "⚠️  Could not fetch tags from GitHub. Keeping existing version."
  exit 0
fi

# Remove 'v' prefix if present (e.g., v1.0.1 -> 1.0.1)
VERSION="${LATEST_TAG#v}"

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "⚠️  Invalid version format: $VERSION (expected X.Y.Z)"
  exit 1
fi

echo "📦 Updating APP_VERSION to $VERSION (from tag $LATEST_TAG)"

# Check if file exists
if [ ! -f "$VERSION_FILE" ]; then
  echo "❌ Version file not found: $VERSION_FILE"
  exit 1
fi

# Update the APP_VERSION constant in version.ts
# Works on both macOS (BSD sed) and Linux (GNU sed)
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' "s/export const APP_VERSION = \"[^\"]*\"/export const APP_VERSION = \"$VERSION\"/" "$VERSION_FILE"
else
  # Linux
  sed -i "s/export const APP_VERSION = \"[^\"]*\"/export const APP_VERSION = \"$VERSION\"/" "$VERSION_FILE"
fi

echo "✅ Updated $VERSION_FILE with version $VERSION"

# Verify the change
grep "APP_VERSION" "$VERSION_FILE"
