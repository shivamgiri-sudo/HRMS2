#!/bin/bash
# Production Deployment Script
# Server: <deploy host — see backend/.env> | User: masadmin | Project: /var/www/HRMS2
#
# Order matters here, and it is the order below for reasons that have each cost an
# outage at least once:
#
#   pull -> PREFLIGHT -> build -> restart -> POST-CHECK -> nginx
#
# The preflight runs BEFORE anything is built or restarted, because /api/health is
# `dbStatus === "ok" && schemaStatus.valid` — a migration in the manifest that the
# runner cannot apply puts the whole service at 503 while the API carries on serving
# traffic perfectly well. On 2026-08-09 a migration renumbered 1116 -> 1117 left
# production's manifest naming a file that no longer existed; the runner logged
# `skipping missing file`, carried on, and health sat at 503 for twelve minutes after
# the restart while waiting-room displays were being served 200s the whole time.
# Aborting before the restart costs seconds; finding out afterwards costs an outage.

set -euo pipefail

echo "=========================================="
echo "HRMS2 Production Deployment"
echo "=========================================="
echo

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROOT=/var/www/HRMS2
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$ROOT/.deploy-backups/deploy-$STAMP"

cd "$ROOT" || exit 1
ROLLBACK_SHA=$(git rev-parse --short HEAD)

# Reported on any failure. The old script printed a rollback commit hardcoded months
# earlier, which would have rolled production back to whatever that commit happened to
# be rather than to where it actually was a moment ago.
on_failure() {
  echo
  echo -e "${RED}✗ Deployment failed.${NC}"
  echo "  Production was at $ROLLBACK_SHA before this run."
  echo "  Rollback:"
  echo "    cd $ROOT && git reset --hard $ROLLBACK_SHA"
  echo "    tar xzf $BACKUP_DIR/frontend-dist.tar.gz -C $ROOT"
  echo "    cd backend && npm run build && pm2 restart hrms2-backend hrms2-workers --update-env"
}
trap on_failure ERR

echo -e "${YELLOW}Step 0: Backup${NC}"
echo "--------------------------------------"
mkdir -p "$BACKUP_DIR"
tar czf "$BACKUP_DIR/frontend-dist.tar.gz" dist 2>/dev/null || true
tar czf "$BACKUP_DIR/backend-dist.tar.gz" backend/dist 2>/dev/null || true
cp backend/.env "$BACKUP_DIR/env.bak" 2>/dev/null || true
echo "Backup: $BACKUP_DIR (was at $ROLLBACK_SHA)"
echo

echo -e "${YELLOW}Step 1: Pull${NC}"
echo "--------------------------------------"
git fetch origin main

# Clear untracked files that are byte-identical to what is arriving.
#
# People hand-place new backend/sql/*.sql and backend/scripts/*.mjs on this box before
# committing them, so `git pull` aborts with "untracked working tree files would be
# overwritten by merge". This blocked three deploys on 2026-08-03 and three more on
# 2026-08-10 — and a new file appeared BETWEEN two attempts on the same afternoon,
# because another session was working on the box at the time. The manual fix was
# identical every time: compare each blocker against origin/main, move the matching
# ones aside, pull again.
#
# Only files whose content already matches origin/main are moved, compared ignoring
# line endings. Anything that DIFFERS is left in place and the deploy stops: a differing
# file may be work that exists nowhere else, and quietly discarding it to let a deploy
# proceed is how someone's afternoon disappears.
#
# The first pull is captured rather than fatal so its error can be read; `|| true`
# because set -e would otherwise abort on the very failure being handled.
PULL_OUTPUT=$(git pull --ff-only origin main 2>&1) || true
BLOCKERS=$(printf '%s\n' "$PULL_OUTPUT" \
           | sed -n '/untracked working tree files would be overwritten/,/^Please/p' \
           | grep -E '^[[:space:]]+[^[:space:]]' || true)

