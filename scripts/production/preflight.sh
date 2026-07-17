#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Missing required environment variable: $name"
}

require_var PROD_ROOT
require_var BACKEND_DIR
require_var PM2_ID
require_var APP_PORT

[[ -d "$PROD_ROOT" ]] || die "Production root not found: $PROD_ROOT"
[[ -d "$BACKEND_DIR" ]] || die "Backend root not found: $BACKEND_DIR"
[[ -f "$BACKEND_DIR/package.json" ]] || die "Missing backend/package.json"
[[ -f "$BACKEND_DIR/package-lock.json" ]] || die "Missing backend/package-lock.json"
[[ -d "$BACKEND_DIR/private/ats-candidate-files" ]] || die "Missing protected upload directory: backend/private/ats-candidate-files"
[[ -d "$BACKEND_DIR/face-models" ]] || die "Missing protected model directory: backend/face-models"
[[ -f "$BACKEND_DIR/.env" ]] || warn "backend/.env not visible to the shell; confirm it exists and remains protected"

cd "$PROD_ROOT"

repo_sha="$(git rev-parse HEAD)"
branch="$(git branch --show-current || true)"
node_version="$(node --version)"
npm_version="$(npm --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
npm_major="${npm_version%%.*}"
listener_count="$(lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { count += 1 } END { print count + 0 }')"

printf 'git_sha=%s\n' "$repo_sha"
printf 'branch=%s\n' "${branch:-detached}"
printf 'node=%s\n' "$node_version"
printf 'npm=%s\n' "$npm_version"
printf 'pm2_id=%s\n' "$PM2_ID"
printf 'port=%s\n' "$APP_PORT"
printf 'listeners=%s\n' "$listener_count"

if (( node_major < 20 )); then
  die "Node.js 20+ is required; found $node_version"
fi

if (( npm_major < 10 )); then
  die "npm 10+ is required; found $npm_version"
fi

if ! pm2 describe "$PM2_ID" >/dev/null 2>&1; then
  die "PM2 process $PM2_ID is not available"
fi

if (( listener_count > 1 )); then
  die "Port $APP_PORT has more than one listener"
fi

tracked_changes="$(git status --porcelain=v1 --untracked-files=normal | awk '
  $1 != "??" { print $0 }
')"

if [[ -n "$tracked_changes" ]]; then
  printf 'tracked_changes:\n%s\n' "$tracked_changes"
else
  printf 'tracked_changes: none\n'
fi

candidate_count="$(find "$BACKEND_DIR/private/ats-candidate-files" -type f | wc -l | awk '{print $1}')"
candidate_size="$(du -sh "$BACKEND_DIR/private/ats-candidate-files" | awk '{print $1}')"
face_models_size="$(du -sh "$BACKEND_DIR/face-models" | awk '{print $1}')"

printf 'protected_paths:\n'
printf '  - backend/private/ats-candidate-files (files=%s size=%s)\n' "$candidate_count" "$candidate_size"
printf '  - backend/face-models (size=%s)\n' "$face_models_size"
printf '  - backend/.env (present=%s)\n' "$( [[ -f "$BACKEND_DIR/.env" ]] && printf yes || printf no )"

