# Role Scope Governance V1 - Integration Analysis & Plan

## Project Overview

**What It Does**: Adds backend scope enforcement for ALL roles using existing `user_assignment_scope` table
- Prevents branch-specific role proliferation (no `wfm_noida`, `qa_ahmedabad`)
- Reusable scope middleware for all modules
- Enforces scope at API level (not just frontend)
- Supports 8 scope types: all, branch, process, branch_process, lob, department, team, self

**Smart Design**: Uses EXISTING `user_assignment_scope` table - no new tables needed!

---

## Files to Integrate

### Backend (3 files):
1. `backend/src/shared/scopeAccess.ts` - Core scope logic (291 lines)
2. `backend/src/middleware/scopeMiddleware.ts` - Express middleware (44 lines)
3. `backend/sql/053_role_scope_governance.sql` - Role catalog + page access seeds

### Documentation (2 files):
4. `docs/ROLE_SCOPE_MODEL_FOR_ALL_ROLES.md` - Governance model
5. `docs/SCOPE_TEST_MATRIX.md` - Test scenarios

### Patches (1 file):
6. `patches/ROLE_SCOPE_WFM_ROSTER_PATCH.diff` - Example WFM roster implementation

---

## ⚠️ POTENTIAL INTEGRATION PROBLEMS & SOLUTIONS

### 1. Table Structure Validation

**Problem**: Package expects `user_assignment_scope` table exists with specific columns

**Validation Required**:
```sql
-- Check if table exists
SHOW TABLES LIKE 'user_assignment_scope';

-- Verify columns
DESCRIBE user_assignment_scope;
```

**Expected Columns**:
- `id`, `user_id`, `role_key`
- `scope_type` (enum or varchar)
- `branch_id`, `process_id`, `lob_id`, `department_id`, `manager_employee_id`
- `active_status`, `created_at`, `updated_at`

**Solution**:
- ✅ If table exists with correct columns: Proceed
- ❌ If missing: Create table first
- ⚠️ If columns mismatch: Alter table or update scopeAccess.ts

**Action**: I'll check current schema first

---

### 2. Role Catalog Table

**Problem**: Migration inserts into `workforce_role_catalog` table

**Check**:
```sql
SHOW TABLES LIKE '%role%catalog%';
```

**Solution**:
- ✅ If table exists: Proceed
- ❌ If missing: Table might be named `roles` or `role_master`
- ⚠️ Update migration SQL to match actual table name

---

### 3. Import Path Issues

**Problem**: Files import from relative paths that may not match project structure

**scopeAccess.ts imports**:
```typescript
import { db } from "../db/mysql.js";
```

**scopeMiddleware.ts imports**:
```typescript
import type { AuthenticatedRequest } from "./authMiddleware.js";
import { hasScopedAccess, type ScopeTarget } from "../shared/scopeAccess.js";
```

**Expected Paths**:
- `backend/src/db/mysql.ts` - Database connection
- `backend/src/middleware/authMiddleware.ts` - Auth middleware with `AuthenticatedRequest` type

**Solution**:
- ✅ Verify paths match
- ⚠️ Adjust import paths if different

---

### 4. AuthMiddleware Type Compatibility

**Problem**: `scopeMiddleware.ts` expects `AuthenticatedRequest` type from authMiddleware

**Required Type**:
```typescript
export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
    // ... other fields
  };
}
```

**Solution**:
- ✅ If type exists: Verify it has `authUser.id`
- ❌ If missing: Add to authMiddleware.ts
- ⚠️ If named differently: Update import

---

### 5. Role Key Consistency

**Problem**: Scope system uses specific role keys that must match `user_roles` table

**Expected Role Keys**:
```
admin, ceo, hr, wfm, process_manager, branch_head, team_leader,
manager, qa, recruiter, trainer, finance, payroll, employee
```

**Current HRMS Roles** (from earlier work):
```
admin, hr, ceo, branch_head, process_manager, manager,
wfm, finance, payroll, qa, recruiter, trainer, tl, employee
```

**Mismatch**:
- ⚠️ `tl` vs `team_leader`

**Solution**: Either:
1. Update migration to use `tl` instead of `team_leader`
2. Create alias in `workforce_role_catalog`
3. Standardize on `team_leader` and update existing data

---

### 6. Existing API Route Protection

**Problem**: Need to add scope guards to existing routes without breaking them

