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
Usage: deploy-backend.sh [--dry-run] <from-sha> <target-sha> <targeted-test-path> [...]
EOF
  exit 1
}

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Missing required environment variable: $name"
}

is_allowed_release_path() {
  case "$1" in
    backend/*|scripts/production/*|docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md|docs/TEST_BASELINE_2026-07-17.md)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_protected_path() {
  case "$1" in
    backend/.env|backend/eng.traineddata|backend/private/ats-candidate-files/*|backend/face-models/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

unique_paths() {
  awk '!seen[$0]++'
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

checksum_file() {
  sha256sum "$1" | awk '{print $1}'
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
  diff -u "$baseline_file" <(generate_protected_hashes) >/dev/null || die "Protected runtime data changed during deployment"
}

write_list() {
  local file="$1"
  shift
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$@" | unique_paths > "$file"
}

mode="run"
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  mode="dry-run"
  shift
fi

if [[ $# -lt 3 ]]; then
  usage
fi

FROM_SHA="$1"
TARGET_SHA="$2"
shift 2
TEST_TARGETS=("$@")

[[ "$FROM_SHA" =~ ^[0-9a-f]{40}$ ]] || die "FROM_SHA must be a full 40-character commit SHA"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die "TARGET_SHA must be a full 40-character commit SHA"
[[ "${#TEST_TARGETS[@]}" -ge 1 ]] || die "At least one targeted test path is required"

require_var PROD_ROOT
require_var BACKEND_DIR
require_var PM2_ID
require_var APP_PORT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$PROD_ROOT" rev-parse --show-toplevel)"
WORKTREE_ROOT="${WORKTREE_ROOT:-$HOME/HRMS2-deploy-worktrees}"
mkdir -p "$WORKTREE_ROOT"

DEPLOY_ID="$(date +%Y%m%d-%H%M%S)-${TARGET_SHA:0:12}"
WORKTREE_DIR="$WORKTREE_ROOT/hrms2-backend-$DEPLOY_ID"
STAGING_DIST_DIR="$PROD_ROOT/backend/dist.next-$TARGET_SHA"
PREVIOUS_DIST_DIR="$PROD_ROOT/backend/dist.previous-$DEPLOY_ID"
BACKUP_DIR=""
PM2_STOPPED=0
ROLLBACK_IN_PROGRESS=0

cleanup_worktree() {
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
}

rollback_now() {
  local exit_code="$1"
  local reason="$2"

  if (( ROLLBACK_IN_PROGRESS == 1 )); then
    exit "$exit_code"
  fi

  ROLLBACK_IN_PROGRESS=1
  trap - ERR INT TERM

  if (( PM2_STOPPED == 1 )) && [[ -n "$BACKUP_DIR" ]]; then
    printf 'Deployment failed after PM2 stop (%s); rolling back from %s.\n' "$reason" "$BACKUP_DIR" >&2
    "$SCRIPT_DIR/rollback-backend.sh" "$BACKUP_DIR" || true
  fi

  exit "$exit_code"
}

trap cleanup_worktree EXIT
trap 'rollback_now $? ERR' ERR
trap 'rollback_now 130 INT' INT
trap 'rollback_now 143 TERM' TERM

collect_release_sets() {
  local entry status rest old_path new_path

  mapfile -t RELEASE_LINES < <(git -C "$REPO_ROOT" diff --name-status --find-renames "$FROM_SHA" "$TARGET_SHA")
  [[ "${#RELEASE_LINES[@]}" -gt 0 ]] || die "No release changes found between FROM_SHA and TARGET_SHA"

  RELEASE_FILES=()
  ADDED_FILES=()
  MODIFIED_FILES=()
  DELETED_FILES=()

  for entry in "${RELEASE_LINES[@]}"; do
    status="${entry%%$'\t'*}"
    rest="${entry#*$'\t'}"

    case "$status" in
      A|M|D)
        validate_release_path "$rest"
        RELEASE_FILES+=("$rest")
        case "$status" in
          A) ADDED_FILES+=("$rest") ;;
          M) MODIFIED_FILES+=("$rest") ;;
          D) DELETED_FILES+=("$rest") ;;
        esac
        ;;
      R*|C*)
        old_path="${rest%%$'\t'*}"
        new_path="${rest#*$'\t'}"
        validate_release_path "$old_path"
        validate_release_path "$new_path"
        RELEASE_FILES+=("$old_path" "$new_path")
        DELETED_FILES+=("$old_path")
        ADDED_FILES+=("$new_path")
        ;;
      *)
        die "Unsupported diff status from git: $status"
        ;;
    esac
  done

  mapfile -t RELEASE_FILES < <(printf '%s\n' "${RELEASE_FILES[@]}" | unique_paths)
  mapfile -t ADDED_FILES < <(printf '%s\n' "${ADDED_FILES[@]}" | unique_paths)
  mapfile -t MODIFIED_FILES < <(printf '%s\n' "${MODIFIED_FILES[@]}" | unique_paths)
  mapfile -t DELETED_FILES < <(printf '%s\n' "${DELETED_FILES[@]}" | unique_paths)
}

validate_release_path() {
  local rel="$1"
  if ! is_allowed_release_path "$rel"; then
    die "Unsupported release path: $rel"
  fi
  if is_protected_path "$rel"; then
    die "Protected runtime data must not be part of a deployment: $rel"
  fi
}

write_release_manifests() {
  local backup_meta="$1/meta"
  write_list "$backup_meta/release-files.txt" "${RELEASE_FILES[@]}"
  write_list "$backup_meta/added-files.txt" "${ADDED_FILES[@]}"
  write_list "$backup_meta/modified-files.txt" "${MODIFIED_FILES[@]}"
  write_list "$backup_meta/deleted-files.txt" "${DELETED_FILES[@]}"
}

stage_runtime() {
  rm -rf "$STAGING_DIST_DIR"
  copy_tree "$WORKTREE_DIR/backend/dist" "$STAGING_DIST_DIR"

  [[ -f "$STAGING_DIST_DIR/src/server.js" ]] || die "Missing staged runtime file: $STAGING_DIST_DIR/src/server.js"
  [[ -f "$STAGING_DIST_DIR/src/app.js" ]] || die "Missing staged runtime file: $STAGING_DIST_DIR/src/app.js"
}

validate_runtime_checksums() {
  local worktree_server worktree_app staged_server staged_app

  worktree_server="$(checksum_file "$WORKTREE_DIR/backend/dist/src/server.js")"
  worktree_app="$(checksum_file "$WORKTREE_DIR/backend/dist/src/app.js")"
  staged_server="$(checksum_file "$STAGING_DIST_DIR/src/server.js")"
  staged_app="$(checksum_file "$STAGING_DIST_DIR/src/app.js")"

  [[ "$worktree_server" == "$staged_server" ]] || die "Server runtime checksum mismatch before activation"
  [[ "$worktree_app" == "$staged_app" ]] || die "App runtime checksum mismatch before activation"

  VALIDATED_SERVER_CHECKSUM="$worktree_server"
  VALIDATED_APP_CHECKSUM="$worktree_app"
}

verify_deployed_checksums() {
  local deployed_server deployed_app

  deployed_server="$(checksum_file "$PROD_ROOT/backend/dist/src/server.js")"
  deployed_app="$(checksum_file "$PROD_ROOT/backend/dist/src/app.js")"

  [[ "$deployed_server" == "$VALIDATED_SERVER_CHECKSUM" ]] || die "Deployed server checksum does not match the validated worktree checksum"
  [[ "$deployed_app" == "$VALIDATED_APP_CHECKSUM" ]] || die "Deployed app checksum does not match the validated worktree checksum"

  DEPLOYED_SERVER_CHECKSUM="$deployed_server"
  DEPLOYED_APP_CHECKSUM="$deployed_app"
}

print_runtime_checksums() {
  printf 'validated_server_checksum=%s\n' "$VALIDATED_SERVER_CHECKSUM"
  printf 'deployed_server_checksum=%s\n' "$DEPLOYED_SERVER_CHECKSUM"
  printf 'validated_app_checksum=%s\n' "$VALIDATED_APP_CHECKSUM"
  printf 'deployed_app_checksum=%s\n' "$DEPLOYED_APP_CHECKSUM"
  printf 'runtime_checksum_match=yes\n'
}

if [[ "$DRY_RUN" -eq 0 ]]; then
  "$SCRIPT_DIR/preflight.sh" deploy
else
  "$SCRIPT_DIR/preflight.sh" audit
fi

git -C "$REPO_ROOT" fetch origin --prune
git -C "$REPO_ROOT" rev-parse --verify "$FROM_SHA^{commit}" >/dev/null
git -C "$REPO_ROOT" rev-parse --verify "$TARGET_SHA^{commit}" >/dev/null
git -C "$REPO_ROOT" merge-base --is-ancestor "$FROM_SHA" "$TARGET_SHA" || die "TARGET_SHA must descend from FROM_SHA"

LIVE_HEAD="$(git -C "$PROD_ROOT" rev-parse HEAD)"
[[ "$LIVE_HEAD" == "$FROM_SHA" ]] || die "Production HEAD $LIVE_HEAD does not match FROM_SHA $FROM_SHA"

collect_release_sets

cd "$REPO_ROOT"
git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
git worktree add --detach "$WORKTREE_DIR" "$TARGET_SHA"

cd "$WORKTREE_DIR/backend"
npm ci
npm run typecheck
npm run build
npm test -- "${TEST_TARGETS[@]}"

stage_runtime
validate_runtime_checksums

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'dry_run=1\n'
  printf 'from_sha=%s\n' "$FROM_SHA"
  printf 'target_sha=%s\n' "$TARGET_SHA"
  printf 'release_files=%s\n' "${#RELEASE_FILES[@]}"
  print_runtime_checksums
  exit 0
fi

BACKUP_DIR="$("$SCRIPT_DIR/backup-runtime.sh" deploy "$FROM_SHA" "$TARGET_SHA" "${RELEASE_FILES[@]}")"
write_release_manifests "$BACKUP_DIR"

pm2 stop "$PM2_ID" >/dev/null 2>&1 || true
PM2_STOPPED=1

git -C "$PROD_ROOT" switch --detach "$TARGET_SHA"
[[ "$(git -C "$PROD_ROOT" rev-parse HEAD)" == "$TARGET_SHA" ]] || die "Production HEAD did not move to TARGET_SHA"
[[ -z "$(git -C "$PROD_ROOT" status --porcelain=v1 --untracked-files=no)" ]] || die "Production tracked checkout is not clean after switching to TARGET_SHA"

if [[ -d "$PROD_ROOT/backend/dist" ]]; then
  mv "$PROD_ROOT/backend/dist" "$PREVIOUS_DIST_DIR"
fi
mv "$STAGING_DIST_DIR" "$PROD_ROOT/backend/dist"

verify_deployed_checksums
print_runtime_checksums

cd "$BACKEND_DIR"
npm ci

cleanup_runtime_dirs() {
  rm -rf "$PREVIOUS_DIST_DIR"
  find "$PROD_ROOT/backend" -maxdepth 1 -type d \( -name 'dist.next-*' -o -name 'dist.previous-*' -o -name 'dist.restore-*' \) -exec rm -rf {} +
}

pm2 restart "$PM2_ID" --update-env
assert_pm2_online
assert_listener_count 1
"$SCRIPT_DIR/verify-health.sh"
assert_pm2_online
assert_listener_count 1
verify_protected_hashes "$BACKUP_DIR/meta/protected-hashes.txt"
cleanup_runtime_dirs

printf 'deploy_from_sha=%s\n' "$FROM_SHA"
printf 'deploy_target_sha=%s\n' "$TARGET_SHA"
printf 'backup_dir=%s\n' "$BACKUP_DIR"
