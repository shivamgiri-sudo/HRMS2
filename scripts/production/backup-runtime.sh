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
LABEL="${1:-}"
FROM_SHA="${2:-}"
TARGET_SHA="${3:-}"

if [[ -z "$LABEL" || -z "$FROM_SHA" || -z "$TARGET_SHA" ]]; then
  die "Usage: backup-runtime.sh <label> <from-sha> <target-sha> [relative-file ...]"
fi

[[ "$FROM_SHA" =~ ^[0-9a-f]{40}$ ]] || die "from-sha must be a full 40-character SHA"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || die "target-sha must be a full 40-character SHA"

shift 3

stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="$BACKUP_ROOT/${LABEL}-${stamp}"
mkdir -p "$backup_dir/source" "$backup_dir/dist" "$backup_dir/meta"

copy_file() {
  local rel="$1"
  local src="$PROD_ROOT/$rel"
  local dst="$backup_dir/source/$rel"

  [[ -e "$src" ]] || return 0
  case "$rel" in
    backend/.env|backend/eng.traineddata|backend/private/ats-candidate-files/*|backend/face-models/*)
      return 0
      ;;
  esac
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
}

copy_dist_tree() {
  local src="$PROD_ROOT/backend/dist"
  local dst="$backup_dir/dist"

  [[ -d "$src" ]] || die "Missing backend/dist runtime tree: $src"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$src/" "$dst/"
    return 0
  fi

  mkdir -p "$dst"
  cp -a "$src/." "$dst/"
}

source_manifest="$backup_dir/meta/source-manifest.txt"
{
  printf '%s\n' "backend/package.json"
  printf '%s\n' "backend/package-lock.json"
  for rel in "$@"; do
    case "$rel" in
      backend/dist/*)
        continue
        ;;
      *)
        printf '%s\n' "$rel"
        ;;
    esac
  done
} | awk '!seen[$0]++' > "$source_manifest"

copy_dist_tree

while IFS= read -r rel; do
  [[ -n "$rel" ]] || continue
  copy_file "$rel"
done < "$source_manifest"

git -C "$PROD_ROOT" rev-parse HEAD > "$backup_dir/meta/git-sha.txt"
git -C "$PROD_ROOT" branch --show-current > "$backup_dir/meta/git-branch.txt" || true
git -C "$PROD_ROOT" status --porcelain=v1 > "$backup_dir/meta/git-status.txt" || true
printf '%s\n' "$FROM_SHA" > "$backup_dir/meta/from-sha.txt"
printf '%s\n' "$TARGET_SHA" > "$backup_dir/meta/target-sha.txt"
pm2 describe "$PM2_ID" > "$backup_dir/meta/pm2-describe.txt" 2>&1 || true

health_code="$(curl -sS -o "$backup_dir/meta/health.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health" || true)"
assessment_code="$(curl -sS -o "$backup_dir/meta/assessment-health.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/ats-ext/assessment/health" || true)"

printf 'health_http_code=%s\n' "${health_code:-unavailable}" > "$backup_dir/meta/health-http-code.txt"
printf 'assessment_health_http_code=%s\n' "${assessment_code:-unavailable}" > "$backup_dir/meta/assessment-health-http-code.txt"

find "$backup_dir/dist" -type f | sed "s#^$backup_dir/dist/##" | sort > "$backup_dir/meta/dist-manifest.txt"

{
  for rel in \
    backend/.env \
    backend/eng.traineddata \
    backend/private/ats-candidate-files \
    backend/face-models
  do
    path="$PROD_ROOT/$rel"
    if [[ -e "$path" ]]; then
      if [[ -d "$path" ]]; then
        while IFS= read -r -d '' file; do
          sha256sum "$file"
        done < <(find "$path" -type f -print0 | sort -z)
      else
        sha256sum "$path"
      fi
    fi
  done
} > "$backup_dir/meta/protected-hashes.txt"

chmod -R go-rwx "$backup_dir"
printf '%s\n' "$backup_dir"