**Pattern from patch**:
```typescript
// BEFORE (role-only)
router.post("/plans", requireRole("admin", "wfm"), handler);

// AFTER (role + scope)
router.post("/plans", 
  requireRole("admin", "wfm"),
  requireScopedRole(["wfm"], getTargetFromBodyOrQuery),
  handler
);
```

**Modules to Update** (from earlier audit):
1. ✅ ATS (`backend/src/modules/ats/ats.routes.ts`)
2. ✅ Employees (`backend/src/modules/employees/employee.routes.ts`)
3. ✅ Payroll (`backend/src/modules/payroll/payroll.routes.ts`)
4. ✅ WFM (`backend/src/modules/wfm/wfm.routes.ts`)
5. ✅ Roster (`backend/src/modules/wfm/roster.routes.ts`)
6. ✅ KPI (`backend/src/modules/kpi/kpi.routes.ts`)
7. ✅ Management (`backend/src/modules/management/management.routes.ts`)
8. ⏭️ Auto-Roster (just integrated - needs update)

**Risk**: High - 68+ routes to update

**Solution**: Phased rollout:
- Phase 1: Add middleware to critical write operations
- Phase 2: Add to list/read operations
- Phase 3: Test each module independently

---

### 7. List Query Modifications

**Problem**: List APIs need scope filtering in SQL WHERE clause

**Pattern**:
```typescript
// BEFORE
const [rows] = await db.execute(
  'SELECT * FROM wfm_roster_plan WHERE active_status = 1',
  []
);

// AFTER
const scoped = await buildScopeWhereClause(
  req.authUser!.id,
  ["wfm", "process_manager"],
  { branchId: "rp.branch_id", processId: "rp.process_id" },
  { allowCeoAllRead: true }
);

const [rows] = await db.execute(
  `SELECT * FROM wfm_roster_plan rp 
   WHERE active_status = 1 AND (${scoped.sql})`,
  [...scoped.params]
);
```

**Effort**: ~5-10 minutes per list endpoint  
**Total**: 30-40 list endpoints across all modules  
**Time**: 3-5 hours

---

### 8. Post-Publish Roster Change Governance

**Problem**: System says "WFM can generate, PM can change post-publish" but this needs enforcement

**Current Auto-Roster Implementation**:
```typescript
// In auto-roster-synced.routes.ts
router.patch("/assignments/:id/published-change", requireRole("admin"), handler);
```

**Required Fix**:
```typescript
router.patch("/assignments/:id/published-change", 
  requireRole("admin", "process_manager"),
  requireScopedRole(
    ["process_manager"], 
    (req) => ({
      processId: req.body.process_id,
      branchId: req.body.branch_id
    })
  ),
  handler
);
```

**Validation in Handler**:
```typescript
// Must check assignment is published
// Must require change_reason
// Must recalculate coverage
// Must create event log
// Must queue notification
```

---

### 9. Admin Bypass Policy

**Problem**: Package allows admin bypass by default but this may conflict with audit requirements

**Default Behavior**:
```typescript
hasScopedAccess(userId, roles, target, { allowAdminBypass: true })
```

**Risk**: Admin can bypass all scope checks

**Options**:
1. Keep default (admin emergency access)
2. Disable for sensitive operations (payroll, compliance)
3. Log all admin bypass actions

**Recommendation**: Keep enabled but add audit logging

---

### 10. CEO Read-Only Access

**Problem**: CEO should see all data read-only but not edit

**Implementation**:
```typescript
// List endpoints
const scoped = await buildScopeWhereClause(
  userId, 
  ["wfm", "process_manager"], 
  aliases,
  { allowCeoAllRead: true } // ✅ CEO sees all
);

// Write endpoints
router.post("/plans",
  requireRole("admin", "wfm"), // ❌ CEO not allowed
  requireScopedRole(["wfm"], target),
  handler
);
```

**Validation**: CEO can view but cannot create/edit/delete

---

## 📋 INTEGRATION CHECKLIST

### Phase 1: Pre-flight Validation ✓
- [ ] Verify `user_assignment_scope` table exists
- [ ] Verify `workforce_role_catalog` table (or equivalent)
- [ ] Check `role_key` consistency (tl vs team_leader)
- [ ] Verify `AuthenticatedRequest` type exists
- [ ] Check database connection path (`db/mysql.ts`)

### Phase 2: Core Files Integration ✓
- [ ] Copy `scopeAccess.ts` to `backend/src/shared/`
- [ ] Copy `scopeMiddleware.ts` to `backend/src/middleware/`
- [ ] Fix import paths (if needed)
- [ ] Run `npm run typecheck` (backend)
- [ ] Fix TypeScript errors

