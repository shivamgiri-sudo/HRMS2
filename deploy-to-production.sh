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
# --ff-only, never a plain pull: a merge commit created on the production box is not
# reachable from origin and silently diverges the deploy from what was reviewed.
git pull --ff-only origin main
echo "Now at $(git rev-parse --short HEAD)"
echo

echo -e "${YELLOW}Step 2: Preflight — will a restart leave health at 503?${NC}"
echo "--------------------------------------"
cd "$ROOT/backend"
npm run preflight
echo

echo -e "${YELLOW}Step 3: Build backend${NC}"
echo "--------------------------------------"
# set -e stops here on a non-zero tsc. That matters: tsc emits output even when it
# reports errors, so a failed build still overwrites dist — building and restarting
# regardless is how a broken dist reaches production.
npm run build
echo -e "${GREEN}✓ Backend built${NC}"
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
echo "Waiting for the backend to come up..."
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5055/api/health || true)
  [ "$code" = "200" ] && break
  sleep 2
done

cd "$ROOT/backend"
# Confirms every manifest migration actually applied. A 503 here is the schema, not the
# network — read the failing filename it prints rather than restarting again.
npm run preflight:post

code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5055/api/health || true)
if [ "$code" != "200" ]; then
  echo -e "${RED}✗ /api/health returned $code${NC}"
  curl -s http://localhost:5055/api/health || true
  exit 1
fi
echo -e "${GREEN}✓ /api/health 200${NC}"
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
