#!/bin/bash
# Rotate sync logs older than 30 days
LOG_DIR="/home/shuvam/hrms-audit/scripts/logs"
find "$LOG_DIR" -name "sync-*.log" -mtime +30 -delete
echo "$(date): Log rotation completed"