### Phase 3: Database Migration ✓
- [ ] Review `053_role_scope_governance.sql`
- [ ] Update table names if needed
- [ ] Update role keys if needed (tl → team_leader)
- [ ] Backup database
- [ ] Run migration
- [ ] Verify seeds inserted

### Phase 4: Module-by-Module Rollout ✓

#### 4.1 Auto-Roster (Priority: HIGH)
- [ ] Update auto-roster routes with scope guards
- [ ] Fix post-publish change to require process_manager
- [ ] Update list APIs with `buildScopeWhereClause`
- [ ] Test WFM scoped by branch/process
- [ ] Test PM approval flow

#### 4.2 WFM & Roster (Priority: HIGH)
- [ ] Add scope to attendance APIs
- [ ] Add scope to shift management
- [ ] Add scope to regularization approval
- [ ] Test branch-scoped WFM

#### 4.3 ATS (Priority: HIGH)
- [ ] Add scope to candidate list
- [ ] Add scope to interview scheduling
- [ ] Add scope to stage movement
- [ ] Test recruiter scoped by branch/process

#### 4.4 Employees (Priority: CRITICAL)
- [ ] Add scope to employee list
- [ ] Add scope to employee update
- [ ] Add scope to salary operations
- [ ] Test manager can only view team

#### 4.5 Payroll (Priority: CRITICAL)
- [ ] Add scope to payroll runs
- [ ] Add scope to salary structure assignment
- [ ] Test branch/department scoping

#### 4.6 KPI & Management (Priority: HIGH)
- [ ] Add scope to KPI dashboards
- [ ] Add scope to coaching creation
- [ ] Test QA process-scoped access

#### 4.7 LMS Integration (Priority: MEDIUM)
- [ ] Add scope to learner mappings
- [ ] Test trainer branch/process scope

### Phase 5: Testing ✓
- [ ] Create test users with different scopes
- [ ] Run scope test matrix (21 scenarios)
- [ ] Test admin bypass
- [ ] Test CEO read-only
- [ ] Test employee self-only
- [ ] Verify 403 responses for out-of-scope

### Phase 6: Documentation ✓
- [ ] Document scope types
- [ ] Create admin guide for assigning scopes
- [ ] Update API documentation
- [ ] Add troubleshooting guide

---

## RECOMMENDED INTEGRATION STEPS

### Step 1: Validate Current State
```bash
# Check user_assignment_scope table
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms -e "DESCRIBE user_assignment_scope;"

# Check role catalog
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms -e "SHOW TABLES LIKE '%role%catalog%';"

# Check existing roles
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms -e "SELECT DISTINCT role_key FROM user_roles;"
```

### Step 2: Copy Core Files
```bash
# Backend shared
mkdir -p backend/src/shared
cp /tmp/role-scope-analysis/backend/src/shared/scopeAccess.ts backend/src/shared/

# Middleware
cp /tmp/role-scope-analysis/backend/src/middleware/scopeMiddleware.ts backend/src/middleware/
```

### Step 3: Fix Import Paths (if needed)
```typescript
// Verify these paths exist:
import { db } from "../db/mysql.js";  // Should point to actual DB file
import type { AuthenticatedRequest } from "./authMiddleware.js";  // Should exist
```

### Step 4: Apply Migration
```bash
# Backup first
mysqldump -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms > backup_before_scope_$(date +%Y%m%d_%H%M%S).sql

# Apply migration (may need edits)
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < /tmp/role-scope-analysis/backend/sql/053_role_scope_governance.sql
```

### Step 5: Update Auto-Roster Routes (Example)
```typescript
// backend/src/modules/wfm/auto-roster-synced.routes.ts
import { requireScopedRole, getTargetFromBodyOrQuery } from "../../middleware/scopeMiddleware.js";

// POST /plans - WFM creates roster
router.post("/plans",
  requireAuth,
  requireRole("admin", "wfm"),
  requireScopedRole(["wfm"], getTargetFromBodyOrQuery),
  h(createPlan)
);

// GET /plans - List scoped to user's branch/process
router.get("/plans",
  requireAuth,
  requireRole("admin", "wfm", "process_manager", "branch_head", "ceo"),
  h(async (req, res) => {
    const scoped = await buildScopeWhereClause(
      req.authUser!.id,
      ["wfm", "process_manager", "branch_head"],
      { branchId: "rp.branch_id", processId: "rp.process_id" },
      { allowCeoAllRead: true }
    );
    
    const [rows] = await db.execute(
      `SELECT * FROM wfm_roster_plan rp WHERE active_status = 1 AND (${scoped.sql})`,
      [...scoped.params]
    );
    
    return res.json({ success: true, data: rows });
  })
);

// PATCH /assignments/:id/published-change - PM only
router.patch("/assignments/:id/published-change",
  requireAuth,
  requireRole("admin", "process_manager"),
  requireScopedRole(["process_manager"], async (req) => {
    // Resolve target from assignment record
    const [rows] = await db.execute(
      'SELECT process_id, branch_id FROM wfm_roster_assignment WHERE id = ?',
      [req.params.id]
    );
    const row = rows[0];
    return { processId: row.process_id, branchId: row.branch_id };
  }),
  h(updatePublishedAssignment)
);
```

