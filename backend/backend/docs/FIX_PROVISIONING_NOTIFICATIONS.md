# Fix: Missing IT Provisioning Tasks and Payroll HR Notifications

## Problem Statement

After generating an employee code during the offer approval flow, two critical workflows were not triggering:

1. **IT Provisioning Tasks** - IT/Admin/WFM/HR departments were not receiving task assignments for new joiners
2. **Payroll HR Notifications** - Payroll HR was not being notified about joining document formalities

## Root Cause

The code for both features existed and was being called, but **dynamic imports were failing silently**:

```typescript
// Old code (FAILING)
import('../it-provisioning/it-provisioning.service.js').then(({ dispatchJoinProvisioningTasks }) => {
  dispatchJoinProvisioningTasks(...).catch(err => console.error(err));
}).catch(err => console.error(err)); // Import failure caught here
```

The `.js` extension in the dynamic import path was not resolving correctly at runtime, causing the import to fail. The error was logged as a warning but didn't block the main flow, so these tasks were silently skipped.

## Solution Implemented

### 1. Replaced Dynamic Imports with Static Imports

**File:** `backend/src/modules/ats/ats.onboarding.service.ts`

**Changes:**
- Added static imports at the top of the file:
  ```typescript
  import { dispatchJoinProvisioningTasks } from '../it-provisioning/it-provisioning.service.js';
  import { sendPayrollHrJoiningDocNotification } from './ats.email.service.js';
  ```

- Replaced dynamic `import()` calls with direct function calls wrapped in try-catch blocks
- Changed from fire-and-forget `.then().catch()` to proper `await` with error handling
- Added detailed logging to track success and failures

### 2. Enhanced Logging Throughout the Flow

**Files Modified:**
- `backend/src/modules/ats/ats.onboarding.service.ts` (lines 783-836)
- `backend/src/modules/it-provisioning/it-provisioning.service.ts` (dispatchJoinProvisioningTasks, dispatchNotifications)

**Logging Added:**
- ✅ Start of provisioning dispatch with employee details
- ✅ User resolution results for each role (IT, Admin, WFM, HR)
- ✅ Warning when no users found for a role
- ✅ Confirmation when provisioning request created
- ✅ Confirmation when inbox item created
- ✅ Confirmation when email sent
- ✅ Success summary at the end
- ❌ Detailed error messages with stack traces when failures occur

### 3. Added Safety Checks

**User Resolution:**
- Now logs a warning and continues if no users are found for a role
- Doesn't fail the entire flow if one role has no assigned users

**Payroll HR Notification:**
- Warns if no payroll_hr users are found
- Shows count of users notified on success

## What Gets Created After Offer Approval

When a Branch Head approves an employment offer and an employee code is generated:

### IT Provisioning Tasks (4 tasks)

| Task Code | Role | Action URL | Description |
|-----------|------|-----------|-------------|
| `WFM_PROCESS_ALIGNMENT` | `wfm` | `/provisioning/wfm-alignment` | Align process roster, shift rules, attendance planning |
| `IT_EMAIL_DOMAIN_ASSET` | `it` | `/provisioning/it` | Create domain account, official email, asset assignment |
| `ADMIN_BIOMETRIC_ID_CARD` | `admin` | `/provisioning/admin` | Enroll biometric attendance, issue employee ID card |
| `APPOINTMENT_LETTER_ESIGN` | `hr` | `/provisioning/appointment-letter` | Generate appointment letter, complete e-sign tracking |

**For each task:**
1. Record created in `it_provisioning_request` table
2. Inbox notification created in `inbox_item` table
3. Email sent to all users with that role (deduplicated)

### Payroll HR Notification (1 email)

- **Recipients:** Up to 3 Payroll HR users (branch-scoped if branch exists)
- **Subject:** `Action Required: Issue Joining Documents for {employeeCode}`
- **Action URL:** `/employees/{employeeId}/joining-documents`
- **Purpose:** Notify Payroll HR to issue joining documents (appointment letter, NDA, welcome kit)

## Verification Steps

### 1. Run Diagnostic SQL

Execute the diagnostic script to check current state:

```bash
mysql -u root -p mas_hrms < backend/sql/999_diagnostic_provisioning_check.sql
```

This will show:
- Total provisioning requests created
- Recent provisioning requests for new employees
- Role assignments for IT/Admin/WFM/Payroll HR
- Recent inbox items
- SMTP configuration status
- Employees missing provisioning tasks

### 2. Test End-to-End

1. Create a test candidate through the ATS flow
2. Complete onboarding submission, BGV, name match, JCLR approval
3. Assign salary components
4. Approve the offer as Branch Head
5. Check the backend logs for:
   ```
   [approveOffer] IT provisioning tasks dispatched successfully for MAS12345
   [dispatchJoinProvisioningTasks] Starting join provisioning dispatch
   [dispatchJoinProvisioningTasks] Resolved users for role wfm
   [dispatchJoinProvisioningTasks] Created provisioning request
   [dispatchNotifications] Inbox item created
   [dispatchNotifications] Email sent
   [approveOffer] Payroll HR joining doc notification sent to 2 users
   ```
6. Query database:
   ```sql
   SELECT * FROM it_provisioning_request
   WHERE employee_id = '<new_employee_id>';

   SELECT * FROM inbox_item
   WHERE type = 'it_provisioning'
   ORDER BY created_at DESC LIMIT 10;
   ```
