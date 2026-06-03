# Phase 1 Testing Guide - Client Master Enhancement

## Overview
Comprehensive testing for database schema and backend services introduced in Phase 1.

## Prerequisites

1. **Database Access**:
   - MySQL server running at `122.184.128.90:3306`
   - Database: `mas_hrms`
   - User: `shivam_user`
   - Password: `qwersdfg!@#hjk`

2. **Migration Status**:
   - Run migration: `mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < backend/sql/101_client_master_enhancement.sql`

3. **Node.js Environment**:
   - Node.js >= 16
   - npm installed
   - Backend dependencies: `cd backend && npm install`

## Test Suites

### 1. Database Schema Tests (SQL)

**File**: `backend/tests/phase1-client-master.test.sql`

**What it tests**:
- ✅ Table existence (8 new tables)
- ✅ Column structure (clients, portal_users enhancements, processes)
- ✅ Index verification
- ✅ CRUD operations on clients
- ✅ Activity logging
- ✅ Permission management
- ✅ Bulk operation job tracking
- ✅ Audit trail

**How to run**:
```bash
# From project root
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < backend/tests/phase1-client-master.test.sql

# Expected output: Series of ✅ PASS or ❌ FAIL results
# All tests should show ✅ PASS
```

**Expected Results**:
```
TEST 1: Checking table existence
✅ PASS | clients table exists
✅ PASS | portal_user_activity_log exists
✅ PASS | portal_user_sessions exists
✅ PASS | portal_user_permissions exists
✅ PASS | client_usage_stats exists
✅ PASS | process_performance_metrics exists
✅ PASS | bulk_operation_jobs exists
✅ PASS | client_audit_log exists

TEST 2: Clients table structure
✅ PASS | 25 columns found (expected >= 20)

... (more tests)

FINAL SUMMARY:
8 / 8 expected tables created
```

### 2. Backend Service Tests (TypeScript/Jest)

**File**: `backend/tests/client-services.test.ts`

**What it tests**:

**Client Service**:
- ✅ Create client with full details
- ✅ Retrieve client by ID
- ✅ List clients with filters (active_only, search)
- ✅ Update client details
- ✅ Toggle client status
- ✅ Get client statistics
- ✅ Get usage summary

**Portal User Service**:
- ✅ Retrieve enhanced portal user
- ✅ List users with filters
- ✅ Update user (name, phone, designation, access_level)
- ✅ Deactivate user with reason
- ✅ Reactivate user
- ✅ Log user activity (LOGIN, VIEW_REPORT, API_CALL, etc.)
- ✅ Retrieve activity log
- ✅ Filter activity by type
- ✅ Grant permissions (with resource scope)
- ✅ Revoke permissions
- ✅ Get user permissions
- ✅ User activity summary analytics

**Integration Tests**:
- ✅ End-to-end: Create client → Create user → Grant permissions → Log activity
- ✅ Error handling for non-existent entities

**How to run**:
```bash
cd backend

# Run all tests
npm test -- client-services.test.ts

# Run with coverage
npm test -- --coverage client-services.test.ts

# Run specific test suite
npm test -- client-services.test.ts -t "Client CRUD Operations"

# Run in watch mode
npm test -- --watch client-services.test.ts
```

**Expected Results**:
```
PASS  tests/client-services.test.ts
  Phase 1: Client Service Tests
    Client CRUD Operations
      ✓ should create a new client (150ms)
      ✓ should retrieve a client by ID (25ms)
      ✓ should list clients with filters (50ms)
      ✓ should update client details (35ms)
      ✓ should toggle client status (40ms)
      ✓ should search clients by name (45ms)
    Client Analytics
      ✓ should get client statistics (30ms)
      ✓ should get client usage summary (40ms)

  Phase 1: Enhanced Portal User Service Tests
    Portal User Management
      ✓ should retrieve portal user by ID (25ms)
      ✓ should list portal users with filters (35ms)
      ✓ should update portal user details (40ms)
      ✓ should deactivate portal user (35ms)
      ✓ should reactivate portal user (30ms)
    Activity Tracking
      ✓ should log user activity (45ms)
      ✓ should retrieve activity by action type (40ms)
    Permission Management
      ✓ should grant permission to user (50ms)
      ✓ should grant permission with resource scope (45ms)
      ✓ should revoke permission (35ms)
    User Analytics
      ✓ should get user activity summary (55ms)

  Phase 1: Integration Tests
    ✓ should handle client creation and portal user assignment (120ms)

  Phase 1: Error Handling
    ✓ should handle non-existent client gracefully (20ms)
    ✓ should handle non-existent user gracefully (20ms)
    ✓ should handle empty activity log (15ms)

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

## Manual Testing Checklist

### 1. Database Migration Verification

```bash
# Connect to database
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms

