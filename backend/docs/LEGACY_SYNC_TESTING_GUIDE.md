# Legacy Database Sync - Testing Guide

**Status:** ✅ **Ready for Testing**  
**Date:** 2026-06-07

---

## What's Built

✅ **MySQL Connection** - Connected to 14.97.30.236:3306/db_bill  
✅ **Source Table** - masjclrentry (32,634 employees, updated 2026-06-06)  
✅ **Target Table** - employees (30 new columns added)  
✅ **Sync Worker** - Timestamp-based incremental sync (60s interval)  
✅ **Field Mapping** - 165 legacy fields → 40+ HRMS fields  
✅ **Manual Trigger** - POST /api/legacy/sync/trigger  
✅ **Security** - Aadhaar masked (last 4 digits only)

---

## Quick Start (5 minutes)

### 1. Test Manual Sync (10 records)

```bash
# Login as admin first
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"shivam.giri@teammas.in","password":"Admin@MAS2026"}' \
  > /tmp/auth.json

TOKEN=$(cat /tmp/auth.json | jq -r '.token')

# Trigger manual sync
curl -X POST http://localhost:3002/api/legacy/sync/trigger \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Manual sync completed"
}
```

### 2. Verify Employees Synced

```bash
mysql -h 122.184.128.90 -u root -pvicidialnow mas_hrms -e "
SELECT 
  employee_code,
  CONCAT(first_name, ' ', COALESCE(last_name, '')) as name,
  mobile,
  branch,
  active_status,
  legacy_last_updated
FROM employees
WHERE legacy_emp_id IS NOT NULL
ORDER BY legacy_last_updated DESC
LIMIT 10;
"
```

### 3. Check Sync Logs

```bash
mysql -h 122.184.128.90 -u root -pvicidialnow mas_hrms -e "
SELECT 
  domain,
  status,
  records_processed,
  records_failed,
  completed_at
FROM legacy_sync_run_log
ORDER BY completed_at DESC
LIMIT 5;
"
```

---

## Testing Scenarios

### Test 1: Initial Sync (First 1000 employees)

**Setup:**
```bash
# Check current count
mysql -h 122.184.128.90 -u root -pvicidialnow mas_hrms -e \
  "SELECT COUNT(*) FROM employees WHERE legacy_emp_id IS NOT NULL;"
```

**Execute:**
```bash
curl -X POST http://localhost:3002/api/legacy/sync/trigger \
  -H "Authorization: Bearer $TOKEN"
```

**Verify:**
- Should insert ~1000 new employees
- All should have `legacy_emp_id` and `legacy_last_updated`
- Names should be split correctly (first_name + last_name)
- Aadhaar should be masked (only 4 digits)

---

### Test 2: Incremental Sync (Updated Records)

**Setup:**
```sql
-- Update an employee in legacy (on 14.97.30.236)
UPDATE db_bill.masjclrentry
SET Mobile = '9999999999', lastUpdated = NOW()
WHERE EmpCode = 'MAS00001';
```

**Execute:**
```bash
curl -X POST http://localhost:3002/api/legacy/sync/trigger \
  -H "Authorization: Bearer $TOKEN"
```

**Verify:**
```sql
-- Check if HRMS employee updated
SELECT employee_code, mobile, legacy_last_updated, updated_at
FROM employees
WHERE employee_code = 'MAS00001';
-- Should show: mobile = 9999999999, updated_at = NOW()
```

---

### Test 3: New Employee (Insert)

**Setup:**
```sql
-- Add new employee in legacy
INSERT INTO db_bill.masjclrentry (EmpCode, EmpName, Status, lastUpdated)
VALUES ('TEST001', 'John Doe', '1', NOW());
```

**Execute:**
```bash
curl -X POST http://localhost:3002/api/legacy/sync/trigger \
  -H "Authorization: Bearer $TOKEN"
```

**Verify:**
```sql
SELECT * FROM employees WHERE employee_code = 'TEST001';
-- Should exist with first_name='John', last_name='Doe'
```

---

### Test 4: Continuous Sync (Enable Worker)

**Enable:**
```bash
# Edit backend/.env
LEGACY_SYNC_ENABLED=true
LEGACY_SYNC_INTERVAL_MS=60000  # 60 seconds
LEGACY_SYNC_BATCH_SIZE=1000
```

**Restart Backend:**
```bash
pkill -f "tsx.*server.ts"
PORT=3002 npx tsx src/server.ts > /tmp/backend.log 2>&1 &
```

**Monitor:**
```bash
# Watch sync logs
tail -f /tmp/backend.log | grep LegacySync

# Expected every 60 seconds:
# [LegacySync] === Sync cycle starting ===
# [LegacySync] Found X changed employees
# [LegacySync] Sync complete: inserted=X, updated=Y, errors=0
```

---

## Verification Queries

### Count Synced Employees
```sql
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN active_status = 1 THEN 1 ELSE 0 END) as active,
  SUM(CASE WHEN active_status = 0 THEN 1 ELSE 0 END) as inactive
FROM employees
WHERE legacy_emp_id IS NOT NULL;
```

