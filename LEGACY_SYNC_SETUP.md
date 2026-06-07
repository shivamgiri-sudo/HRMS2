# Legacy Database Sync System - Deployment Guide

**Date**: 2026-06-07  
**System**: Real-time incremental sync from legacy SQL Server (db_bill) to HRMS MySQL  
**Timeline**: 1-month transition period before legacy sunset  

---

## Architecture Overview

```
Legacy SQL Server (192.168.10.22:1433/db_bill)
              ↓
    Change Tracking (incremental)
              ↓
    Sync Worker (60s interval)
              ↓
    Domain Handlers (parallel)
              ↓
    Staging Tables (validation)
              ↓
  HRMS MySQL (122.184.128.90/mas_hrms)
  
Conflict Resolution: Legacy WINS (source of truth during transition)
```

---

## ✅ Completed Steps

### 1. Database Schema (060, 061)
- ✅ 10 tables created: `legacy_*` and `stg_legacy_*`
- ✅ Admin user created: shivam.giri@teammas.in (password: Admin@MAS2026)

```bash
# Already applied migrations:
mysql -h 122.184.128.90 -u root -p mas_hrms < backend/sql/060_legacy_sync_schema.sql
mysql -h 122.184.128.90 -u root -p mas_hrms < backend/sql/061_admin_setup.sql
```

### 2. Backend Implementation
- ✅ API endpoints: `/api/legacy/*` (8 endpoints, admin-only)
- ✅ Metadata analyzer (relevance scoring)
- ✅ Sync engine (Change Tracking based)
- ✅ Employee domain handler (MVP)
- ✅ Worker auto-starts with backend server

---

## 🔧 Configuration

### Environment Variables

Add to `backend/.env`:

```bash
# Legacy SQL Server Connection
LEGACY_MSSQL_HOST=192.168.10.22
LEGACY_MSSQL_PORT=1433
LEGACY_MSSQL_DATABASE=db_bill
LEGACY_MSSQL_USER=hrms_readonly  # Use read-only user if available
LEGACY_MSSQL_PASSWORD=<secure_password>
LEGACY_MSSQL_ENCRYPT=false
LEGACY_MSSQL_TRUST_CERT=true

# Sync Configuration
LEGACY_SYNC_ENABLED=false  # Set to true to activate
LEGACY_SYNC_INTERVAL_MS=60000  # 60 seconds
LEGACY_SYNC_BATCH_SIZE=1000
LEGACY_SYNC_PARALLEL_DOMAINS=true
LEGACY_SYNC_MAX_RETRIES=3
LEGACY_SYNC_RETRY_DELAY_MS=5000
LEGACY_CT_RETENTION_DAYS=2
```

---

## 📋 Pre-Deployment Checklist

### A. Legacy SQL Server (IT Task - Required)

**Enable Change Tracking on database:**

```sql
-- Connect to legacy SQL Server (192.168.10.22)
USE db_bill;

-- Enable Change Tracking on database
ALTER DATABASE db_bill  
SET CHANGE_TRACKING = ON  
(CHANGE_RETENTION = 2 DAYS, AUTO_CLEANUP = ON);

-- Enable Change Tracking on tables to sync
ALTER TABLE dbo.employee_master ENABLE CHANGE_TRACKING;
ALTER TABLE dbo.branch_master ENABLE CHANGE_TRACKING;
ALTER TABLE dbo.attendance_log ENABLE CHANGE_TRACKING;
-- Add more tables as needed

-- Verify Change Tracking is enabled
SELECT 
  s.name AS schema_name,
  t.name AS table_name,
  ct.is_track_columns_updated_on
FROM sys.change_tracking_tables ct
INNER JOIN sys.tables t ON ct.object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id;
```

### B. Discover Legacy Tables

1. Login to HRMS as admin (shivam.giri@teammas.in)
2. Call analyzer API:

```bash
curl -X POST http://localhost:3002/api/legacy/analyze/schema \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json"
```

3. Review results in `legacy_source_table_profile` table:

```sql
SELECT 
  schema_name,
  table_name,
  row_count,
  relevance_score,
  relevance_reason
FROM legacy_source_table_profile
WHERE relevance_score >= 30
ORDER BY relevance_score DESC, row_count DESC
LIMIT 20;
```

### C. Configure Sync Maps

Create sync maps for each domain. Example for Employee:

```sql
USE mas_hrms;

INSERT INTO legacy_sync_map (
  id, hrms_domain, source_schema, source_table, source_key_column,
  source_watermark_column, target_table, target_key_column,
  column_mapping_json, transform_rules_json,
  sync_mode, sync_order, active_status
) VALUES (
  UUID(),
  'Employee',
  'dbo',
  'employee_master',  -- Replace with actual table name
  'emp_id',           -- Replace with actual primary key
  'modified_date',    -- Replace with actual watermark column
  'employees',
  'employee_code',
  JSON_OBJECT(
    'emp_code', 'employee_code',
    'emp_name', 'full_name',
    'email', 'official_email',
    'mobile', 'mobile',
    'join_date', 'date_of_joining'
  ),
  NULL,  -- No transform rules for now
  'upsert',
  100,
  1  -- Active
);
```

**Column Mapping Format:**
- Key: Legacy column name
- Value: HRMS column name

---

## 🚀 Activation Steps

### 1. Test Connection

