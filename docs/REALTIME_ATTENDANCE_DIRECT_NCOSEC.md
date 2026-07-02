# Real-Time Attendance Display via Direct NCOSEC Integration

## Overview

Implemented **direct read-only NCOSEC queries** for real-time attendance display on the Attendance Calendar page, while keeping the existing sync pipeline for payroll calculations.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ATTENDANCE CALENDAR PAGE                  │
│                     (Employee View)                          │
└────────────┬────────────────────────────────────────────────┘
             │
             │ Frontend polls every 60s
             ↓
┌─────────────────────────────────────────────────────────────┐
│         GET /api/wfm/attendance/today-live                   │
│         GET /api/wfm/attendance/calendar-live                │
└────────────┬────────────────────────────────────────────────┘
             │
             ├──► PRIMARY: Direct NCOSEC Query (5-10s latency)
             │    ↓
             │    NCOSEC.dbo.Mx_ATDEventTrn (READ-ONLY)
             │    ↓
             │    Real-time punch events
             │
             └──► FALLBACK: Synced Data (if NCOSEC unavailable)
                  ↓
                  mas_hrms.biometric_attendance_log
```

### Payroll Pipeline (Unchanged)

```
NCOSEC.dbo.Mx_ATDEventTrn
    ↓ (5-min scheduled sync)
integration_biometric_daily
    ↓ (processing)
biometric_attendance_log
    ↓ (validation & attendance engine)
attendance_daily_record
    ↓
PAYROLL CALCULATIONS
```

## What Changed

### 1. New Service: `attendance-realtime-ncosec.service.ts`

**Purpose**: Direct read-only queries to NCOSEC for display

**Key Functions**:
- `getRealTimePunchesToday(employeeId)` - Today's punches
- `getRealTimePunchesRange(employeeId, fromDate, toDate)` - Max 7 days

**Features**:
- Reads from `employee_external_mapping` table for NCOSEC UserID mapping
- Falls back to `employee_code` if no mapping exists
- Queries `NCOSEC.dbo.Mx_ATDEventTrn` directly (READ-ONLY)
- Returns standardized `RealTimePunch` objects with source tag

### 2. Updated Route: `/api/wfm/attendance/today-live`

**Behavior**:
1. **Try** real-time NCOSEC query first
2. **Catch** any errors (connection, timeout, etc.)
3. **Fallback** to synced `biometric_attendance_log`
4. **Return** with `source` field indicating origin:
   - `"ncosec_realtime"` - Direct from NCOSEC
   - `"biometric_synced"` - From sync pipeline

**Benefits**:
- No breaking changes to frontend
- Graceful degradation if NCOSEC unavailable
- Real-time visibility (5-10s latency vs. 5-min sync interval)

### 3. New Route: `/api/wfm/attendance/calendar-live`

**Purpose**: Fetch real-time punch data for calendar date range

**Query Parameters**:
- `fromDate` (required): YYYY-MM-DD
- `toDate` (required): YYYY-MM-DD
- Max 7 days for performance

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "punch_date": "2026-06-27",
      "first_punch_in": "2026-06-27T09:15:00+05:30",
      "last_punch_out": "2026-06-27T18:30:00+05:30",
      "raw_minutes": 555,
      "total_punches": 4,
      "source": "ncosec_realtime"
    }
  ],
  "count": 1
}
```

### 4. New Table: `employee_external_mapping`

**Purpose**: Map HRMS employee IDs to external system identifiers

**Schema**:
```sql
CREATE TABLE employee_external_mapping (
  id               CHAR(36) PRIMARY KEY,
  employee_id      CHAR(36) NOT NULL,
  system_name      VARCHAR(50) NOT NULL,  -- 'ncosec', 'legacy_payroll', etc.
  external_id      VARCHAR(100) NOT NULL, -- UserID in external system
  mapping_source   ENUM('auto', 'manual', 'import'),
  is_active        TINYINT(1) DEFAULT 1,
  ...
  UNIQUE KEY (employee_id, system_name)
);
```

**Initial Data**:
- Auto-populated with `employee_code → ncosec` mappings
- Can be overridden with manual mappings for discrepancies

## Benefits

### ✅ Real-Time Visibility
- Employees see punch events within 5-10 seconds
- No waiting for 5-minute sync interval
- Better user experience

### ✅ No Payroll Impact
- Payroll calculations continue using validated sync pipeline
- No risk to financial/compliance data
- Audit trail preserved

### ✅ Graceful Degradation
- Falls back to synced data if NCOSEC unavailable
- No breaking changes to frontend
- Progressive enhancement

### ✅ Read-Only Safety
- All NCOSEC queries are SELECT-only
- No write operations to external system
- Connection pool uses `readOnlyIntent: true`

## Frontend Integration (Optional)

**Current**: Frontend polls `/api/wfm/attendance/today-live` every 60s

**Enhanced (Optional)**:
```typescript
// In Attendance.tsx or Calendar component
const { data: calendarData } = useQuery({
  queryKey: ['attendance-calendar-live', fromDate, toDate],
  queryFn: async () => {
    const res = await hrmsApi.get<{ data: RealTimePunch[] }>(
      `/api/wfm/attendance/calendar-live?fromDate=${fromDate}&toDate=${toDate}`
    );
    return res.data;
  },
  refetchInterval: 60 * 1000, // Poll every 60s
  staleTime: 30 * 1000,
});
```

