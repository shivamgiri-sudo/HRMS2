# HRMS Readiness & Verification Engine V1 - Integration Analysis

**Date**: 2026-06-04  
**Package**: hrms-readiness-verification-engine-v1.zip (17KB)  
**Status**: 🆕 **COMPLETELY NEW** - No overlap with existing work

---

## 📦 Package Contents

### What It Does:
**Login-time readiness verification system** that checks if employees/users have completed all required setup:

1. **Profile Completion** - Emergency contact, bank details, personal info
2. **Role & Scope Assignment** - Proper role_key + user_assignment_scope
3. **Document Upload** - Required employee documents
4. **Payroll Setup** - Salary structure, bank account
5. **WFM Readiness** - Week-off preferences, roster assignments
6. **Policy Acknowledgement** - Mandatory policy acceptance
7. **Master Data Health** - System-wide readiness report

### Files (5 total):

#### Backend SQL (1):
```
backend/sql/112_readiness_verification_engine.sql
```

#### Backend TypeScript (2):
```
backend/src/modules/readiness/readiness.service.ts (546 lines)
backend/src/modules/readiness/readiness.routes.ts (86 lines)
```

#### Frontend (2):
```
src/components/readiness/GlobalReadinessPopup.tsx
src/pages/NativeReadinessCenter.tsx (214 lines)
```

---

## 🎯 Features

### 1. Login-Time Popup
- Appears on login if readiness checks fail
- Shows blocking, warning, and info items
- Direct links to fix issues
- Dismissible for non-blocking items

### 2. Readiness Center Page (`/readiness`)
- Personal readiness dashboard
- Category-wise check results
- Action buttons to fix issues
- Progress tracking

### 3. Check Categories (12):
```
- profile (emergency contact, addresses)
- employment (date_of_joining, employment_status)
- role_scope (user_roles, user_assignment_scope)
- documents (required uploads)
- payroll (salary structure, bank account)
- wfm (week-off preferences, roster)
- lms (training completion)
- ats (candidate ownership)
- assets (assigned assets)
- compliance (policy acknowledgements)
- client (client portal access)
- master_data (branch/process/manager assigned)
```

### 4. Severity Levels (3):
```
- blocking: Prevents normal operations (missing emergency contact, no salary)
- warning: Should be fixed soon (missing documents)
- info: Nice to have (profile photo, personal email)
```

### 5. Owner Roles (7):
```
- employee: Self-fixable issues
- hr: HR-fixable (salary assignment)
- admin: Admin-fixable (role assignment)
- wfm: WFM-fixable (roster/week-off)
- finance: Finance-fixable (bank verification)
- manager: Manager-fixable (team assignments)
- trainer: Trainer-fixable (LMS enrollment)
```

### 6. Master Health Dashboard
- System-wide readiness report
- Employees with blocking issues
- Category-wise breakdown
- Owner-wise task queue

---

## 🗄️ Database Schema

### New Tables (6):

#### 1. employee_profile_extra
**Purpose**: Extended profile fields not in main employees table
```sql
- emergency_contact_name/mobile/relation
- current_address, permanent_address
- personal_email
- blood_group, marital_status
- preferred_language
- communication_preference
- profile_verified_by/at
```

#### 2. employee_bank_details
**Purpose**: Bank account for salary processing
```sql
- account_holder_name
- bank_name, account_number, ifsc_code, branch_name
- verification_status (pending/verified/rejected)
- verified_by/at
- rejection_reason
```

#### 3. employee_skill_eligibility
**Purpose**: Process/skill certification tracking
```sql
- process_id
- skill_type (voice/non_voice/chat/email/blended/support/qa/training)
- shift_eligibility (day/night/rotational/flexible)
- certification_status (not_required/pending/certified/failed/expired)
- certification_source, certified_at, expires_at
```

