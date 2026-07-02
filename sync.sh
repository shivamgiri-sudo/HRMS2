#!/usr/bin/env bash
# sync.sh — Pull latest from tausifansari-mcn/HRMS, rebase your commits on top, push back.
# Usage: bash sync.sh

set -e

UPSTREAM_REPO="https://github.com/tausifansari-mcn/HRMS.git"
ORIGIN_REPO="https://github.com/shivamgiri-sudo/HRMS1.git"
BRANCH="main"

echo ""
echo "========================================="
echo "  MAS Callnet HRMS — Sync with upstream"
echo "========================================="
echo ""

# Step 1: Fetch latest from upstream
echo "[1/4] Fetching latest from upstream ($UPSTREAM_REPO)..."
git fetch upstream

# Step 2: Show what's new
NEW_UPSTREAM=$(git log --oneline HEAD..upstream/$BRANCH 2>/dev/null | wc -l | tr -d ' ')
NEW_LOCAL=$(git log --oneline upstream/$BRANCH..HEAD 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo "  → New commits on upstream (others' work): $NEW_UPSTREAM"
echo "  → Your local commits not yet on upstream: $NEW_LOCAL"
echo ""

if [ "$NEW_UPSTREAM" -eq 0 ] && [ "$NEW_LOCAL" -eq 0 ]; then
  echo "✅ Already fully in sync. Nothing to do."
  exit 0
fi

if [ "$NEW_UPSTREAM" -gt 0 ]; then
  echo "  Upstream has these new commits:"
  git log --oneline HEAD..upstream/$BRANCH | sed 's/^/    /'
  echo ""
fi

# Step 3: Rebase local onto upstream
echo "[2/4] Rebasing local commits on top of upstream..."
if ! git rebase upstream/$BRANCH; then
  echo ""
  echo "⚠️  CONFLICT detected during rebase."
  echo ""
  echo "  To resolve:"
  echo "  1. Fix the conflicted files (look for <<<<<<< markers)"
  echo "  2. Run: git add <conflicted-file>"
  echo "  3. Run: git rebase --continue"
  echo "  4. Run this script again: bash sync.sh"
  echo ""
  exit 1
fi

echo ""
echo "✅ Rebase complete."
echo ""

# Step 4: Push to both remotes
echo "[3/4] Pushing to upstream ($UPSTREAM_REPO)..."
git push upstream $BRANCH

echo "[4/4] Pushing to origin fork ($ORIGIN_REPO)..."
git push origin $BRANCH --force-with-lease

echo ""
echo "========================================="
echo "✅ Sync complete!"
echo ""
git log --oneline -5
echo "========================================="
echo ""
