#!/usr/bin/env bash
# Guard for MANUAL production deploys on the app server (the CI workflow deploy.yml already has its own
# atomic swap, health check and rollback, and one-at-a-time concurrency; this covers the ssh + git pull +
# pm2 restart path that several people and sessions used at once on 2026-09-30, causing four outages).
#
#   scripts/deploy-guard.sh preflight            read-only checks, changes nothing
#   scripts/deploy-guard.sh run [--dry-run]      lock, preflight, pull --ff-only, build, restart, verify
#   scripts/deploy-guard.sh verify               wait for /api/health to be healthy (safe to run any time)
#   scripts/deploy-guard.sh status               who holds the deploy lock, current HEAD and health
#
# Options for run:  --allow-business-hours   deploy DDL-bearing changes between 09:30 and 19:30 IST anyway
#                   --allow-pending-long-queries   deploy even though queries older than 2 min are running
#
# Run it on the app server, from /var/www/HRMS2. Only ONE `run` can hold /var/lock/hrms-deploy.lock.
set -Eeuo pipefail

ROOT="${HRMS_ROOT:-/var/www/HRMS2}"
LOCK=/var/lock/hrms-deploy.lock
STATE="$HOME/deploy-backups/last-deploy.env"
API="${HRMS_API:-http://127.0.0.1:5055}"
VERIFY_SECONDS="${VERIFY_SECONDS:-300}"
BIZ_START=930; BIZ_END=1930

CMD="${1:-status}"; shift || true
DRY=0; ALLOW_BIZ=0; ALLOW_LONGQ=0
for a in "$@"; do case "$a" in
  --dry-run) DRY=1 ;; --allow-business-hours) ALLOW_BIZ=1 ;; --allow-pending-long-queries) ALLOW_LONGQ=1 ;;
  *) echo "unknown option $a" >&2; exit 2 ;; esac; done