```bash
curl http://localhost:3002/api/legacy/health \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

Expected response:
```json
{
  "ok": true,
  "message": "Legacy database connection healthy",
  "details": {
    "host": "192.168.10.22",
    "database": "db_bill",
    "syncEnabled": false
  }
}
```

### 2. Dry Run (Test One Domain)

Set up ONE sync map (Employee) with `active_status = 1`, but keep `LEGACY_SYNC_ENABLED=false`.

Manually trigger a test sync (requires code modification to add a one-time trigger endpoint).

### 3. Enable Sync

Once tested, update `.env`:

```bash
LEGACY_SYNC_ENABLED=true
```

Restart backend:

```bash
cd backend
npm run build
pm2 restart hrms-backend
```

### 4. Monitor

Check sync status:

```bash
curl http://localhost:3002/api/legacy/sync/status \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

View sync logs:

```sql
SELECT 
  lsr.id,
  lsm.hrms_domain,
  lsr.started_at,
  lsr.finished_at,
  lsr.rows_inserted,
  lsr.rows_updated,
  lsr.status,
  lsr.error_message
FROM legacy_sync_run_log lsr
JOIN legacy_sync_map lsm ON lsr.sync_map_id = lsm.id
ORDER BY lsr.started_at DESC
LIMIT 50;
```

Check exceptions:

```sql
SELECT 
  lse.id,
  lsm.hrms_domain,
  lse.exception_type,
  lse.source_key,
  lse.error_message,
  lse.resolved_status,
  lse.created_at
FROM legacy_sync_exception lse
JOIN legacy_sync_map lsm ON lse.sync_map_id = lsm.id
WHERE lse.resolved_status = 'pending'
ORDER BY lse.created_at DESC;
```

---

## 📊 API Endpoints

All endpoints require admin authentication.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/legacy/health` | GET | Connection health check |
| `/api/legacy/connection-info` | GET | Configuration details |
| `/api/legacy/analyze/schema` | POST | Scan legacy database |
| `/api/legacy/mapping-candidates` | GET | View suggested mappings |
| `/api/legacy/mapping-candidates/:id/approve` | POST | Approve mapping |
| `/api/legacy/mapping-candidates/:id/reject` | POST | Reject mapping |
| `/api/legacy/sync-maps` | GET | List active sync maps |
| `/api/legacy/sync/status` | GET | Sync overview |

---

## 🔍 Troubleshooting

### Issue: "Change Tracking not enabled"

**Solution**: Run the CT enablement SQL on legacy SQL Server (see Pre-Deployment Checklist A)

### Issue: "No changes found"

**Possible causes:**
1. No data changes since last checkpoint
2. Change Tracking version expired (retention = 2 days)
3. Incorrect `source_watermark_column` in sync map

**Solution**: Check `legacy_sync_checkpoint` table for last synced version

### Issue: "Validation failed"

**Solution**: Check `legacy_sync_exception` table for details. Common issues:
- Missing required fields (employee_code, full_name)
- Invalid data formats (dates, emails)
- Unmapped columns

### Issue: "Sync worker not starting"

**Check:**
1. `LEGACY_SYNC_ENABLED=true` in .env
2. Backend logs: `tail -f /tmp/backend.log`
3. Server started successfully

---

## 🎯 Production Rollout Plan

### Week 1: Single Domain Testing
- [x] Deploy infrastructure
- [ ] Enable CT on employee_master table
- [ ] Configure Employee sync map
- [ ] Test with LEGACY_SYNC_ENABLED=false (manual trigger)
- [ ] Verify data quality in staging table
- [ ] Monitor for 3 days

### Week 2: Expand Domains
- [ ] Add Branch sync map
- [ ] Add Attendance sync map (high volume)
- [ ] Enable sync: LEGACY_SYNC_ENABLED=true
- [ ] Monitor performance and error rates

### Week 3-4: Full Production
- [ ] Add remaining domains (Leave, Salary, Assets, Process)
- [ ] Tune batch sizes and intervals
- [ ] Set up alerts for sync failures
- [ ] Document exception resolution procedures

### Month 2+: Legacy Sunset
- [ ] Verify all data synced successfully
- [ ] Switch applications to read from HRMS only
- [ ] Disable sync: LEGACY_SYNC_ENABLED=false
- [ ] Archive legacy database

---

## 📁 Database Tables Reference

### Metadata Tables
- `legacy_source_table_profile` - Discovered legacy tables
- `legacy_source_column_profile` - Column metadata
- `legacy_mapping_candidates` - AI-suggested mappings
- `legacy_sync_map` - Active sync configurations
- `legacy_sync_checkpoint` - Last synced CT version per map
- `legacy_sync_run_log` - Audit log of all runs
- `legacy_sync_exception` - Failed records needing review

### Staging Tables
- `stg_legacy_employee_master` - Employee staging
- `stg_legacy_branch_master` - Branch staging
- `stg_legacy_attendance` - Attendance staging

---

## 🔐 Security Notes

1. **Read-Only User**: Create a read-only SQL Server user for legacy access
2. **Network Security**: Ensure firewall allows 192.168.10.22:1433 → HRMS backend
3. **Credentials**: Store in environment variables, never commit to git
4. **Audit**: All sync operations logged in `legacy_sync_run_log`
5. **Admin-Only**: All legacy APIs require admin role

---

## 📞 Support

**For sync issues:**
- Check logs: `legacy_sync_run_log`, `legacy_sync_exception`
- Review API: `GET /api/legacy/sync/status`

**For database issues:**
- Verify CT enabled on legacy SQL Server
- Check network connectivity: `telnet 192.168.10.22 1433`

**For mapping issues:**
- Review column profiles: `legacy_source_column_profile`
- Adjust `column_mapping_json` in sync maps

---

**Last Updated**: 2026-06-07  
**Status**: Ready for production testing  
**Version**: MVP 1.0 (Employee domain)
