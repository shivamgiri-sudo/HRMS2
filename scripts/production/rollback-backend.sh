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

if [[ $# -ne 1 ]]; then
  die "Usage: rollback-backend.sh <backup-directory>"
fi

BACKUP_DIR="$1"

require_var PROD_ROOT
require_var BACKEND_DIR
require_var PM2_ID
require_var APP_PORT

[[ -d "$BACKUP_DIR" ]] || die "Backup directory not found: $BACKUP_DIR"
[[ -d "$BACKUP_DIR/source" ]] || die "Missing backup source tree: $BACKUP_DIR/source"
[[ -d "$BACKUP_DIR/dist" ]] || die "Missing backup dist tree: $BACKUP_DIR/dist"

restore_one() {
  local src="$1"
  local dst="$2"
  [[ -e "$src" ]] || return 0
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
}

while IFS= read -r -d '' file; do
  source_prefix="$BACKUP_DIR/source/"
  rel="${file#"$source_prefix"}"
  restore_one "$file" "$PROD_ROOT/$rel"
done < <(find "$BACKUP_DIR/source" -type f -print0)

while IFS= read -r -d '' file; do
  dist_prefix="$BACKUP_DIR/dist/"
  rel="${file#"$dist_prefix"}"
  restore_one "$file" "$PROD_ROOT/backend/dist/$rel"
done < <(find "$BACKUP_DIR/dist" -type f -print0)

cd "$BACKEND_DIR"
npm ci
pm2 restart "$PM2_ID" --update-env

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/verify-health.sh"
