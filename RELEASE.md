# Release Process

This document describes how to create a new release of Peoplo.

## Version Numbering

Peoplo follows [Semantic Versioning](https://semver.org/):

- **Major** (X.0.0): Breaking changes that require migration
- **Minor** (0.X.0): New features, backward compatible
- **Patch** (0.0.X): Bug fixes, backward compatible

## Quick Release Steps

### 1. Bump Version

Run the version bump script:

```bash
# For bug fixes
./scripts/bump-version.sh patch

# For new features
./scripts/bump-version.sh minor

# For breaking changes
./scripts/bump-version.sh major
```

### 2. Update Changelog

Edit `src/lib/version.ts` and update the `LOCAL_CHANGELOG` array with your changes:

```typescript
const LOCAL_CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.1.0",
    date: "2025-01-20",
    type: "minor",
    title: "New Feature Release",
    description: "Added new functionality",
    changes: [
      { type: "feature", text: "Added employee bulk import" },
      { type: "fix", text: "Fixed date picker timezone issue" },
      { type: "security", text: "Updated dependencies" },
    ],
  },
  // ... previous versions
];
```

### 3. Commit and Tag

```bash
git add .
git commit -m "chore: release v1.1.0"
git tag v1.1.0
git push origin main --tags
```

### 4. Create GitHub Release

1. Go to [GitHub Releases](https://github.com/redmonkin/core-hr-hub/releases/new)
2. Select your new tag (e.g., `v1.1.0`)
3. Set the release title (e.g., "v1.1.0 - New Feature Release")
4. Add release notes using this format:

```markdown
## New Features
- Added employee bulk import
- Added CSV export for reports

## Bug Fixes
- Fixed date picker timezone issue
- Fixed pagination on mobile

## Security
- Updated dependencies to patch vulnerabilities
```

5. Click **Publish Release**

## How Version Checking Works

### For Self-Hosted Users

1. The app includes a hardcoded `APP_VERSION` constant
2. On startup, the app calls the `version-check` edge function
3. The edge function fetches the latest release from GitHub API
4. If a newer version exists, users see an update notification
5. Users can then pull the latest changes from GitHub

### For Lovable Cloud Users

Updates are applied automatically when the code is deployed.

## Change Types

Use these types in your changelog entries:

| Type | Description |
|------|-------------|
| `feature` | New functionality |
| `fix` | Bug fixes |
| `security` | Security patches |
| `docs` | Documentation updates |
| `breaking` | Breaking changes |

## Development Setup

Run the setup script to install git hooks:

```bash
./scripts/setup.sh
```

This installs:
- **Pre-commit hook**: Validates version format (semver) and ensures `LOCAL_CHANGELOG` contains an entry for the current `APP_VERSION`

## Git Hooks

### Pre-commit Hook

The pre-commit hook runs automatically when you commit changes to `src/lib/version.ts` and validates:

1. **Version format**: Must be valid semver (X.Y.Z)
2. **Changelog entry**: `LOCAL_CHANGELOG` must contain an entry matching `APP_VERSION`
3. **Fallback sync**: Warns if `FALLBACK_VERSION_RESPONSE.currentVersion` doesn't match

To bypass the hook in emergencies:
```bash
git commit --no-verify -m "your message"
```

## Manual Version Bump

If you prefer not to use the script, manually edit `src/lib/version.ts`:

```typescript
// Update this line
export const APP_VERSION = "1.1.0";
```

And update `FALLBACK_VERSION_RESPONSE.releaseDate` to today's date.
