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
