#!/bin/bash
# HRMS2 Production Deployment Script - Auth Fixes
# Deploy commit aa77a2d7 (6 critical bug fixes)
# Server: 192.168.11.225 | User: masadmin
# Date: 2026-07-09

set -e

echo "================================"
echo "HRMS2 Production Deployment"
echo "Fixes: Auth bugs + Device sessions"
echo "================================"
echo ""

# Configuration
REPO_PATH="/home/masadmin/hrms-repo"
BACKEND_PATH="$REPO_PATH/backend"
FRONTEND_PATH="$REPO_PATH"
COMMIT="aa77a2d7"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Step 1: Verify repo exists and is clean
log_info "Step 1: Verifying repository..."
if [ ! -d "$REPO_PATH/.git" ]; then
  log_error "Repository not found at $REPO_PATH"
  exit 1
fi

cd "$REPO_PATH"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  log_warn "Uncommitted changes detected. Stashing..."
  git stash
fi

# Step 2: Fetch latest and verify commit
log_info "Step 2: Fetching from remote..."
git fetch origin main

log_info "Verifying commit $COMMIT exists..."
if ! git cat-file -t "$COMMIT" > /dev/null 2>&1; then
  log_error "Commit $COMMIT not found"
  exit 1
fi

# Step 3: Checkout commit
log_info "Step 3: Checking out $COMMIT..."
git checkout "$COMMIT"

# Step 4: Verify migration file exists
log_info "Step 4: Verifying migration file..."
if [ ! -f "$BACKEND_PATH/sql/371_user_device_sessions.sql" ]; then
  log_error "Migration file not found at backend/sql/371_user_device_sessions.sql"
  exit 1
fi

log_info "Migration file verified: $BACKEND_PATH/sql/371_user_device_sessions.sql"

# Step 5: Check if migration already applied
log_info "Step 5: Checking migration status..."
MIGRATION_APPLIED=$(mysql -h localhost -u hrms_user -p"$HRMS_DB_PASSWORD" mas_hrms -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_NAME='user_device_sessions' AND TABLE_SCHEMA='mas_hrms';" 2>/dev/null | tail -1)

if [ "$MIGRATION_APPLIED" -eq "0" ]; then
  log_info "Migration not applied. Running migration..."
  mysql -h localhost -u hrms_user -p"$HRMS_DB_PASSWORD" mas_hrms < "$BACKEND_PATH/sql/371_user_device_sessions.sql"
  log_info "Migration applied successfully"
else
  log_warn "Migration already applied. Skipping..."
fi

# Step 6: Backend deployment
log_info "Step 6: Deploying backend..."

cd "$BACKEND_PATH"

# Install dependencies (if needed)
if [ ! -d "node_modules" ]; then
  log_info "Installing backend dependencies..."
  npm install --production
fi

# Build TypeScript
log_info "Building TypeScript..."
npm run build

# Verify build succeeded
if [ ! -d "dist" ]; then
  log_error "Backend build failed"
  exit 1
fi

# Step 7: Frontend deployment
log_info "Step 7: Deploying frontend..."

cd "$FRONTEND_PATH"

# Install dependencies (if needed)
if [ ! -d "node_modules" ]; then
  log_info "Installing frontend dependencies..."
  npm install --production
fi

# Build frontend
log_info "Building frontend..."
npm run build

# Verify build succeeded
if [ ! -d "dist" ]; then
  log_error "Frontend build failed"
  exit 1
fi

# Step 8: Restart services
log_info "Step 8: Restarting services..."

if command -v pm2 &> /dev/null; then
  log_info "Using PM2 to restart services..."
  pm2 restart hrms-backend hrms-frontend --update-env
  sleep 3
  pm2 logs hrms-backend --lines 20
else
  log_warn "PM2 not found. Please restart services manually:"
  log_warn "  sudo systemctl restart hrms-backend hrms-frontend"
fi

# Step 9: Verify deployment
log_info "Step 9: Verifying deployment..."

# Check backend health
BACKEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null || echo "000")
if [ "$BACKEND_HEALTH" -eq "200" ]; then
  log_info "Backend is healthy (HTTP $BACKEND_HEALTH)"
else
  log_warn "Backend health check returned HTTP $BACKEND_HEALTH"
fi

# Check frontend
FRONTEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
if [ "$FRONTEND_HEALTH" -eq "200" ] || [ "$FRONTEND_HEALTH" -eq "304" ]; then
  log_info "Frontend is healthy (HTTP $FRONTEND_HEALTH)"
else
  log_warn "Frontend health check returned HTTP $FRONTEND_HEALTH"
fi

echo ""
echo "================================"
log_info "Deployment completed successfully!"
echo "================================"
echo ""
echo "Changes deployed:"
echo "  1. Migration file moved to backend/sql/"
echo "  2. Org settings routes fixed (public endpoint now accessible)"
echo "  3. GET /sessions endpoint fixed (reads from headers/query, not body)"
echo "  4. Inactivity logout now calls signOut() (no duplicated logic)"
echo "  5. Code indentation fixed in auth.service.ts (better readability)"
echo ""
echo "Database: user_device_sessions table status: $([ "$MIGRATION_APPLIED" -eq "1" ] && echo "ALREADY EXISTS" || echo "JUST CREATED")"
echo ""
log_warn "Please verify in the logs that all services are running correctly."
echo ""