say()  { printf '[deploy-guard] %s\n' "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
bad()  { printf '  BLOCK %s\n' "$*"; BLOCKERS=$((BLOCKERS + 1)); }
WARNINGS=0; BLOCKERS=0
cd "$ROOT"

health_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API/api/health" 2>/dev/null || echo 000; }

mysql_cnf() {  # temp defaults file from backend/.env; password never on a command line
  local env="$ROOT/backend/.env" f; f="$(mktemp)"; chmod 600 "$f"
  get() { grep -E "^$1=" "$env" | tail -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g'; }
  # Quoted, with \ and " escaped: an unquoted # (or ;) in a password would start a comment in an option file.
  local pw; pw="$(get DB_PASSWORD)"; pw="${pw//\\/\\\\}"; pw="${pw//\"/\\\"}"
  printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword="%s"\ndatabase=%s\nconnect-timeout=8\n' \
    "$(get DB_HOST)" "$(get DB_PORT)" "$(get DB_USER)" "$pw" "$(get DB_NAME)" > "$f"
  echo "$f"
}

preflight() {
  say "preflight ($(date '+%F %T'))"
  local hc; hc="$(health_code)"
  [ "$hc" = 200 ] && ok "API healthy now (200)" || warn "API health is $hc before we start (a deploy will not make it worse, but find out why)"

  if [ "${HOLDING_LOCK:-0}" = 1 ]; then ok "this run holds the deploy lock"
  elif [ -e "$LOCK" ] && ! flock -n "$LOCK" true 2>/dev/null; then bad "another deploy holds $LOCK: $(cat "$LOCK.info" 2>/dev/null || echo unknown)"
  else ok "no other deploy holds the lock"; fi
  if pgrep -f 'Runner.Worker' >/dev/null 2>&1; then warn "a GitHub Actions runner job is active on this host (a CI deploy may be running); check before continuing"; else ok "no GitHub Actions job running here"; fi

  local dirty; dirty="$(git status --porcelain --untracked-files=no | awk '{print $2}' | grep -vE '^(src/lib/version\.ts|package-lock\.json)$' || true)"
  [ -z "$dirty" ] && ok "no uncommitted tracked changes (generated version.ts/package-lock ignored)" \
    || bad "uncommitted tracked changes would be overwritten or lost: $(echo "$dirty" | tr '\n' ' ')"

  git fetch -q origin main 2>/dev/null || warn "git fetch failed"
  local ahead behind; ahead="$(git rev-list --count origin/main..HEAD)"; behind="$(git rev-list --count HEAD..origin/main)"
  [ "$ahead" = 0 ] && ok "server has no local commits missing from origin/main" \
    || bad "server has $ahead commit(s) not on origin/main (a pull would need a merge): $(git log --format=%h --max-count=3 origin/main..HEAD | tr '\n' ' ')"
  say "incoming: $behind commit(s) from origin/main"

  local incoming ddl=""
  incoming="$(git diff --name-only HEAD origin/main -- 'backend/sql/*.sql' 'backend/sql/migrations/*.sql' 2>/dev/null || true)"
  if [ -n "$incoming" ]; then
    for f in $incoming; do git show "origin/main:$f" 2>/dev/null | grep -qiE '(ALTER TABLE|ADD INDEX|CREATE (UNIQUE )?INDEX|DROP INDEX|OPTIMIZE TABLE)' && ddl="$ddl $(basename "$f")"; done
    ok "$(echo "$incoming" | wc -l) migration file(s) incoming"
    if [ -n "$ddl" ]; then
      local now; now="$(date +%H%M | sed 's/^0*//')"; now="${now:-0}"
      if [ "$now" -ge "$BIZ_START" ] && [ "$now" -lt "$BIZ_END" ] && [ "$ALLOW_BIZ" = 0 ]; then
        bad "incoming migrations run DDL on live tables:${ddl}. A blocked ALTER queues every query on that table and a failed migration stops the API booting. Deploy after ${BIZ_END} IST, or pass --allow-business-hours"
      else
        warn "incoming migrations run DDL:${ddl} (outside business hours, allowed)"
      fi
    fi
  else
    ok "no migration files incoming"
  fi

  if command -v mysql >/dev/null 2>&1 && [ -f "$ROOT/backend/.env" ]; then
    local cnf; cnf="$(mysql_cnf)"
    local alters longq
    alters="$(mysql --defaults-extra-file="$cnf" -N -B -e "SELECT COUNT(*) FROM information_schema.processlist WHERE info REGEXP '^(ALTER|CREATE INDEX|OPTIMIZE)'" 2>/dev/null || echo '?')"
    longq="$(mysql --defaults-extra-file="$cnf" -N -B -e "SELECT COUNT(*) FROM information_schema.processlist WHERE command<>'Sleep' AND time>120 AND info IS NOT NULL AND info NOT LIKE '%processlist%'" 2>/dev/null || echo '?')"
    rm -f "$cnf"
    [ "$alters" = 0 ] && ok "no DDL in flight on the database" || { [ "$alters" = '?' ] && warn "could not read the database processlist" || bad "$alters DDL statement(s) already running on the database; wait for them"; }
    if [ "$longq" = 0 ]; then ok "no query older than 2 min is running"
    elif [ "$longq" = '?' ]; then :
    elif [ "$ALLOW_LONGQ" = 1 ]; then warn "$longq query(ies) older than 2 min are running (allowed)"
    else warn "$longq query(ies) older than 2 min are running; migrations that ALTER tables they touch will hit a lock timeout"; fi
  else
    warn "mysql client or backend/.env not available; skipped database checks"
  fi

  say "preflight result: $BLOCKERS blocker(s), $WARNINGS warning(s)"
  [ "$BLOCKERS" = 0 ]
}

verify() {
  say "waiting up to ${VERIFY_SECONDS}s for a healthy API (boot applies pending migrations and can take minutes)"
  local i=0 code
  while [ "$i" -lt "$VERIFY_SECONDS" ]; do
    code="$(health_code)"
    if [ "$code" = 200 ]; then say "HEALTHY after ${i}s"; return 0; fi
    sleep 5; i=$((i + 5))
  done
  say "NOT healthy after ${VERIFY_SECONDS}s (last code $code). Last errors:"
  grep -avE 'checksum mismatch|^\S+ +at ' "$HOME/.pm2/logs/hrms2-backend-error.log" 2>/dev/null | tail -6 | cut -c1-220 | sed 's/^/    /'
  if [ -f "$STATE" ]; then
    # shellcheck disable=SC1090
    source "$STATE"
    say "previous release was ${PREV_HEAD:-unknown}. To roll back: git checkout ${PREV_HEAD:-<sha>} && (cd backend && npm run build) && pm2 restart hrms2-backend hrms2-workers"
  fi
  return 1
}

status() {
  say "HEAD:   $(git log --oneline -1 | cut -c1-90)"
  say "health: $(health_code)"
  if [ -e "$LOCK" ] && ! flock -n "$LOCK" true 2>/dev/null; then say "lock:   HELD by $(cat "$LOCK.info" 2>/dev/null || echo unknown)"; else say "lock:   free"; fi
}

run() {
  mkdir -p "$(dirname "$STATE")"
  exec 9>"$LOCK"
  flock -n 9 || { echo "another deploy holds the lock: $(cat "$LOCK.info" 2>/dev/null || echo unknown)" >&2; exit 1; }
  printf '%s pid %s at %s\n' "${SUDO_USER:-$USER}" "$$" "$(date '+%F %T')" > "$LOCK.info"
  trap 'rm -f "$LOCK.info"' EXIT
  HOLDING_LOCK=1

  preflight || { say "refusing to deploy"; exit 1; }
  local prev; prev="$(git rev-parse HEAD)"
  printf 'PREV_HEAD=%s\nWHEN=%s\n' "$prev" "$(date '+%F %T')" > "$STATE"

  local steps=(
    "git checkout -- src/lib/version.ts package-lock.json"
    "git merge --ff-only origin/main"
    "(cd backend && npm install --no-audit --no-fund --loglevel=error && npm run build)"
    "rm -rf dist.new && npx vite build --outDir dist.new --emptyOutDir && test -f dist.new/index.html"
    "cp -n dist/assets/* dist.new/assets/ 2>/dev/null || true; rm -rf dist.prev && mv dist dist.prev && mv dist.new dist"
    "git checkout -- src/lib/version.ts package-lock.json 2>/dev/null || true"
    "pm2 restart hrms2-backend hrms2-workers --update-env"
  )
  for s in "${steps[@]}"; do
    if [ "$DRY" = 1 ]; then say "[dry-run] $s"; else say "$s"; bash -c "set -e; $s"; fi
  done
  [ "$DRY" = 1 ] && { say "dry run finished; nothing was changed"; return 0; }
  verify
}

case "$CMD" in
  preflight) preflight ;;
  verify)    verify ;;
  status)    status ;;
  run)       run ;;
  *) sed -n 2,14p "$0"; exit 2 ;;
esac