#### 4. readiness_check_master
**Purpose**: Defines all possible readiness checks
```sql
- check_code (unique identifier)
- category (profile/employment/role_scope/documents/payroll/wfm/etc)
- check_title, description
- severity (info/warning/blocking)
- owner_role (employee/hr/admin/wfm/finance/manager/trainer)
- self_fixable (boolean)
- action_route (URL to fix)
```

#### 5. readiness_check_result
**Purpose**: Stores check results per entity (user/employee)
```sql
- check_code (references readiness_check_master)
- entity_type (user/employee/process/branch/client/system)
- entity_id
- status (passed/failed/warning/not_applicable)
- severity, message
- owner_role, action_route
- last_checked_at, resolved_at
- metadata_json (flexible data)
```

#### 6. (Optional) Reuses Existing Tables
- employees (profile data)
- user_roles, user_assignment_scope (role checks)
- employee_documents (document checks)
- employee_salary_assignment (payroll checks)
- week_off_preference, wfm_roster_assignment (WFM checks)

---

## 🔌 API Endpoints

### Personal Readiness
```
GET /api/readiness/me
- Returns logged-in user's readiness status
- Lists all failed/warning/blocking checks
- Provides action routes

POST /api/readiness/check
- Manually trigger readiness re-check
- Returns updated status
```

### Profile Management
```
POST /api/readiness/profile-extra
- Update emergency contact, addresses
- Mark profile_verified if complete

POST /api/readiness/bank-details
- Submit bank account details
- Requires HR/Finance verification

GET /api/readiness/bank-details
- View submitted bank details
- Check verification status
```

### Master Health (Admin/HR/CEO)
```
GET /api/readiness/master-health
- System-wide readiness report
- Count of employees with blocking issues
- Category breakdown
- Owner-wise task queue

GET /api/readiness/employees-not-ready
- List employees with readiness failures
- Filter by severity, category, owner
- Export to CSV
```

### Check Management (Admin)
```
GET /api/readiness/checks
- List all check definitions
- Filter by category, severity

POST /api/readiness/checks/:code/run
- Run specific check for all employees
- Batch update readiness_check_result

POST /api/readiness/checks/run-all
- Run ALL readiness checks
- Use for initial setup or periodic refresh
```

---

## ⚠️ INTEGRATION ISSUES & SOLUTIONS

### Issue 1: Table Compatibility

**employee_bank_details vs existing employee_bank_info?**

**Check**:
```sql
SHOW TABLES LIKE '%bank%';
```

**Solution**:
- If `employee_bank_info` exists: Review schema, may need merge
- If not: Safe to create

---

### Issue 2: employee_profile_extra Overlap

**Emergency contact may exist in employees table?**

**Check**:
```sql
DESCRIBE employees;
-- Look for emergency_contact_name, emergency_contact_mobile
```

**Solution**:
- If columns exist in employees: Update service to use those
- If not: Safe to create employee_profile_extra

---

### Issue 3: Skill Eligibility

**employee_skill_eligibility may overlap with ATS/LMS?**

**Status**: Likely NEW table (specific to readiness checks)

**Solution**: Safe to create (no conflicts expected)

---

### Issue 4: GlobalReadinessPopup Placement

**Where to inject popup?**

**Package says**: Add to App.tsx root
```tsx
<GlobalReadinessPopup />
```

**Solution**: Add inside `<Suspense>` near Routes component

---

### Issue 5: RBAC Page Access

**READINESS_CENTER page code seeding?**

**Check Migration**: Does 112 seed role_page_access?

**Solution**: Add seed if missing:
```sql
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
SELECT UUID(), role_key, 'READINESS_CENTER', 1, 0, 1, 0, 0
FROM workforce_role_catalog
WHERE active_status = 1;
```

---

### Issue 6: Initial Check Population

**readiness_check_master must be seeded!**

**Check Migration**: Does it include INSERT statements for checks?

**Solution**: If missing, need to manually seed ~20-30 standard checks

---

### Issue 7: Performance Impact

