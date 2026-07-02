# Auto Roster Synced V2 - Integration Analysis & Plan

## Project Overview

**What It Does**: Automated roster generation system that:
- Creates slot-based capacity requirements
- Auto-generates roster assignments
- PM approval workflow
- Coverage matrix & conflict detection
- Post-publish change tracking with audit
- Employee acknowledgement system

**Smart Design**: Reuses existing HRMS tables instead of duplicating

---

## Files to Integrate

### Backend (3 files):
1. `backend/sql/052_wfm_auto_roster_synced.sql` - Database schema
2. `backend/src/modules/wfm/auto-roster-synced.service.ts` - Business logic
3. `backend/src/modules/wfm/auto-roster-synced.routes.ts` - API endpoints

### Frontend (1 file):
4. `src/pages/NativeWFMAutoRoster.tsx` - Complete UI

### Scripts (1 file):
5. `scripts/wfm_auto_roster_preflight.sql` - Pre-flight checks

### Patches (1 file):
6. `patches/AUTO_ROSTER_SYNCED_PROJECT_PATCH.diff` - Integration changes

---

## ⚠️ POTENTIAL INTEGRATION PROBLEMS & SOLUTIONS

### 1. Table Name Conflicts

**Problem**: Existing HRMS may have different table names or structures
```sql
-- Auto-roster expects:
wfm_roster_plan
wfm_roster_assignment
wfm_shift
roster_template
```

**Validation Required**:
```bash
# Run preflight check FIRST
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < /tmp/roster-analysis/scripts/wfm_auto_roster_preflight.sql
```

**Solution**:
- ✅ Review preflight output
- ✅ Verify existing table schemas match expected structure
- ❌ If mismatch: Need to create table aliases or update service queries

**Action**: I'll check existing roster tables first

---

### 2. Foreign Key Constraints

**Problem**: New tables reference existing tables that may not have proper indexes or may have been modified

**Expected References**:
```sql
wfm_client_slot_requirement → process_master, branch_master
wfm_roster_plan_control → wfm_roster_plan
wfm_roster_assignment_control → wfm_roster_assignment
```

**Solution**:
- ✅ Add missing indexes if needed
- ✅ Verify referenced tables exist
- ✅ Check column types match

**Action**: Pre-flight script should catch this

---

### 3. Role Name Conflicts

**Problem**: System expects specific roles that may not exist or have different names

**Expected Roles**:
```
- wfm (for roster creation)
- process_manager (for approval)
- admin (full access)
- employee (acknowledgement)
```

**Current HRMS Roles** (from our earlier work):
```
admin, hr, ceo, branch_head, process_manager, manager,
wfm, finance, payroll, qa, recruiter, trainer, tl, employee
```

**Validation**:
✅ `wfm` exists
✅ `process_manager` exists  
✅ `admin` exists
✅ `employee` exists

**Solution**: ✅ NO ISSUE - All required roles exist!

---

### 4. Route Conflicts

**Problem**: New routes may conflict with existing WFM routes

**New Routes Mount**:
```
/api/wfm/auto-roster/*
```

**Existing WFM Routes** (from app.ts):
```
/api/wfm/* (existing wfmRouter)
/api/wfm/roster (existing rosterRouter)
/api/wfm/attendance (attendanceEngineRouter)
```

**Conflict Check**:
```typescript
// app.ts currently has:
app.use("/api/wfm", wfmRouter);
app.use("/api/wfm/roster", rosterRouter); // <-- CONFLICT?
```

**Solution**:
❌ **CRITICAL**: `/api/wfm/auto-roster` will conflict with `/api/wfm/roster`

**Fix**: Mount auto-roster BEFORE roster to ensure specificity:
```typescript
app.use("/api/wfm/auto-roster", autoRosterSyncedRouter); // More specific first
app.use("/api/wfm/roster", rosterRouter); // Less specific after
app.use("/api/wfm", wfmRouter); // Least specific last
```

---

### 5. Frontend Route Conflicts

**Problem**: New page may conflict with existing roster pages

**New Route**:
```
/wfm/auto-roster
```

**Existing Routes** (check App.tsx):
- Need to verify no existing `/wfm/auto-roster` route

**Solution**: ✅ Should be safe - specific route name

---

### 6. PageCode RBAC Integration

**Problem**: New page uses `pageCode="WFM_AUTO_ROSTER"` which doesn't exist in `role_page_access` table

**Solution**: After migration, seed the page access:
```sql
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('admin', 'WFM_AUTO_ROSTER', 1, 1, 1, 1, 1),
  ('wfm', 'WFM_AUTO_ROSTER', 1, 1, 1, 0, 1),
  ('process_manager', 'WFM_AUTO_ROSTER', 1, 0, 1, 0, 1),
  ('manager', 'WFM_AUTO_ROSTER', 1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE can_view=VALUES(can_view);
```

