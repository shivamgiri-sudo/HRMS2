#!/bin/bash

##############################################################################
# Auto-Sync Setup Script for db_bill → mas_hrms Salary Sync
#
# Purpose: Sets up automated daily sync from db_bill to mas_hrms
# Will be DISABLED once mas_hrms becomes the source of truth
#
# Phase 1 (Current): db_bill → mas_hrms (SYNC ENABLED)
# Phase 2 (Future):  mas_hrms = source of truth (SYNC DISABLED)
##############################################################################

SCRIPT_DIR="/home/shuvam/hrms-audit/scripts"
SYNC_SCRIPT="$SCRIPT_DIR/db_bill-to-mas_hrms-salary-sync.js"
LOG_DIR="$SCRIPT_DIR/logs"
CRON_USER="shuvam"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "============================================================"
echo "  Auto-Sync Setup for db_bill → mas_hrms"
echo "============================================================"
echo ""

# Create log directory
mkdir -p "$LOG_DIR"
echo -e "${GREEN}✅ Created log directory: $LOG_DIR${NC}"

# Create log rotation script
cat > "$SCRIPT_DIR/rotate-logs.sh" << 'EOF'
#!/bin/bash
# Rotate sync logs older than 30 days
LOG_DIR="/home/shuvam/hrms-audit/scripts/logs"
find "$LOG_DIR" -name "sync-*.log" -mtime +30 -delete
echo "$(date): Log rotation completed"
EOF

chmod +x "$SCRIPT_DIR/rotate-logs.sh"
echo -e "${GREEN}✅ Created log rotation script${NC}"

# Create wrapper script for cron
cat > "$SCRIPT_DIR/run-sync-cron.sh" << 'EOF'
#!/bin/bash

##############################################################################
# Cron Wrapper for Salary Sync
# This script is called by cron daily to sync salary data
##############################################################################

SCRIPT_DIR="/home/shuvam/hrms-audit/scripts"
LOG_DIR="$SCRIPT_DIR/logs"
DATE_STR=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/sync-auto-$DATE_STR.log"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found" >> "$LOG_FILE"
    exit 1
fi

# Check if sync is enabled (file-based toggle)
SYNC_ENABLED_FILE="$SCRIPT_DIR/.sync-enabled"
if [ ! -f "$SYNC_ENABLED_FILE" ]; then
    echo "$(date): Sync DISABLED - mas_hrms is now source of truth" >> "$LOG_FILE"
    exit 0
fi

# Run the sync
cd "$SCRIPT_DIR" || exit 1

echo "========================================" >> "$LOG_FILE"
echo "Sync started at: $(date)" >> "$LOG_FILE"
echo "Mode: Delta (last 2 months)" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

node db_bill-to-mas_hrms-salary-sync.js --mode=delta --months=2 >> "$LOG_FILE" 2>&1

EXIT_CODE=$?

echo "========================================" >> "$LOG_FILE"
echo "Sync completed at: $(date)" >> "$LOG_FILE"
echo "Exit code: $EXIT_CODE" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

# Send notification on failure
if [ $EXIT_CODE -ne 0 ]; then
    echo "ALERT: Salary sync failed with exit code $EXIT_CODE" | mail -s "HRMS Sync Failed" admin@teammas.in 2>/dev/null || true
fi

exit $EXIT_CODE
EOF

chmod +x "$SCRIPT_DIR/run-sync-cron.sh"
echo -e "${GREEN}✅ Created cron wrapper script${NC}"

# Enable sync by default
touch "$SCRIPT_DIR/.sync-enabled"
echo -e "${GREEN}✅ Sync ENABLED (db_bill → mas_hrms active)${NC}"

# Create cron job
CRON_ENTRY="0 2 * * * $SCRIPT_DIR/run-sync-cron.sh"
CRON_ROTATION="0 3 * * 0 $SCRIPT_DIR/rotate-logs.sh"

echo ""
echo "============================================================"
echo "  Cron Job Configuration"
echo "============================================================"
echo ""
echo "The following cron jobs will be added:"
echo ""
echo "1. Daily Salary Sync (2:00 AM)"
echo "   $CRON_ENTRY"
echo ""
echo "2. Weekly Log Rotation (Sunday 3:00 AM)"
echo "   $CRON_ROTATION"
echo ""

# Check if cron jobs already exist
if crontab -l 2>/dev/null | grep -q "run-sync-cron.sh"; then
    echo -e "${YELLOW}⚠️  Cron job already exists, skipping...${NC}"
else
    # Add to crontab
    (crontab -l 2>/dev/null; echo ""; echo "# HRMS Salary Sync from db_bill"; echo "$CRON_ENTRY"; echo "$CRON_ROTATION") | crontab -
    echo -e "${GREEN}✅ Cron jobs added successfully${NC}"
fi

echo ""
echo "============================================================"
echo "  Setup Complete!"
echo "============================================================"
echo ""
echo "Sync Status: ${GREEN}ENABLED${NC}"
echo "Sync Schedule: Daily at 2:00 AM"
echo "Log Directory: $LOG_DIR"
echo ""
echo "Commands:"
echo "  • Enable sync:  touch $SCRIPT_DIR/.sync-enabled"
echo "  • Disable sync: rm $SCRIPT_DIR/.sync-enabled"
echo "  • Manual sync:  $SCRIPT_DIR/run-sync-cron.sh"
echo "  • View logs:    tail -f $LOG_DIR/sync-auto-*.log"
echo ""
echo "============================================================"
echo ""
echo -e "${YELLOW}NOTE: When mas_hrms becomes source of truth, run:${NC}"
echo -e "${YELLOW}  rm $SCRIPT_DIR/.sync-enabled${NC}"
echo ""
