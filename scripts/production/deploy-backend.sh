#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: deploy-backend.sh <exact-commit-sha> <targeted-test-path> [targeted-test-path ...]
EOF
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

COMMIT_SHA="$1"
shift
TEST_TARGETS=("$@")

[[ "$COMMIT_SHA" =~ ^[0-9a-f]{7,40}$ ]] || die "Commit must be an exact SHA"

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Missing required environment variable: $name"
}

require_var PROD_ROOT
require_var BACKEND_DIR
require_var PM2_ID
require_var APP_PORT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$PROD_ROOT" rev-parse --show-toplevel)"
WORKTREE_ROOT="${WORKTREE_ROOT:-$HOME/HRMS2-deploy-worktrees}"
mkdir -p "$WORKTREE_ROOT"

"$SCRIPT_DIR/preflight.sh"

git -C "$REPO_ROOT" fetch origin --prune
git -C "$REPO_ROOT" rev-parse --verify "$COMMIT_SHA^{commit}" >/dev/null

LIVE_HEAD="$(git -C "$PROD_ROOT" rev-parse HEAD)"
WORKTREE_DIR="$WORKTREE_ROOT/hrms2-backend-${COMMIT_SHA:0:12}"

git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_DIR" "$COMMIT_SHA"

cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$WORKTREE_DIR/backend"
npm ci
npm run typecheck
npm run build
npm test -- "${TEST_TARGETS[@]}"

mapfile -t changed_files < <(git -C "$WORKTREE_DIR" diff --name-only --diff-filter=AM "$LIVE_HEAD"...HEAD -- backend)
if [[ "${#changed_files[@]}" -eq 0 ]]; then
  die "No backend files changed between live HEAD and target commit"
fi

deleted_files="$(git -C "$WORKTREE_DIR" diff --name-only --diff-filter=D "$LIVE_HEAD"...HEAD -- backend || true)"
if [[ -n "$deleted_files" ]]; then
  printf 'Deleted files are not allowed in this deploy workflow:\n%s\n' "$deleted_files" >&2
  die "Aborting deployment because the target commit deletes files"
fi

patch_file="$(mktemp)"
trap 'rm -f "$patch_file"; cleanup' EXIT
git -C "$WORKTREE_DIR" diff --binary "$LIVE_HEAD"...HEAD -- "${changed_files[@]}" > "$patch_file"
git -C "$PROD_ROOT" apply --check "$patch_file"

BACKUP_DIR="$("$SCRIPT_DIR/backup-runtime.sh" deploy "${changed_files[@]}")"
printf 'backup_dir=%s\n' "$BACKUP_DIR"

for rel in "${changed_files[@]}"; do
  src="$WORKTREE_DIR/$rel"
  dst="$PROD_ROOT/$rel"
  [[ -e "$src" ]] || continue
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
done

cd "$BACKEND_DIR"
npm ci
pm2 restart "$PM2_ID" --update-env

if ! "$SCRIPT_DIR/verify-health.sh"; then
  printf 'Health checks failed after deploy; starting rollback.\n' >&2
  "$SCRIPT_DIR/rollback-backend.sh" "$BACKUP_DIR"
  die "Deployment rolled back after failed health checks"
fi

printf 'deploy_commit=%s\n' "$COMMIT_SHA"
printf 'backup_dir=%s\n' "$BACKUP_DIR"