if [ -n "$BLOCKERS" ]; then
  echo "Untracked files are blocking the pull; checking each against origin/main..."
  UNSAFE=0
  for f in $BLOCKERS; do
    [ -f "$f" ] || continue
    if git cat-file -e "origin/main:$f" 2>/dev/null \
       && git show "origin/main:$f" | sed 's/\r$//' | diff -q - <(sed 's/\r$//' "$f") >/dev/null 2>&1; then
      mkdir -p "$BACKUP_DIR/untracked/$(dirname "$f")"
      mv "$f" "$BACKUP_DIR/untracked/$f"
      echo "  identical to incoming, moved aside: $f"
    else
      echo -e "  ${RED}DIFFERS from origin/main — left in place: $f${NC}"
      UNSAFE=$((UNSAFE + 1))
    fi
  done
  if [ "$UNSAFE" -gt 0 ]; then
    echo -e "${RED}Stopping: $UNSAFE untracked file(s) differ from what is being pulled.${NC}"
    echo "Review them and move them yourself — they may exist nowhere else."
    exit 1
  fi
fi

# --ff-only, never a plain pull: a merge commit created on the production box is not
# reachable from origin and silently diverges the deploy from what was reviewed.
git pull --ff-only origin main
echo "Now at $(git rev-parse --short HEAD)"
echo

echo -e "${YELLOW}Step 2: Preflight — will a restart leave health at 503, or fail outright?${NC}"
echo "--------------------------------------"
cd "$ROOT/backend"
npm run preflight
# preflight reads src/. Production executes dist/. Before 2026-08-13 nothing compared them,
# and a green preflight against a 35-commit-stale artifact was the result: it listed 7 pending
# migrations from a file the runtime would never execute. The parity gate runs after the build
# (Step 3a), where dist exists and can be compared.
#
# Two checks now run here, both read-only, both fast, neither needing the CREATE/DROP DATABASE
# grant migration-preflight.ts still needs (open, see the readiness doc): deploy-preflight.mjs
# (does every manifest entry have a schema_migrations row, or a file that still exists under that
# name) and migration-target-table-check.ts (does every pending migration's INSERT/UPDATE/ALTER
# TABLE target a table that exists, unless the same file creates it). The second one closed the
# gap that took the API down for ~11 minutes on 2026-08-14: migration 1007 wrote to tables that
# had never existed (workforce_page_catalog / workforce_role_page_permissions instead of the real
# page_catalog / role_page_access), and neither deploy-preflight.mjs nor a manifest/file check
# catches that class — only asking information_schema whether the table is actually there does.
echo

echo -e "${YELLOW}Step 3: Build backend${NC}"
echo "--------------------------------------"
# set -e stops here on a non-zero tsc. That matters: tsc emits output even when it
# reports errors, so a failed build still overwrites dist — building and restarting
# regardless is how a broken dist reaches production.
npm run build
echo -e "${GREEN}✓ Backend built${NC}"
echo

echo -e "${YELLOW}Step 3a: Release integrity — is the artifact the source we just pulled?${NC}"
echo "--------------------------------------"
# NON-BYPASSABLE. Proves EXPECTED_GIT_SHA == BACKEND_BUILD_SHA and that the source migration
# manifest equals the compiled one, BEFORE anything restarts. A build that silently produced a
# different manifest than src/ is exactly how migrations "apply" and then do not.
# set -e stops the deploy here on failure, which is the intent.
npm run release:verify
echo


echo -e "${YELLOW}Step 4: Build frontend${NC}"
echo "--------------------------------------"
cd "$ROOT"
# Built from source, in place. The previous version of this script extracted a
# pre-built tarball from /tmp and ran `rm -rf dist/*` BEFORE checking the tarball was
# there — a missing or half-copied tarball emptied the directory nginx serves and took
# the site down with no way back except the backup.
npm run build
echo -e "${GREEN}✓ Frontend built${NC}"
echo