### Check Field Mapping Quality
```sql
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN first_name IS NULL THEN 1 ELSE 0 END) as missing_name,
  SUM(CASE WHEN mobile IS NULL AND email IS NULL THEN 1 ELSE 0 END) as missing_contact,
  SUM(CASE WHEN aadhaar_last4 IS NOT NULL THEN 1 ELSE 0 END) as has_aadhaar,
  SUM(CASE WHEN LENGTH(aadhaar_last4) > 4 THEN 1 ELSE 0 END) as aadhaar_not_masked
FROM employees
WHERE legacy_emp_id IS NOT NULL;
```

**Expected:**
- missing_name = 0
- missing_contact = 0
- aadhaar_not_masked = 0 (IMPORTANT: security check)

### Sync Performance
```sql
SELECT 
  status,
  AVG(records_processed) as avg_records,
  AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)) as avg_duration_sec,
  COUNT(*) as run_count
FROM legacy_sync_run_log
WHERE domain = 'employee'
GROUP BY status;
```

---

## Troubleshooting

### Issue: "No changes detected"

**Cause:** Checkpoint is ahead of legacy timestamps  
**Fix:**
```sql
-- Reset checkpoint to force re-sync
UPDATE legacy_sync_checkpoint
SET last_sync_time = DATE_SUB(NOW(), INTERVAL 1 MONTH)
WHERE domain = 'employee';
```

### Issue: "Connection timeout"

**Cause:** Legacy database not reachable  
**Fix:**
- Check VPN connection
- Verify IP: 14.97.30.236:3306
- Test: `mysql -h 14.97.30.236 -u shivam_user -p db_bill`

### Issue: "Duplicate entry for key 'employee_code'"

**Cause:** Employee already exists in HRMS  
**Expected:** ON DUPLICATE KEY UPDATE should handle this (no error)  
**If persists:** Check unique constraint on `employee_code`

### Issue: "Aadhaar not masked (12 digits found)"

**CRITICAL SECURITY ISSUE**  
**Fix:**
```sql
-- Mask all Aadhaar numbers
UPDATE employees
SET aadhaar_last4 = RIGHT(aadhaar_last4, 4)
WHERE LENGTH(aadhaar_last4) > 4;
```

---

## Production Rollout

### Phase 1: Initial Full Sync (Week 1)
- [ ] Disable continuous sync: `LEGACY_SYNC_ENABLED=false`
- [ ] Trigger manual sync in batches
- [ ] Verify 32,634 employees synced
- [ ] Audit data quality (name splitting, masking)

### Phase 2: Enable Continuous Sync (Week 2)
- [ ] Set `LEGACY_SYNC_ENABLED=true`
- [ ] Set `LEGACY_SYNC_INTERVAL_MS=300000` (5 minutes for production)
- [ ] Monitor sync logs daily
- [ ] Alert on sync failures

### Phase 3: Validation (Week 3)
- [ ] Compare employee counts: legacy vs HRMS
- [ ] Spot-check 100 random employees
- [ ] Verify attendance system integration (biometric_code)
- [ ] Test payroll integration (salary fields)

### Phase 4: Legacy Sunset (Month 2)
- [ ] After 1 month of successful sync
- [ ] Confirm HRMS is source of truth
- [ ] Decommission legacy sync
- [ ] Archive legacy database

---

## API Endpoints

### Health Check
```bash
GET /api/legacy/health
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "ok": true,
  "host": "14.97.30.236",
  "database": "db_bill",
  "connected": true
}
```

### Manual Sync Trigger
```bash
POST /api/legacy/sync/trigger
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Manual sync completed"
}
```

### Sync Status
```bash
GET /api/legacy/sync/status
Authorization: Bearer <admin-token>
```

**Response:**
```json
{
  "domain": "employee",
  "last_sync": "2026-06-07T10:30:00Z",
  "total_synced": 32634,
  "last_run_status": "success"
}
```

---

## Environment Variables

```bash
# Legacy MySQL Database
LEGACY_MYSQL_HOST=14.97.30.236
LEGACY_MYSQL_PORT=3306
LEGACY_MYSQL_DATABASE=db_bill
LEGACY_MYSQL_USER=shivam_user
LEGACY_MYSQL_PASSWORD=<from-secure-store>

# Sync Configuration
LEGACY_SYNC_ENABLED=false  # Set to true for production
LEGACY_SYNC_INTERVAL_MS=60000  # 60 seconds (use 300000 for production)
LEGACY_SYNC_BATCH_SIZE=1000
```

---

## Success Criteria

✅ **All 32,634 employees synced**  
✅ **0 validation errors**  
✅ **Aadhaar masked (4 digits only)**  
✅ **Name splitting accurate (>95%)**  
✅ **Sync lag < 5 minutes**  
✅ **Error rate < 1%**  
✅ **No duplicate employees**

---

## Support

**Issues:** Check `/tmp/backend.log` for sync errors  
**Database:** MySQL logs at `legacy_sync_run_log` table  
**Contact:** Ops team for legacy database access

**Last Updated:** 2026-06-07
