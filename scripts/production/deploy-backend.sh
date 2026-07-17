#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: deploy-backend.sh [--dry-run] <from-sha> <target-sha> [targeted-test-path ...]
EOF
  exit 1
}

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

if [[ $# -lt 2 ]]; then
  usage
fi

FROM_SHA="$1"
TARGET_SHA="$2"
shift 2
TEST_TARGETS=("$@")

[[ "$FROM_SHA" =~ ^[0-9a-f]{40}$ ]] || die "FROM_SHA must be a full 40-character commit SHA"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die "TARGET_SHA must be a full 40-character commit SHA"

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

"$SCRIPT_DIR/preflight.sh" deploy

git -C "$REPO_ROOT" fetch origin --prune
git -C "$REPO_ROOT" rev-parse --verify "$FROM_SHA^{commit}" >/dev/null
git -C "$REPO_ROOT" rev-parse --verify "$TARGET_SHA^{commit}" >/dev/null
git -C "$REPO_ROOT" merge-base --is-ancestor "$FROM_SHA" "$TARGET_SHA" || die "TARGET_SHA must descend from FROM_SHA"

LIVE_HEAD="$(git -C "$PROD_ROOT" rev-parse HEAD)"
[[ "$LIVE_HEAD" == "$FROM_SHA" ]] || die "Production HEAD $LIVE_HEAD does not match FROM_SHA $FROM_SHA"

if git -C "$REPO_ROOT" diff --name-only "$FROM_SHA" "$TARGET_SHA" -- frontend | grep -q .; then
  die "Frontend application changes are not allowed in this backend deployment workflow"
fi

WORKTREE_DIR="$WORKTREE_ROOT/hrms2-backend-${TARGET_SHA:0:12}"
git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_DIR" "$TARGET_SHA"

cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

copy_tree() {
  local src="$1"
  local dst="$2"

  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$dst"
    rsync -a --delete "$src/" "$dst/"
    return 0
  fi

  rm -rf "$dst"
  mkdir -p "$dst"
  cp -a "$src/." "$dst/"
}

copy_file() {
  local src="$1"
  local dst="$2"
  [[ -e "$src" ]] || die "Missing release file: $src"
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
}

cd "$WORKTREE_DIR/backend"
npm ci
npm run typecheck
npm run build
npm test -- "${TEST_TARGETS[@]}"

mapfile -t source_files < <(git -C "$WORKTREE_DIR" diff --name-only --diff-filter=AM "$FROM_SHA" "$TARGET_SHA" -- backend | awk '
  $0 !~ /^backend\/dist\// { print $0 }
' | awk '!seen[$0]++')

BACKUP_DIR=""
if (( DRY_RUN == 0 )); then
  BACKUP_DIR="$("$SCRIPT_DIR/backup-runtime.sh" deploy "$FROM_SHA" "$TARGET_SHA" "${source_files[@]}")"
  printf 'backup_dir=%s\n' "$BACKUP_DIR"
fi

mutate_release() {
  if (( DRY_RUN == 1 )); then
    printf 'dry_run=1\n'
    printf 'from_sha=%s\n' "$FROM_SHA"
    printf 'target_sha=%s\n' "$TARGET_SHA"
    printf 'source_files=%s\n' "${#source_files[@]}"
    printf 'runtime_sync=backend/dist\n'
    printf 'npm_ci=skipped\n'
    printf 'pm2_restart=skipped\n'
    return 0
  fi

  pm2 stop "$PM2_ID" >/dev/null 2>&1 || true
  copy_tree "$WORKTREE_DIR/backend/dist" "$PROD_ROOT/backend/dist"

  for rel in "${source_files[@]}"; do
    [[ -n "$rel" ]] || continue
    copy_file "$WORKTREE_DIR/$rel" "$PROD_ROOT/$rel"
  done

  cd "$BACKEND_DIR"
  npm ci
  pm2 restart "$PM2_ID" --update-env
}

if ! mutate_release; then
  if (( DRY_RUN == 0 )); then
    printf 'Deployment failed during runtime mutation; rolling back.\n' >&2
    "$SCRIPT_DIR/rollback-backend.sh" "$BACKUP_DIR" || true
  fi
  die "Deployment failed"
fi

if (( DRY_RUN == 0 )); then
  if ! "$SCRIPT_DIR/verify-health.sh"; then
    printf 'Health checks failed after deploy; starting rollback.\n' >&2
    "$SCRIPT_DIR/rollback-backend.sh" "$BACKUP_DIR"
    die "Deployment rolled back after failed health checks"
  fi

  printf 'deploy_from_sha=%s\n' "$FROM_SHA"
  printf 'deploy_target_sha=%s\n' "$TARGET_SHA"
  printf 'backup_dir=%s\n' "$BACKUP_DIR"
fi
