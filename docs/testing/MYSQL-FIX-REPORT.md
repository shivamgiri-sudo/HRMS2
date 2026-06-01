# MySQL Password Fix Report

**Date**: 2026-06-01 23:15 IST  
**Issue**: Database access denied  
**Resolution**: Password escaping in `.env` file

---

## Problem

**Error**: `Access denied for user 'shivam_user'@'122.161.72.232' (using password: YES)`

**Root Cause**: Password `qwersdfg!@#hjk` contains `#` character, which .env parsers treat as comment delimiter.

**Actual parsed value**: `qwersdfg!@` (truncated at `#`)

---

## Solution

Quote password in `backend/.env`:

```bash
# Before (BROKEN):
DB_PASSWORD=qwersdfg!@#hjk

# After (FIXED):
DB_PASSWORD="qwersdfg!@#hjk"
```

---

## Test Results

### Before Fix
- **Tests Passed**: 1/30 (3.3%)
- **Tests Failed**: 29/30 (96.7%)
- **Blocker**: Database access denied

### After Fix
- **Tests Passed**: 5/30 (16.7%)
- **Tests Failed**: 25/30 (83.3%)
- **Improvement**: 400% increase in passing tests

---

## Passing Tests (5)

| Test ID | Endpoint | Status |
|---------|----------|--------|
| TC-AUTH-001 | Protected route without token | ✅ PASS |
| TC-PAY-002 | GET /api/payroll/structures | ✅ PASS |
| TC-PAY-003 | GET /api/payroll/components | ✅ PASS |
| TC-LEV-001 | GET /api/leave/types | ✅ PASS |
| RBAC-004 | Admin access to /api/org/branches | ✅ PASS |

---

## Failing Tests (25)

### SQL Query Errors (15 tests)
**Error**: "Incorrect arguments to mysqld_stmt_execute"

| Endpoint | Impact |
|----------|--------|
| GET /api/employees | Cannot list employees |
| GET /api/payroll/runs | Cannot view payroll runs |
| GET /api/ats/candidates | Cannot list candidates |
| GET /api/leave/requests | Cannot view leave requests |
| GET /api/wfm/sessions | Cannot view attendance |

**Cause**: SQL parameter binding mismatch in prepared statements.

**Example**:
```typescript
// BROKEN (parameter count mismatch):
db.execute('SELECT * FROM employees WHERE status = ?', []); // 0 params, expects 1

// FIXED:
db.execute('SELECT * FROM employees WHERE status = ?', ['active']); // 1 param
```

---

### Validation Errors (6 tests)
**Error**: "Validation failed - Required fields missing"

Affected:
- POST /api/employees
- POST /api/wfm/sessions/clock-in
- POST /api/wfm/sessions/break
- POST /api/wfm/regularizations
- POST /api/ats/candidates
- POST /api/leave/requests

**Cause**: Test payloads incomplete (missing employee IDs, required fields).

**Resolution**: Update test script with complete payloads once SQL queries fixed.

---

### Missing Routes (4 tests)
**Error**: "Route not found" (404)

| Endpoint | Expected |
|----------|----------|
| GET /api/ats/onboarding-bridge | 200 |
| GET /api/leave/balance | 200 |
| GET /api/portal/health | 200 |

**Resolution**: Verify if routes implemented or update test script.

---

## Impact Assessment

### Fixed
- ✅ MySQL connectivity restored
- ✅ Demo token authentication working
- ✅ Basic GET endpoints functional (structures, components, types, branches)

### Remaining Issues
- ❌ SQL query bugs in 50% of endpoints (parameter binding errors)
- ❌ Test data incomplete (validation errors)
- ❌ Some routes missing (404 errors)

---

## Next Steps

1. **Fix SQL Query Bugs** (P0)
   - Review `employee.service.ts` - employee list query
   - Review `payroll.service.ts` - payroll runs query
   - Review `ats.service.ts` - candidates list query
   - Review `leave.service.ts` - leave requests query
   - Review `wfm.service.ts` - attendance sessions query

2. **Seed Demo Data** (P1)
   - Link demo tokens to real employee IDs in database
   - Create demo employees for each role
   - Assign roles + permissions

3. **Update Test Payloads** (P1)
   - Add employee IDs from database
   - Include all required fields per validation schema

4. **Verify Missing Routes** (P2)
   - Check if `/api/ats/onboarding-bridge` implemented
   - Check if `/api/leave/balance` implemented
   - Check if `/api/portal/health` implemented

---

## Verification

```bash
# Verify password loads correctly
cd /home/shuvam/mas-callnet-hrms/backend
node -e "require('dotenv').config(); console.log('Password:', process.env.DB_PASSWORD);"
# Expected: Password: qwersdfg!@#hjk

# Test MySQL connection from CLI
mysql -h 122.184.128.90 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms -e "SELECT COUNT(*) FROM employees;"
# Expected: 11 employees

# Test MySQL connection from Node
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: '122.184.128.90',
    user: 'shivam_user',
    password: 'qwersdfg!@#hjk',
    database: 'mas_hrms'
  });
  const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM employees');
  console.log('Count:', rows[0].cnt);
  await pool.end();
})();
"
# Expected: Count: 11

# Run API tests
cd /home/shuvam/mas-callnet-hrms
./test-api.sh
# Expected: 5/30 passing
```

---

## Lessons Learned

1. **Always quote .env values with special characters**
   - Characters like `#`, `$`, `&`, `!` can break parsing
   - Safer to quote all string values

2. **Test environment variable loading early**
   - Add startup log: `console.log('DB config loaded:', { host, user, database })`
   - Don't log passwords in production

3. **Use connection health checks**
   - Add `/health` endpoint that tests DB connectivity
   - Include in monitoring/alerts

---

**Fixed By**: Claude (Automated Testing)  
**Report Generated**: 2026-06-01 23:15 IST