# Verify tables
SHOW TABLES LIKE '%client%';
SHOW TABLES LIKE '%portal_user%';
SHOW TABLES LIKE '%bulk%';

# Check clients table structure
DESCRIBE clients;

# Check enhanced portal_users columns
DESCRIBE portal_users;
```

**Expected**:
- 8 new tables visible
- clients table has ~25 columns
- portal_users has new columns: access_level, last_login_at, deactivated_by, etc.

### 2. Service Function Testing (Node REPL)

```bash
cd backend
node --loader ts-node/esm

# In Node REPL:
import { listClients, createClient } from './src/modules/portal/client.service.js';

// Test list clients
const clients = await listClients({ active_only: true });
console.log('Active clients:', clients.length);

// Test create client
const newClient = await createClient({
  client_code: 'DEMO_001',
  client_name: 'Demo Corporation',
  primary_contact_email: 'demo@example.com',
  billing_cycle: 'MONTHLY'
}, 'admin');
console.log('Created client:', newClient);
```

### 3. API Endpoint Testing (Phase 2 - Routes not yet implemented)

After Phase 2 routes are implemented, test with curl:

```bash
# List clients
curl -X GET http://localhost:3001/api/clients \
  -H "Authorization: Bearer <admin-token>"

# Create client
curl -X POST http://localhost:3001/api/clients \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_code": "TEST_001",
    "client_name": "Test Corp",
    "primary_contact_email": "test@corp.com",
    "billing_cycle": "MONTHLY"
  }'

# Get user activity
curl -X GET http://localhost:3001/api/portal-users/<user-id>/activity \
  -H "Authorization: Bearer <admin-token>"
```

## Test Coverage Goals

- **Database Schema**: 100% (all tables, columns, indexes)
- **Service Functions**: 80%+ (critical paths covered)
- **Error Handling**: 100% (null checks, invalid IDs)
- **Integration**: Key workflows (client → user → permissions → activity)

## Known Limitations

1. **Database Not Running Locally**: Tests require remote database connection
2. **Phase 2 Not Complete**: API routes not yet implemented (only services tested)
3. **No Frontend Tests**: UI components not yet built

## Troubleshooting

### Issue: MySQL Connection Error

```
ERROR 2002 (HY000): Can't connect to MySQL server
```

**Solution**: Verify remote database is accessible:
```bash
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk -e "SELECT 1"
```

### Issue: Table Already Exists

```
ERROR 1050 (42S01): Table 'clients' already exists
```

**Solution**: Migration already run. Check table structure:
```sql
DESCRIBE clients;
```

### Issue: Jest Module Not Found

```
Cannot find module 'jest'
```

**Solution**:
```bash
cd backend
npm install --save-dev jest @jest/globals ts-jest @types/jest
```

## Next Steps After Phase 1 Testing

1. ✅ Verify all SQL tests pass
2. ✅ Verify all service tests pass  
3. ✅ Manually test CRUD operations
4. ⏭️ Proceed to **Phase 2**: Backend routes + Frontend UI

## Reporting Issues

If tests fail:

1. **Capture Output**: Save test output to file
   ```bash
   npm test -- client-services.test.ts > test-results.txt 2>&1
   ```

2. **Check Migration**: Ensure SQL migration ran successfully
   ```sql
   SELECT COUNT(*) FROM information_schema.tables 
   WHERE table_schema = 'mas_hrms' 
   AND table_name IN ('clients', 'portal_user_activity_log', 'portal_user_sessions');
   ```

3. **Verify Data**: Check if test data was created/cleaned up
   ```sql
   SELECT * FROM clients WHERE client_code LIKE 'TEST_%';
   ```

4. **Report**: Include error message, stack trace, and environment details

## Success Criteria

Phase 1 is considered **complete and passing** when:

- ✅ All 8 tables created successfully
- ✅ All columns added to existing tables (portal_users, processes)
- ✅ All indexes created
- ✅ SQL test suite shows 100% pass rate
- ✅ Jest test suite shows 24/24 tests passing
- ✅ Manual CRUD operations work correctly
- ✅ No data corruption or foreign key errors
- ✅ Performance acceptable (<100ms for simple queries)
