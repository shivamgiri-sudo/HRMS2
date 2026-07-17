#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Missing required environment variable: $name"
}

usage() {
  cat >&2 <<'EOF'
Usage: rollback-backend.sh [--dry-run] <backup-directory>
EOF
  exit 1
}

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

if [[ $# -ne 1 ]]; then
  usage
fi

BACKUP_DIR="$1"

require_var PROD_ROOT
require_var BACKEND_DIR
require_var PM2_ID
require_var APP_PORT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -d "$BACKUP_DIR" ]] || die "Backup directory not found: $BACKUP_DIR"
[[ -d "$BACKUP_DIR/source" ]] || die "Missing backup source tree: $BACKUP_DIR/source"
[[ -d "$BACKUP_DIR/dist" ]] || die "Missing backup dist tree: $BACKUP_DIR/dist"

source_manifest="$BACKUP_DIR/meta/source-manifest.txt"
if [[ -f "$source_manifest" ]]; then
  mapfile -t source_paths < "$source_manifest"
else
  mapfile -t source_paths < <(find "$BACKUP_DIR/source" -type f | sed "s#^$BACKUP_DIR/source/##" | sort)
fi

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

restore_source_entry() {
  local rel="$1"
  local backup_path="$BACKUP_DIR/source/$rel"
  local prod_path="$PROD_ROOT/$rel"

  if [[ -e "$backup_path" ]]; then
    mkdir -p "$(dirname "$prod_path")"
    cp -a "$backup_path" "$prod_path"
  else
    rm -rf "$prod_path"
  fi
}

if (( DRY_RUN == 1 )); then
  printf 'dry_run=1\n'
  printf 'would_restore_dist=%s\n' "$BACKUP_DIR/dist"
  printf 'would_restore_source_files=%s\n' "${#source_paths[@]}"
  printf 'would_run_npm_ci=yes\n'
  printf 'would_restart_pm2=%s\n' "$PM2_ID"
  exit 0
fi

pm2 describe "$PM2_ID" >/dev/null 2>&1 || die "PM2 process $PM2_ID is not available"
pm2 stop "$PM2_ID" >/dev/null 2>&1 || true

copy_tree "$BACKUP_DIR/dist" "$PROD_ROOT/backend/dist"

for rel in "${source_paths[@]}"; do
  [[ -n "$rel" ]] || continue
  restore_source_entry "$rel"
done

cd "$BACKEND_DIR"
npm ci
pm2 restart "$PM2_ID" --update-env

"$SCRIPT_DIR/verify-health.sh"