**Checking readiness on EVERY login?**

**Concern**: Could slow down login

**Mitigation**:
- Cache results (last_checked_at)
- Only re-check if data changed
- Async background check
- Use indexes on readiness_check_result

---

## 📋 INTEGRATION PLAN

### Pre-Integration Validation (30 min)

**Step 1**: Check for table conflicts
```bash
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms -e "
SHOW TABLES LIKE '%bank%';
SHOW TABLES LIKE '%profile%extra%';
SHOW TABLES LIKE '%readiness%';
DESCRIBE employees;" | grep emergency
```

**Step 2**: Review migration file completely
```bash
cat /tmp/verification-analysis/backend/sql/112_readiness_verification_engine.sql
```

**Step 3**: Check if readiness_check_master is seeded
```bash
grep "INSERT INTO readiness_check_master" /tmp/verification-analysis/backend/sql/112_readiness_verification_engine.sql
```

---

### Integration Phase 1: Database (30 min)

**Step 1**: Backup
```bash
mysqldump -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms > \
  backup_before_readiness_$(date +%Y%m%d_%H%M%S).sql
```

**Step 2**: Apply migration
```bash
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < \
  /tmp/verification-analysis/backend/sql/112_readiness_verification_engine.sql
```

**Step 3**: Verify tables
```bash
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms -e "
SHOW TABLES LIKE '%readiness%';
SHOW TABLES LIKE '%employee_bank%';
SHOW TABLES LIKE '%employee_profile%';
SHOW TABLES LIKE '%skill_eligibility%';
"
```

**Step 4**: Seed READINESS_CENTER page access (if not in migration)
```sql
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), role_key, 'READINESS_CENTER', 1, 0, 1, 0, 0, 1
FROM workforce_role_catalog
WHERE active_status = 1
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view);
```

---

### Integration Phase 2: Backend (30 min)

**Step 1**: Copy readiness module
```bash
mkdir -p backend/src/modules/readiness
cp /tmp/verification-analysis/backend/src/modules/readiness/*.ts \
   backend/src/modules/readiness/
```

**Step 2**: Update app.ts
```typescript
// backend/src/app.ts
import { readinessRouter } from "./modules/readiness/readiness.routes.js";

app.use('/api/readiness', readinessRouter);
```

**Step 3**: TypeCheck
```bash
cd backend && npm run typecheck
```

**Step 4**: Fix import errors (if any)

---

### Integration Phase 3: Frontend (30 min)

**Step 1**: Copy components
```bash
mkdir -p src/components/readiness
cp /tmp/verification-analysis/src/components/readiness/*.tsx \
   src/components/readiness/
```

**Step 2**: Copy page
```bash
cp /tmp/verification-analysis/src/pages/NativeReadinessCenter.tsx \
   src/pages/
```

**Step 3**: Update App.tsx
```tsx
// src/App.tsx
import GlobalReadinessPopup from "./components/readiness/GlobalReadinessPopup";
const NativeReadinessCenter = lazy(() => import("./pages/NativeReadinessCenter"));

// Inside component render:
<GlobalReadinessPopup />

// Inside Routes:
<Route 
  path="/readiness" 
  element={
    <ProtectedRoute>
      <Gate pageCode="READINESS_CENTER">
        <NativeReadinessCenter />
      </Gate>
    </ProtectedRoute>
  } 
/>
```

**Step 4**: Add navigation link
```tsx
// src/components/layout/DashboardLayout.tsx
{
  label: "Readiness Center",
  href: "/readiness",
  icon: <ShieldCheck className="h-4 w-4" />,
  pageCode: "READINESS_CENTER",
  description: "Profile, role, payroll, WFM readiness checks"
}
```

**Step 5**: Build
```bash
npm run build
```

---

### Integration Phase 4: Testing (1 hour)

**Test 1**: Admin runs initial check
```bash
POST /api/readiness/checks/run-all
```