echo -e "${YELLOW}Step 5: Restart${NC}"
echo "--------------------------------------"
# Both processes. hrms2-workers runs the same backend dist and was never restarted by
# the old script, so every worker kept running the previous build until something else
# happened to bounce it.
pm2 restart hrms2-backend --update-env
pm2 restart hrms2-workers --update-env
echo

echo -e "${YELLOW}Step 6: Verify${NC}"
echo "--------------------------------------"

# Poll until healthy, and give it long enough.
#
# The first version waited 30 x 2s and then treated a single non-200 as fatal. On
# 2026-08-10 that reported "Deployment failed" — rollback instructions and all — for a
# deploy that had in fact succeeded: HEAD moved, both builds were clean, preflight:post
# said 0 pending, and health was 200 moments later. The backend simply had not finished
# binding, because boot verifies 478 manifest entries before it listens.
#
# A false failure on a green deploy is worse than no check. It teaches whoever runs this
# to ignore the output, which is the same habit that let a real 503 sit unnoticed for
# twelve minutes. 000 means "nothing listening yet" — that is the boot window, not an
# outage — so it is retried, and only a persistent non-200 fails the deploy.
wait_for_health() {
  local attempts=$1 code=""
  for _ in $(seq 1 "$attempts"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5055/api/health || true)
    [ "$code" = "200" ] && { echo "$code"; return 0; }
    sleep 2
  done
  echo "$code"
  return 1
}

echo "Waiting for the backend to come up (up to 3 minutes)..."
wait_for_health 90 > /dev/null || true

cd "$ROOT/backend"
# Confirms every manifest migration actually applied. A 503 here is the schema, not the
# network — read the failing filename it prints rather than restarting again.
npm run preflight:post

# The release certificate: source == artifact == BOTH runtimes, and schema.pending == 0.
# preflight:post proves the schema; this proves the processes are actually serving the commit
# that was approved, including hrms2-workers, which exposes no endpoint and was previously only
# ever INFERRED to have restarted.
npm run release:certify

# Re-check after the preflight, still tolerating a slow boot.
if code=$(wait_for_health 30); then
  echo -e "${GREEN}✓ /api/health 200${NC}"
else
  echo -e "${RED}✗ /api/health still $code after 60s of retries${NC}"
  curl -s http://localhost:5055/api/health || true
  exit 1
fi
echo

echo -e "${YELLOW}Step 7: Nginx (only if it can be done unattended)${NC}"
echo "--------------------------------------"
# Deliberately optional and non-fatal, both halves of which matter.
#
# Optional: nginx serves dist as static files and picks up a rebuild immediately. A
# reload is only needed when the nginx CONFIG changes, which a deploy does not do.
#
# Non-fatal: sudo on this host requires a password, so `sudo nginx -t` under `set -e`
# would hang for the prompt and then abort — reporting failure and printing rollback
# instructions for a deploy that had already succeeded, restart and health check
# included. Failing a green deploy at the last step is worse than skipping a step
# that changes nothing.
if sudo -n true 2>/dev/null; then
  sudo nginx -t && sudo systemctl reload nginx && echo -e "${GREEN}✓ Nginx reloaded${NC}"
else
  echo "Skipped — sudo needs a password here, and a static rebuild needs no reload."
  echo "If you changed nginx config: sudo nginx -t && sudo systemctl reload nginx"
fi
echo

trap - ERR
pm2 list | grep hrms2 || true
echo
echo "=========================================="
echo -e "${GREEN}Deployment Complete${NC}"
echo "=========================================="
echo "  from $ROLLBACK_SHA -> $(git -C "$ROOT" rev-parse --short HEAD)"
echo "  backup:   $BACKUP_DIR"
echo "  rollback: cd $ROOT && git reset --hard $ROLLBACK_SHA && tar xzf $BACKUP_DIR/frontend-dist.tar.gz -C $ROOT"
echo
echo "Verify:"
echo "  https://mcnhrms.teammas.in/"
echo "  https://mcnhrms.teammas.in/api/health"