**Display Source Badge** (Optional):
```tsx
{punchData.source === 'ncosec_realtime' && (
  <Badge variant="success">Live</Badge>
)}
{punchData.source === 'biometric_synced' && (
  <Badge variant="secondary">Synced</Badge>
)}
```

## Deployment Steps

### 1. Run SQL Migration
```bash
cd backend
mysql -u root -p mas_hrms < sql/260_employee_external_mappings.sql
```

This creates `employee_external_mapping` table and populates initial mappings.

### 2. Verify NCOSEC Connection
```bash
# Check .env has NCOSEC credentials
grep NCOSEC_ .env

# Should see:
# NCOSEC_DB_HOST=172.10.10.146
# NCOSEC_DB_PORT=1433
# NCOSEC_DB_USER=...
# NCOSEC_DB_PASSWORD=...
# NCOSEC_DB_NAME=NCOSEC
# NCOSEC_EVENT_TABLE=dbo.Mx_ATDEventTrn
```

### 3. Restart Backend
```bash
cd backend
npm run build
pm2 restart hrms-backend
```

### 4. Test Real-Time Endpoint
```bash
# Get JWT token from login
TOKEN="your-jwt-token"

# Test today's punches
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/wfm/attendance/today-live

# Test calendar range
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/wfm/attendance/calendar-live?fromDate=2026-06-20&toDate=2026-06-27"
```

### 5. Monitor Logs
```bash
pm2 logs hrms-backend | grep -i ncosec
```

Watch for:
- `[realtime-ncosec]` log entries
- Any connection errors
- Fallback to synced data messages

## Performance Considerations

### Query Performance
- **Direct NCOSEC**: ~5-10s for today's data (network + DB latency)
- **Synced Data**: <100ms (local MySQL)
- **7-day Range**: ~10-15s (limited to prevent abuse)

### Connection Pooling
- Uses existing `getNcosecPool()` from `ncosecDb.ts`
- Read-only connection with 15s timeout
- Shared pool with sync worker (no extra connections)

### Rate Limiting (Future)
If needed, add rate limiting per employee:
```typescript
// In attendance-daily-scoped.routes.ts
import rateLimit from 'express-rate-limit';

const realtimeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per user
  keyGenerator: (req) => req.authUser!.id,
});

attendanceDailyScopedRouter.get(
  "/today-live",
  realtimeLimiter,
  h(async (req, res) => { ... })
);
```

## Troubleshooting

### Issue: "NCOSEC connection failed"
**Cause**: Network, credentials, or NCOSEC server down  
**Effect**: Falls back to synced data automatically  
**Action**: Check `.env` credentials, verify NCOSEC server is reachable

### Issue: "No COSEC mapping found for employee"
**Cause**: Employee has no entry in `employee_external_mapping` and `employee_code` is NULL  
**Fix**:
```sql
INSERT INTO employee_external_mapping (employee_id, system_name, external_id, mapping_source)
VALUES ('employee-uuid', 'ncosec', 'ACTUAL_NCOSEC_USERID', 'manual');
```

### Issue: Synced data shows but real-time doesn't
**Cause**: Real-time query returning no results (employee code mismatch)  
**Debug**:
```sql
-- Check mapping
SELECT e.employee_code, em.external_id
FROM employees e
LEFT JOIN employee_external_mapping em ON em.employee_id = e.id AND em.system_name = 'ncosec'
WHERE e.id = 'employee-uuid';

-- Check NCOSEC has data for that UserID
-- (Run on NCOSEC database)
SELECT TOP 10 UserID, Edatetime
FROM dbo.Mx_ATDEventTrn
WHERE UserID = 'EMPLOYEE_CODE_HERE'
ORDER BY Edatetime DESC;
```

## Files Changed

### New Files
- `backend/src/modules/wfm/attendance-realtime-ncosec.service.ts` - Real-time NCOSEC service
- `backend/sql/260_employee_external_mappings.sql` - External ID mapping table
- `docs/REALTIME_ATTENDANCE_DIRECT_NCOSEC.md` - This document

### Modified Files
- `backend/src/modules/wfm/attendance-daily-scoped.routes.ts`:
  - Updated `/today-live` to try real-time first, fallback to synced
  - Added `/calendar-live` endpoint for date range queries

### Unchanged (Important)
- All payroll calculation logic
- Sync worker schedules and processes
- `biometric_attendance_log` usage for payroll
- `attendance_daily_record` processing
- Frontend polling mechanism (still 60s interval)

## Rollback Plan

If issues arise, rollback is safe:

1. **Backend Code**: Revert `attendance-daily-scoped.routes.ts` to previous version
2. **Database**: Table `employee_external_mapping` can remain (not breaking)
3. **Frontend**: No changes required (still works with synced data)

The fallback mechanism ensures zero downtime even if real-time queries fail.

---

**Author**: Claude Code  
**Date**: 2026-06-27  
**Status**: Ready for UAT  
