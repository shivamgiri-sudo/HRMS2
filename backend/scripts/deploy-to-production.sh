#!/bin/bash
# Deploy hrms2-backend to production with zero downtime.
#
# Usage: bash scripts/deploy-to-production.sh
#
# What it does:
#   1. Pull latest main on the server
#   2. Install any new npm packages
#   3. Build backend TypeScript
#   4. Build frontend Vite bundle
#   5. pm2 reload hrms2-backend  ← zero-downtime: one worker restarts at a time
#   6. Verify health endpoint returns ok
#
# Requires: plink in PATH, server reachable on LAN (192.168.11.225)
#
# NEVER RUN without explicit user approval.
set -euo pipefail

SERVER="masadmin@192.168.11.225"
PASS="Support#123"
APP_DIR="/var/www/HRMS2"

run() {
  echo "→ $1"
  plink -ssh -batch -pw "$PASS" "$SERVER" "$2" 2>&1
}

echo "=== HRMS2 Production Deploy ==="
echo "Server: $SERVER"
echo ""

# 1. Pull latest code
run "git pull origin main" \
  "cd $APP_DIR && git fetch origin && git reset --hard origin/main"

# 2. Install npm packages including devDependencies (TypeScript + @types needed for build)
run "npm install (backend)" \
  "cd $APP_DIR/backend && npm ci 2>&1 | tail -3"

# 3. Build backend
run "Build backend TypeScript" \
  "cd $APP_DIR/backend && npm run build 2>&1 | tail -5"

# 4. Build frontend
run "Build frontend Vite" \
  "cd $APP_DIR && npm run build 2>&1 | tail -5"

# 5. Zero-downtime reload using PM2 cluster mode
echo "→ pm2 reload hrms2-backend (zero-downtime)"
plink -ssh -batch -pw "$PASS" "$SERVER" \
  "pm2 reload $APP_DIR/backend/ecosystem.config.cjs --only hrms2-backend 2>&1 | tail -5"

# Wait for workers to be ready
sleep 8

# 6. Health check
echo "→ Verifying health..."
HEALTH=$(plink -ssh -batch -pw "$PASS" "$SERVER" \
  "curl -s -k https://127.0.0.1/api/health -H 'Host: mcnhrms.teammas.in' 2>/dev/null" 2>&1)

echo "Health: $HEALTH"
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo ""
  echo "✓ Deploy complete. Production is healthy."
else
  echo ""
  echo "⚠ Health check returned unexpected response — check logs:"
  echo "  pm2 logs hrms2-backend --err --lines 30 --nostream"
  exit 1
fi
