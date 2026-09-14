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

get_pm2_status() {
  PM2_TARGET_ID="$PM2_ID" pm2 jlist | PM2_TARGET_ID="$PM2_ID" node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const processes = JSON.parse(input);
        const targetId = String(process.env.PM2_TARGET_ID);
        const processInfo = processes.find(item => String(item.pm_id) === targetId);
        if (!processInfo) process.exit(2);
        process.stdout.write(String(processInfo.pm2_env?.status ?? ""));
      } catch {
        process.exit(3);
      }
    });
  '
}

assert_pm2_status() {
  local expected="$1"
  local actual
  if ! actual="$(get_pm2_status)"; then
    die "Unable to read PM2 status for process $PM2_ID"
  fi
  [[ "$actual" == "$expected" ]] || die "Expected PM2 process $PM2_ID to be $expected, found ${actual:-unknown}"
}

assert_pm2_online() {
  assert_pm2_status online
}

assert_pm2_stopped() {
  assert_pm2_status stopped
}

assert_pm2_stopping() {
  assert_pm2_status stopping
}

assert_pm2_errored() {
  assert_pm2_status errored
}

checksum_file() {
  sha256sum "$1" | awk '{print $1}'
}

copy_tree() {
  local src="$1"
  local dst="$2"

  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$dst"
    rsync -a "$src/" "$dst/" || return $?
    return 0
  fi

  rm -rf "$dst"
  mkdir -p "$dst"
  cp -a "$src/." "$dst/" || return $?
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
  rm -rf \
    "$PROD_ROOT/backend/dist.next-$TARGET_SHA" \
    "$PROD_ROOT/backend/dist.previous-$DEPLOY_ID" \
    "$PROD_ROOT/backend/dist.restore-$DEPLOY_ID"
}

restore_runtime_tree() {
  local stamp="$1"
  local restore_dir="$PROD_ROOT/backend/dist.restore-$stamp"

  rm -rf "$restore_dir"
  copy_tree "$BACKUP_DIR/dist" "$restore_dir" || return $?

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
[[ "$FROM_SHA" =~ ^[0-9a-f]{40}$ ]] || die "Missing or invalid from-sha in backup metadata"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die "Missing or invalid target-sha in backup metadata"
[[ "$DEPLOY_ID" =~ ^[A-Za-z0-9._-]+$ ]] || die "Unsafe backup deployment identifier"

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'dry_run=1\n'
  printf 'would_switch_to=%s\n' "$FROM_SHA"
  printf 'would_restore_dist=%s\n' "$BACKUP_DIR/dist"
  printf 'would_cleanup_runtime_dirs=yes\n'
  printf 'would_run_npm_ci=yes\n'
  printf 'would_restart_pm2=%s\n' "$PM2_ID"
  exit 0
fi

rollback_status=0
failed_steps=()

attempt() {
  local label="$1"
  shift

  if "$@"; then
    printf 'ROLLBACK PASS: %s\n' "$label"
    return 0
  else
    local rc=$?
  fi

  rollback_status=1
  failed_steps+=("$label:$rc")
  warn "Rollback step failed: $label (exit=$rc)"

  # Continue recovery despite this failure.
  return 0
}

pm2_status="$(get_pm2_status)" || die "Unable to determine PM2 status for process $PM2_ID"
case "$pm2_status" in
  online)
    if ! pm2 stop "$PM2_ID"; then
      rollback_status=1
      pm2_status_after_stop="$(get_pm2_status)" || die "Unable to determine PM2 status after stop failure for process $PM2_ID"
      [[ "$pm2_status_after_stop" == "stopped" ]] || die "PM2 stop failed and process $PM2_ID is still $pm2_status_after_stop"
      warn "PM2 stop returned non-zero but the process is stopped; continuing rollback"
    fi
    assert_pm2_stopped
    assert_listener_count 0
    ;;
  stopped)
    assert_listener_count 0
    ;;
  stopping|errored)
    die "PM2 process $PM2_ID is in unexpected state: $pm2_status"
    ;;
  *)
    die "PM2 process $PM2_ID state is unreadable: ${pm2_status:-unknown}"
    ;;
esac

attempt "restore git checkout to FROM_SHA" git -C "$PROD_ROOT" switch --detach "$FROM_SHA"
attempt "verify git checkout at FROM_SHA" bash -c 'test "$(git -C "$1" rev-parse HEAD)" = "$2"' _ "$PROD_ROOT" "$FROM_SHA"
attempt "verify tracked checkout is clean" bash -c 'test -z "$(GIT_OPTIONAL_LOCKS=0 git -C "$1" status --porcelain=v1 --untracked-files=no)"' _ "$PROD_ROOT"
attempt "install restored dependencies" bash -c 'cd "$1" && npm ci' _ "$BACKEND_DIR"
attempt "restore compiled runtime" restore_runtime_tree "$DEPLOY_ID"
attempt "restart PM2" pm2 restart "$PM2_ID" --update-env
attempt "verify PM2 online" assert_pm2_online
attempt "verify one listener" assert_listener_count 1
attempt "verify health" "$SCRIPT_DIR/verify-health.sh"
attempt "verify PM2 online after health" assert_pm2_online
attempt "verify one listener after health" assert_listener_count 1
attempt "verify protected paths" verify_protected_hashes "$BACKUP_DIR/meta/protected-hashes.txt"

if (( rollback_status == 0 )); then
  attempt "cleanup runtime directories" cleanup_runtime_dirs
fi

printf 'rollback_from_sha=%s\n' "$FROM_SHA"
printf 'rollback_target_sha=%s\n' "${TARGET_SHA:-unknown}"
printf 'rollback_complete=yes\n'

if (( rollback_status != 0 )); then
  printf 'rollback_failed_steps:\n' >&2
  printf '  - %s\n' "${failed_steps[@]}" >&2
  die "Rollback completed with one or more step failures"
fi
