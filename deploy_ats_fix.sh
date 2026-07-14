#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ATS Fix Deployment Script
# Run this on production server: 122.184.128.90
# ═══════════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

SERVER="122.184.128.90"
USER="masadmin"
DB_NAME="mas_hrms"
DB_USER="root"
PROJECT_DIR="/var/www/HRMS2"

echo "═══════════════════════════════════════════════════════"
echo "ATS Fix Deployment"
echo "═══════════════════════════════════════════════════════"
echo ""

# Step 1: Pull latest code
echo "Step 1: Pulling latest code..."
cd "$PROJECT_DIR"
git pull origin main
echo "✓ Code updated"
echo ""

# Step 2: Run database migration
echo "Step 2: Running database migration..."
mysql -u "$DB_USER" -p "$DB_NAME" <<'EOSQL'
-- Backfill status from final_decision
UPDATE ats_candidate
SET status = final_decision
WHERE status IS NULL
  AND final_decision IS NOT NULL
  AND final_decision != '';

-- Backfill status from current_stage
UPDATE ats_candidate
SET status = CASE
  WHEN current_stage IN ('New', 'Applied', 'Registered', 'Screening') THEN 'Waiting'
  WHEN current_stage IN ('Interview', 'Interview Scheduled', 'In Interview') THEN 'In Interview'
  WHEN current_stage = 'Selected' THEN 'Selected'
  WHEN current_stage = 'Rejected' THEN 'Rejected'
  WHEN current_stage LIKE '%BGV%' THEN 'BGV Pending'
  WHEN current_stage LIKE '%Offer%' THEN 'Offer Pending'
  WHEN current_stage = 'Joined' THEN 'Joined'
  ELSE 'Waiting'
END
WHERE status IS NULL;

-- Create index if not exists
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'mas_hrms'
      AND TABLE_NAME = 'ats_candidate'
      AND INDEX_NAME = 'idx_ats_status') = 0,
  'ALTER TABLE ats_candidate ADD INDEX idx_ats_status (status)',
  'SELECT "Index already exists"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify
SELECT 'Migration completed. NULL status count:' AS result;
SELECT COUNT(*) as null_count FROM ats_candidate WHERE status IS NULL AND active_status = 1;
EOSQL
echo "✓ Database migration completed"
echo ""

# Step 3: Build frontend
echo "Step 3: Building frontend..."
npm install --silent
npm run build
echo "✓ Frontend built"
echo ""

# Step 4: Build backend
echo "Step 4: Building backend..."
cd backend
npm run build
echo "✓ Backend built"
cd ..
echo ""

# Step 5: Restart PM2
echo "Step 5: Restarting backend service..."
pm2 restart mcn-hrms-backend --update-env
pm2 save
echo "✓ Backend restarted"
echo ""

# Step 6: Verify
echo "Step 6: Verification..."
pm2 list | grep mcn-hrms-backend
echo ""

echo "═══════════════════════════════════════════════════════"
echo "✓ Deployment Complete!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Test URLs:"
echo "  - https://mcnhrms.teammas.in/ats/candidate-master"
echo "  - https://mcnhrms.teammas.in/ats/walkin-queue"
echo ""
echo "Test Accounts:"
echo "  - MAS62536 / Khushi@123"
echo "  - MAS61042 / Mehar@2005"
echo ""