---

### 7. Database Migration Order

**Problem**: Migration creates 10 new tables with foreign keys

**Risk**: If tables created in wrong order, FKs will fail

**Solution**: Migration file likely already has correct order, but verify:
1. First: Tables with no dependencies
2. Then: Tables with foreign keys

**Action**: Review `052_wfm_auto_roster_synced.sql` structure

---

### 8. Notification Integration

**Problem**: System queues notifications but doesn't send them

**From README**:
> "This package queues locked notifications in wfm_roster_notification_log. It does not send emails directly yet"

**Existing Communication System** (from our HRMS):
```
/api/communication/dispatch
communication_templates table
email/SMS providers configured
```

**Solution - 3 Options**:

**Option A**: Manual worker (RECOMMENDED):
```typescript
// backend/src/workers/roster-notification-worker.ts
import { communicationService } from '../modules/communication/communication.service';

async function processRosterNotifications() {
  const [pending] = await db.execute(
    'SELECT * FROM wfm_roster_notification_log WHERE status = "pending" LIMIT 100'
  );

  for (const notification of pending) {
    await communicationService.sendEmail({
      to: notification.employee_email,
      subject: notification.subject,
      body: notification.message_body,
      template_key: 'ROSTER_NOTIFICATION'
    });

    await db.execute(
      'UPDATE wfm_roster_notification_log SET status = "sent" WHERE id = ?',
      [notification.id]
    );
  }
}

setInterval(processRosterNotifications, 60000); // Every minute
```

**Option B**: Trigger on insert (DATABASE):
```sql
DELIMITER $$
CREATE TRIGGER after_roster_notification_insert
AFTER INSERT ON wfm_roster_notification_log
FOR EACH ROW
BEGIN
  -- Insert into communication queue
  INSERT INTO communication_dispatch_queue (type, recipient, subject, body, created_at)
  VALUES ('EMAIL', NEW.employee_email, NEW.subject, NEW.message_body, NOW());
END$$
DELIMITER ;
```

**Option C**: API endpoint for batch processing:
```typescript
// POST /api/wfm/auto-roster/notifications/process
// Manually trigger notification processing
```

**Recommendation**: Option A (worker) is cleanest and non-invasive

---

### 9. TypeScript Import Issues

**Problem**: Auto-roster service may have import path issues

**Example**:
```typescript
// If auto-roster-synced.service.ts has:
import { db } from '../../db/mysql.js';

// But actual path is:
import { db } from '../../db/mysql.js'; // May need adjustment
```

**Solution**:
- ✅ Run `npm run typecheck` after copying files
- ✅ Fix any import path errors
- ✅ Verify `@/` alias paths work

---

### 10. Demo Credentials Conflict

**Problem**: Patch updates `src/lib/demoCreds.ts` which may not exist or have different structure

**Solution**:
- Check if `demoCreds.ts` exists
- Review patch before applying
- May need to manually integrate changes

---

## 📋 INTEGRATION CHECKLIST

### Phase 1: Pre-flight Validation ✓
- [ ] Run preflight SQL script
- [ ] Verify existing roster tables exist and match schema
- [ ] Check role_page_access table exists
- [ ] Verify communication module exists
- [ ] Check for route conflicts in app.ts

### Phase 2: Database Migration ✓
- [ ] Backup database
- [ ] Run `052_wfm_auto_roster_synced.sql`
- [ ] Verify 10 new tables created
- [ ] Seed WFM_AUTO_ROSTER page access
- [ ] Check foreign key constraints

### Phase 3: Backend Integration ✓
- [ ] Copy `auto-roster-synced.service.ts`
- [ ] Copy `auto-roster-synced.routes.ts`
- [ ] Update `app.ts` (mount route correctly)
- [ ] Run `npm run typecheck`
- [ ] Run `npm run build`
- [ ] Fix any import errors

### Phase 4: Frontend Integration ✓
- [ ] Copy `NativeWFMAutoRoster.tsx`
- [ ] Update `App.tsx` (add route)
- [ ] Update `DashboardLayout.tsx` (add nav link)
- [ ] Run `npm run build`
- [ ] Fix any TypeScript errors

### Phase 5: Testing ✓
- [ ] Start backend: `npm run dev`
- [ ] Start frontend: `npm run dev`
- [ ] Test as WFM user:
  - [ ] Create slot requirement
  - [ ] Create roster plan
  - [ ] Generate draft
  - [ ] Submit to PM
- [ ] Test as Process Manager:
  - [ ] View submitted plan
  - [ ] Approve plan
  - [ ] Publish roster
  - [ ] Make post-publish change
- [ ] Test as Employee:
  - [ ] View my roster
  - [ ] Acknowledge roster

### Phase 6: Notification Worker (Optional) ✓
- [ ] Create notification worker
- [ ] Test email sending
- [ ] Set up cron/scheduler

---