**Test 2**: Employee views readiness
```bash
GET /api/readiness/me
```

**Test 3**: Employee updates profile
```bash
POST /api/readiness/profile-extra
{
  "emergency_contact_name": "John Doe",
  "emergency_contact_mobile": "+91-9876543210",
  "emergency_contact_relation": "Father"
}
```

**Test 4**: Verify popup appears on login

**Test 5**: Admin views master health
```bash
GET /api/readiness/master-health
```

**Test 6**: HR views employees not ready
```bash
GET /api/readiness/employees-not-ready?severity=blocking
```

---

## 🎯 VALUE PROPOSITION

### Benefits:

1. **Employee Onboarding** - Ensures complete profile setup
2. **Payroll Compliance** - Validates bank details before salary run
3. **WFM Readiness** - Confirms week-off preferences submitted
4. **Data Quality** - Flags missing branch/process/manager assignments
5. **HR Efficiency** - Centralized task queue for data fixes
6. **Audit Trail** - Tracks when issues resolved
7. **Self-Service** - Employees fix own issues
8. **Visibility** - Management sees system-wide readiness

### ROI:

- **Reduces payroll errors** (missing bank accounts)
- **Speeds onboarding** (checklist-driven)
- **Improves data quality** (mandatory checks)
- **Reduces HR support tickets** (self-service)

---

## 📊 COMPLEXITY ASSESSMENT

| Aspect | Rating | Notes |
|--------|--------|-------|
| Database Schema | 🟡 MEDIUM | 6 new tables, check for conflicts |
| Backend Logic | 🟢 LOW | Well-structured service (546 lines) |
| Frontend UI | 🟢 LOW | 2 components (214 lines) |
| Integration Effort | 🟡 MEDIUM | ~2 hours total |
| Testing Effort | 🟡 MEDIUM | 1 hour (6 test scenarios) |
| Value | 🟢 HIGH | Production-critical feature |
| Risk | 🟡 MEDIUM | Login performance impact |

---

## ✅ INTEGRATION CHECKLIST

- [ ] Validate no table conflicts
- [ ] Review emergency_contact columns in employees table
- [ ] Check if readiness_check_master is seeded
- [ ] Backup database
- [ ] Apply migration 112
- [ ] Verify 6 tables created
- [ ] Seed READINESS_CENTER page access
- [ ] Copy readiness backend module
- [ ] Update app.ts (mount route)
- [ ] Copy readiness frontend components
- [ ] Update App.tsx (popup + route)
- [ ] Add navigation link
- [ ] Run backend typecheck
- [ ] Run frontend build
- [ ] Run initial check (run-all)
- [ ] Test employee readiness view
- [ ] Test profile update
- [ ] Test login popup
- [ ] Test master health (admin)
- [ ] Test employees-not-ready (HR)

---

## 🚀 FINAL RECOMMENDATION

**INTEGRATE**: YES - High value, manageable complexity

**Priority**: MEDIUM-HIGH  
- Not blocking current work
- Valuable for production operations
- Should be integrated before go-live

**Timing**: After completing Control Tower + Phase 3.2 (DONE today)

**Effort**: 2-3 hours (validation + integration + testing)

**Risk**: MEDIUM  
- Login performance concern (mitigate with caching)
- Table conflicts possible (validate first)

**Value**: HIGH  
- Production-critical for data quality
- Reduces HR support burden
- Improves employee experience

---

## 📅 INTEGRATION TIMING

**Option A**: Integrate now (2-3 hours)  
- Momentum from today's integrations
- Fresh context on scope/RBAC

**Option B**: After Phase 6 (WFM & Roster)  
- Complete module-by-module scope rollout first
- Then add readiness system

**Recommendation**: **Option B** - After Phase 6  
- Don't interrupt scope governance rollout
- Readiness system touches ALL modules (better to have scope complete first)
- Can validate role/scope readiness checks properly

Ready to proceed with integration OR defer to Phase 6?
