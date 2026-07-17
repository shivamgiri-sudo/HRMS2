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

require_var PROD_ROOT
require_var BACKEND_DIR
require_var PM2_ID
require_var APP_PORT

BACKUP_ROOT="${BACKUP_ROOT:-/home/masadmin/HRMS2-release-backups}"
LABEL="${1:-production}"
shift || true

if [[ $# -lt 1 ]]; then
  die "Usage: backup-runtime.sh <label> <relative-file> [relative-file ...]"
fi

stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="$BACKUP_ROOT/${LABEL}-${stamp}"
mkdir -p "$backup_dir/source" "$backup_dir/dist" "$backup_dir/meta"

copy_one() {
  local rel="$1"
  local src="$PROD_ROOT/$rel"
  local dst

  case "$rel" in
    backend/.env)
      return 0
      ;;
    backend/dist/*)
      dst="$backup_dir/dist/${rel#backend/dist/}"
      ;;
    *)
      dst="$backup_dir/source/$rel"
      ;;
  esac

  [[ -e "$src" ]] || return 0
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
}

copy_one "backend/package.json"
copy_one "backend/package-lock.json"

for rel in "$@"; do
  copy_one "$rel"
done

git -C "$PROD_ROOT" rev-parse HEAD > "$backup_dir/meta/git-sha.txt"
git -C "$PROD_ROOT" branch --show-current > "$backup_dir/meta/git-branch.txt" || true
git -C "$PROD_ROOT" status --porcelain=v1 > "$backup_dir/meta/git-status.txt" || true
pm2 describe "$PM2_ID" > "$backup_dir/meta/pm2-describe.txt" 2>&1 || true

health_code="$(curl -sS -o "$backup_dir/meta/health.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health" || true)"
assessment_code="$(curl -sS -o "$backup_dir/meta/assessment-health.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/ats-ext/assessment/health" || true)"

printf 'health_http_code=%s\n' "${health_code:-unavailable}" > "$backup_dir/meta/health-http-code.txt"
printf 'assessment_health_http_code=%s\n' "${assessment_code:-unavailable}" > "$backup_dir/meta/assessment-health-http-code.txt"

chmod -R go-rwx "$backup_dir"
printf '%s\n' "$backup_dir"