## RECOMMENDED INTEGRATION STEPS

### Step 1: Analyze Current State
```bash
# Check existing roster tables
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms -e "SHOW TABLES LIKE '%roster%';"

# Run preflight
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < /tmp/roster-analysis/scripts/wfm_auto_roster_preflight.sql
```

### Step 2: Review Patch File
```bash
cat /tmp/roster-analysis/patches/AUTO_ROSTER_SYNCED_PROJECT_PATCH.diff
```

### Step 3: Backup Database
```bash
mysqldump -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms > hrms_backup_before_roster.sql
```

### Step 4: Apply Migration
```bash
mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < /tmp/roster-analysis/backend/sql/052_wfm_auto_roster_synced.sql
```

### Step 5: Seed Page Access
```bash
# Create SQL file
cat > /tmp/seed_roster_access.sql <<'EOF'
USE mas_hrms;
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('admin', 'WFM_AUTO_ROSTER', 1, 1, 1, 1, 1),
  ('wfm', 'WFM_AUTO_ROSTER', 1, 1, 1, 0, 1),
  ('process_manager', 'WFM_AUTO_ROSTER', 1, 0, 1, 0, 1),
  ('manager', 'WFM_AUTO_ROSTER', 1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE can_view=VALUES(can_view);
EOF

mysql -h 122.184.128.90 -u shivam_user -pqwersdfg!@#hjk mas_hrms < /tmp/seed_roster_access.sql
```

### Step 6: Copy Files
```bash
# Backend
cp /tmp/roster-analysis/backend/src/modules/wfm/auto-roster-synced.service.ts backend/src/modules/wfm/
cp /tmp/roster-analysis/backend/src/modules/wfm/auto-roster-synced.routes.ts backend/src/modules/wfm/

# Frontend
cp /tmp/roster-analysis/src/pages/NativeWFMAutoRoster.tsx src/pages/

# Scripts
mkdir -p scripts
cp /tmp/roster-analysis/scripts/wfm_auto_roster_preflight.sql scripts/
```

### Step 7: Update app.ts (MANUALLY - avoid patch conflicts)
```typescript
// Add import
import { autoRosterSyncedRouter } from "./modules/wfm/auto-roster-synced.routes.js";

// Mount route BEFORE other WFM routes
app.use("/api/wfm/auto-roster", autoRosterSyncedRouter); // Most specific first
app.use("/api/wfm/roster", rosterRouter);
app.use("/api/wfm", wfmRouter); // Least specific last
```

### Step 8: Update App.tsx (MANUALLY)
```typescript
// Add import
const NativeWFMAutoRoster = lazy(() => import("./pages/NativeWFMAutoRoster"));

// Add route
<Route
  path="/wfm/auto-roster"
  element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWFMAutoRoster /></Gate></ProtectedRoute>}
/>
```

### Step 9: Add Navigation Link (DashboardLayout.tsx)
```typescript
{
  label: "Auto Roster",
  href: "/wfm/auto-roster",
  icon: <Calendar className="h-4 w-4" />,
  pageCode: "WFM_AUTO_ROSTER",
  description: "Automated roster generation and management"
}
```

### Step 10: Test
```bash
cd backend && npm run typecheck && npm run dev
npm run dev
```

---

## QUESTIONS FOR YOU

Before I proceed with integration:

1. **Preflight Check**: Should I run the preflight script first to verify existing table structure?

2. **Route Conflict**: Confirmed there's a potential conflict. Should I update route mounting order?

3. **Notification Worker**: Which approach do you prefer?
   - A) Separate worker process
   - B) Database trigger
   - C) Manual API endpoint

4. **Page Access**: Should I automatically seed `WFM_AUTO_ROSTER` to role_page_access table?

5. **Navigation**: Where in the sidebar should "Auto Roster" link appear?
   - Under "Workforce OS" section?
   - Under "Time" section?
   - New "WFM" section?

6. **Testing Users**: Do you have test users with `wfm` and `process_manager` roles ready?

7. **Backup**: Should I create a database backup before running migration?

8. **Patch File**: Should I apply the patch automatically or manually integrate changes?

---

## FINAL RECOMMENDATION

**SAFE INTEGRATION PATH**:
1. ✅ Run preflight check
2. ✅ Create database backup
3. ✅ Review existing roster table schema
4. ✅ Apply migration
5. ✅ Seed page access
6. ✅ Copy files (don't apply patch - manual integration safer)
7. ✅ Update routes manually
8. ✅ Test thoroughly
9. ⏭️ Add notification worker (Phase 2)

**RISK LEVEL**: 🟨 MEDIUM
- Low risk: Database (uses existing tables)
- Medium risk: Routes (potential conflicts - need correct order)
- Low risk: Frontend (new page, no conflicts)

**TIME ESTIMATE**: 2-3 hours including testing

Ready to proceed when you confirm!