### Step 6: Test TypeScript
```bash
cd backend
npm run typecheck
```

### Step 7: Create Test Users
```sql
-- WFM Noida (branch-scoped)
INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, branch_id)
VALUES (UUID(), '<wfm_user_id>', 'wfm', 'branch', '<noida_branch_id>');

-- PM Finnable (process-scoped)
INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, process_id)
VALUES (UUID(), '<pm_user_id>', 'process_manager', 'process', '<finnable_process_id>');

-- WFM Corporate (all-scoped)
INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type)
VALUES (UUID(), '<corp_wfm_user_id>', 'wfm', 'all');

-- QA Bellavita (process-scoped)
INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, process_id)
VALUES (UUID(), '<qa_user_id>', 'qa', 'process', '<bellavita_process_id>');
```

### Step 8: Run Scope Test Matrix
```bash
# Test 1: WFM Noida sees only Noida data
# Login as WFM Noida
# GET /api/wfm/auto-roster/plans
# Should only see Noida branch plans

# Test 2: WFM Noida cannot access Ahmedabad
# Login as WFM Noida
# POST /api/wfm/auto-roster/plans with branch_id=Ahmedabad
# Should return 403

# ... (21 total tests from SCOPE_TEST_MATRIX.md)
```

### Step 9: Rollout to Other Modules
Repeat Step 5 for:
1. ATS routes
2. Employee routes
3. Payroll routes
4. KPI routes
5. Management routes
6. LMS routes

---

## QUESTIONS FOR YOU

Before I proceed with integration:

1. **user_assignment_scope table**: Does it exist? Should I verify schema first?

2. **Role key mismatch**: `tl` vs `team_leader` - which should we use?

3. **Rollout strategy**: Which order do you prefer?
   - A) Start with Auto-Roster (just integrated)
   - B) Start with Employees (most critical)
   - C) Start with WFM (highest volume)

4. **Admin bypass**: Should admin bypass scope for all operations or only specific ones?

5. **Testing approach**: Create test users now or after Phase 2?

6. **Migration table name**: Is the role catalog table named `workforce_role_catalog` or something else (`roles`, `role_master`)?

7. **Phased vs Full**: Apply to all modules at once or one at a time with testing?

8. **Breaking changes**: This will return 403 for users without proper scope assignments. Should we:
   - A) Seed default "all" scope for existing users
   - B) Require explicit scope assignment
   - C) Grace period with warnings before enforcement

---

## FINAL RECOMMENDATION

**SAFE INTEGRATION PATH**:
1. ✅ Validate current schema (user_assignment_scope)
2. ✅ Copy scopeAccess.ts + scopeMiddleware.ts
3. ✅ Fix any import path issues
4. ✅ Apply migration (after reviewing table names)
5. ✅ Update Auto-Roster routes (just integrated)
6. ✅ Test Auto-Roster with scope guards
7. ⏭️ Rollout to Employees module next (most critical)
8. ⏭️ Then WFM, ATS, Payroll, KPI, Management
9. ⏭️ Create test matrix results document

**RISK LEVEL**: 🟨 MEDIUM-HIGH
- High impact: Changes 68+ API routes
- Medium risk: Might break existing user workflows if scopes not assigned
- Low risk: Files are well-structured, no new tables

**TIME ESTIMATE**: 
- Phase 1-3: 30 minutes (validation + file copy + migration)
- Phase 4: 4-6 hours (module-by-module rollout)
- Phase 5: 2-3 hours (comprehensive testing)
- **Total**: 7-10 hours

**RECOMMENDATION**: Start with validation phase now, then decide on rollout strategy based on findings.

Ready to proceed when you confirm!
