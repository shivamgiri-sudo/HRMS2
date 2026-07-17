#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

usage() {
  cat >&2 <<'EOF'
Usage: rollback-backend.sh [--dry-run] <backup-directory>
EOF
  exit 1
}

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Missing required environment variable: $name"
}

count_listeners() {
  lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { count += 1 } END { print count + 0 }'
}

assert_listener_count() {
  local expected="$1"
  local actual
  actual="$(count_listeners)"
  [[ "$actual" == "$expected" ]] || die "Expected $expected listener(s) on port $APP_PORT, found $actual"
}

assert_pm2_online() {
  if ! pm2 describe "$PM2_ID" 2>/dev/null | grep -Eqi 'status[[:space:]]*:?[[:space:]]+online'; then
    die "PM2 process $PM2_ID is not online"
  fi
}

checksum_file() {
  sha256sum "$1" | awk '{print $1}'
}

copy_tree() {
  local src="$1"
  local dst="$2"

  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$dst"
    rsync -a "$src/" "$dst/"
    return 0
  fi

  rm -rf "$dst"
  mkdir -p "$dst"
  cp -a "$src/." "$dst/"
}

generate_protected_hashes() {
  local rel path file
  for rel in backend/.env backend/eng.traineddata backend/private/ats-candidate-files backend/face-models; do
    path="$PROD_ROOT/$rel"
    if [[ -f "$path" ]]; then
      sha256sum "$path"
    elif [[ -d "$path" ]]; then
      while IFS= read -r -d '' file; do
        sha256sum "$file"
      done < <(find "$path" -type f -print0 | sort -z)
    fi
  done
}

verify_protected_hashes() {
  local baseline_file="$1"
  [[ -f "$baseline_file" ]] || return 0
  diff -u "$baseline_file" <(generate_protected_hashes) >/dev/null || die "Protected runtime data changed during rollback"
}

cleanup_runtime_dirs() {
  find "$PROD_ROOT/backend" -maxdepth 1 -type d \( -name 'dist.next-*' -o -name 'dist.previous-*' -o -name 'dist.restore-*' \) -exec rm -rf {} +
}

restore_runtime_tree() {
  local stamp="$1"
  local restore_dir="$PROD_ROOT/backend/dist.restore-$stamp"

  rm -rf "$restore_dir"
  copy_tree "$BACKUP_DIR/dist" "$restore_dir"

  if [[ -d "$PROD_ROOT/backend/dist" ]]; then
    mv "$PROD_ROOT/backend/dist" "$PROD_ROOT/backend/dist.previous-$stamp"
  fi
  mv "$restore_dir" "$PROD_ROOT/backend/dist"
}

BACKUP_DIR="${1:-}"
DRY_RUN=0
if [[ "$BACKUP_DIR" == "--dry-run" ]]; then
  DRY_RUN=1
  BACKUP_DIR="${2:-}"
fi

if [[ -z "$BACKUP_DIR" ]]; then
  usage
fi

require_var PROD_ROOT
require_var BACKEND_DIR
require_var PM2_ID
require_var APP_PORT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_META="$BACKUP_DIR/meta"
FROM_SHA="$(cat "$BACKUP_META/from-sha.txt" 2>/dev/null || true)"
TARGET_SHA="$(cat "$BACKUP_META/target-sha.txt" 2>/dev/null || true)"
DEPLOY_ID="$(basename "$BACKUP_DIR")"

[[ -d "$BACKUP_DIR" ]] || die "Backup directory not found: $BACKUP_DIR"
[[ -d "$BACKUP_DIR/source" ]] || die "Missing backup source tree: $BACKUP_DIR/source"
[[ -d "$BACKUP_DIR/dist" ]] || die "Missing backup dist tree: $BACKUP_DIR/dist"
[[ -n "$FROM_SHA" && "$FROM_SHA" =~ ^[0-9a-f]{40}$ ]] || die "Missing or invalid from-sha in backup metadata"

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'dry_run=1\n'
  printf 'would_switch_to=%s\n' "$FROM_SHA"
  printf 'would_restore_dist=%s\n' "$BACKUP_DIR/dist"
  printf 'would_cleanup_runtime_dirs=yes\n'
  printf 'would_run_npm_ci=yes\n'
  printf 'would_restart_pm2=%s\n' "$PM2_ID"
  exit 0
fi

status=0
attempt() {
  "$@" || {
    warn "Rollback step failed: $*"
    status=1
    return 1
  }
}

pm2 describe "$PM2_ID" >/dev/null 2>&1 || die "PM2 process $PM2_ID is not available"

attempt git -C "$PROD_ROOT" switch --detach "$FROM_SHA"
attempt test "$(git -C "$PROD_ROOT" rev-parse HEAD)" = "$FROM_SHA"
attempt test -z "$(git -C "$PROD_ROOT" status --porcelain=v1 --untracked-files=no)"
attempt cleanup_runtime_dirs
attempt cd "$BACKEND_DIR"
attempt npm ci
attempt restore_runtime_tree "$DEPLOY_ID"
attempt pm2 restart "$PM2_ID" --update-env
attempt assert_pm2_online
attempt assert_listener_count 1
attempt "$SCRIPT_DIR/verify-health.sh"
attempt assert_pm2_online
attempt assert_listener_count 1
attempt verify_protected_hashes "$BACKUP_DIR/meta/protected-hashes.txt"
attempt cleanup_runtime_dirs

printf 'rollback_from_sha=%s\n' "$FROM_SHA"
printf 'rollback_target_sha=%s\n' "${TARGET_SHA:-unknown}"
printf 'rollback_complete=yes\n'

if (( status != 0 )); then
  die "Rollback completed with one or more step failures"
fi