7. Log in as IT/Admin/WFM/HR users and verify tasks appear in their inbox
8. Log in as Payroll HR and verify joining documents email was received

## Required Role Assignments

The system requires these roles to be assigned to users:

| Role Key | Role Name | Used For |
|----------|-----------|----------|
| `it` | IT Administrator | Domain account, email, asset provisioning |
| `admin` | Admin Manager | Biometric enrollment, ID card issuance |
| `wfm` | WFM Manager | Process alignment, roster setup, shift rules |
| `hr` | HR | Appointment letter e-sign |
| `payroll_hr` | Payroll HR | Joining documents issuance |

**How to assign:**
```sql
-- Check current assignments
SELECT sr.role_key, sr.role_name, COUNT(DISTINCT ur.user_id) as users_assigned
FROM system_role sr
LEFT JOIN user_roles ur ON ur.role_key = sr.role_key AND ur.active_status = 1
WHERE sr.role_key IN ('it', 'admin', 'wfm', 'payroll_hr', 'hr')
GROUP BY sr.role_key, sr.role_name;

-- Assign role to user (replace with actual user IDs)
INSERT INTO user_roles (id, user_id, role_key, assigned_by, assigned_at, active_status)
VALUES (UUID(), '<user_id>', 'it', 'system', NOW(), 1);
```

**Better:** Create an admin UI for role management rather than SQL.

## Files Modified

### Core Changes
1. `backend/src/modules/ats/ats.onboarding.service.ts` (lines 1-16, 783-836)
   - Added static imports
   - Replaced dynamic imports with direct calls
   - Enhanced error handling and logging

2. `backend/src/modules/it-provisioning/it-provisioning.service.ts` (lines 227-297, 100-166)
   - Added detailed logging to `dispatchJoinProvisioningTasks()`
   - Added detailed logging to `dispatchNotifications()`
   - Added warning when no users found for a role

### New Files
3. `backend/sql/999_diagnostic_provisioning_check.sql`
   - Diagnostic queries to verify system state
   - Shows missing tasks, role assignments, inbox items

4. `backend/docs/FIX_PROVISIONING_NOTIFICATIONS.md` (this file)
   - Documentation of the fix
   - Verification steps
   - Troubleshooting guide

## Troubleshooting

### Issue: "No users found for role X"

**Diagnosis:**
```sql
SELECT sr.role_key, COUNT(DISTINCT ur.user_id) as users_assigned
FROM system_role sr
LEFT JOIN user_roles ur ON ur.role_key = sr.role_key AND ur.active_status = 1
WHERE sr.role_key = 'it'
GROUP BY sr.role_key;
```

**Fix:** Assign the role to users via the admin UI or SQL INSERT into `user_roles`.

### Issue: "Inbox item created but no email sent"

**Diagnosis:**
```sql
SELECT * FROM smtp_config WHERE is_active = 1;
```

**Fix:** Verify SMTP configuration in `smtp_config` table. Check backend logs for email send errors.

### Issue: "Tasks created but not visible in UI"

**Diagnosis:**
- Check if the user is logged in with the correct role
- Verify the frontend route `/provisioning/*` is working
- Check if inbox service is querying correctly

**Fix:** Review frontend inbox component and API endpoint.

## Rollback Plan

If the static imports cause issues:

1. **Revert the changes:**
   ```bash
   git checkout HEAD -- backend/src/modules/ats/ats.onboarding.service.ts
   git checkout HEAD -- backend/src/modules/it-provisioning/it-provisioning.service.ts
   ```

2. **Alternative fix** (if static imports are problematic):
   - Keep dynamic imports but fix the path resolution
   - Remove `.js` extension and let TypeScript/Node resolve correctly
   - Use a module bundler that handles dynamic imports better

## Success Criteria

✅ After offer approval:
1. 4 IT provisioning tasks created in `it_provisioning_request` table
2. 4 inbox notifications visible to IT/Admin/WFM/HR users
3. 4 emails sent to respective role holders
4. 1 email sent to Payroll HR users
5. Tasks appear in respective department dashboards
6. Payroll HR sees joining documents notification
7. No errors in application logs during this flow
8. All subsequent new joiners trigger the same workflow

## Impact

**Before Fix:**
- ❌ IT department unaware of new joiners
- ❌ Admin unable to schedule biometric enrollment
- ❌ WFM missing roster alignment tasks
- ❌ Payroll HR not notified about joining documents
- ❌ Onboarding delays and manual follow-ups required

**After Fix:**
- ✅ Automated task assignment to all departments
- ✅ Email + in-app notifications sent immediately
- ✅ Clear audit trail in database
- ✅ SLA tracking possible for onboarding tasks
- ✅ Reduced manual coordination between departments

## Related Systems

This fix integrates with:
- **ATS Onboarding Flow** - Triggers on offer approval
- **IT Provisioning System** - Task tracking and completion
- **Inbox Service** - In-app notifications
- **Email Service** - SMTP-based email delivery
- **Role-Based Access Control** - User resolution by role
- **Employee Joining Documents** - Payroll HR workflow

## Future Enhancements

1. **Admin Dashboard** - Show pending provisioning tasks by department
2. **SLA Monitoring** - Alert when tasks are overdue
3. **Role Assignment UI** - Allow admins to assign roles without SQL
4. **Task Templates** - Integrate with the formal `task_master` system (23 onboarding tasks with dependencies)
5. **Bulk Provisioning** - Handle multiple joiners at once
6. **Fallback Notifications** - Alert super admin when no users found for a role
