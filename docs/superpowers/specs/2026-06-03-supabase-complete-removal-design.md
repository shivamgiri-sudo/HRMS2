# Complete Supabase Removal — Design Spec

**Date:** 2026-06-03  
**Scope:** Remove every Supabase dependency from the HRMS project so it runs 100% locally with no external services.  
**Status:** Approved for implementation

---

## Goal

Eliminate `@supabase/supabase-js` and all Supabase calls from the frontend and backend. After this work:
- No network calls to `*.supabase.co`
- No Supabase env vars required
- Files stored on local disk via Express
- Notifications routed through the existing MySQL Communication module
- Demo mode removed
- `src/integrations/supabase/` directory deleted

---

## Architecture — Before and After

```
BEFORE:
  Frontend → supabase.from(...)      → Supabase PostgreSQL
           → supabase.storage(...)   → Supabase Storage (S3)
           → supabase.functions(...) → Supabase Edge Functions
           → hrmsApi                 → Express → MySQL

AFTER:
  Frontend → hrmsApi → Express → MySQL
                              → ./uploads/ (local disk)
                              → /api/communication/dispatch (notifications)
```

---

## Sub-phases

This work is split into three independent, sequentially deliverable sub-phases.

---

## Phase 2A — Data Layer (69 frontend files → hrmsApi)

### What it does
Replace every `supabase.from(table).select/insert/update/delete` call in the frontend with `hrmsApi` calls backed by MySQL Express endpoints.

### Backend endpoints: already exist (no new work needed)

These Supabase tables already have fully implemented Express endpoints:

| Supabase Table | MySQL Endpoint |
|---|---|
| `attendance_records` | `GET/PATCH /api/wfm/attendance/daily` |
| `leave_requests` | `GET/POST /api/leave/requests`, `PATCH /api/leave/requests/:id/review` |
| `leave_balances` | `GET /api/leave/balance/:employeeId` |
| `leave_types` | `GET/POST/PUT/DELETE /api/leave/types` |
| `performance_reviews` | `GET/POST /api/performance-feedback/requests` |
| `goals` | `GET/POST/PATCH /api/goals/goals`, `GET/POST /api/goals/cycles` |
| `employees` | `GET/POST/PATCH/DELETE /api/employees`, `GET /api/employees/me` |
| `company_holidays` | `GET/POST /api/leave/holidays` |
| `salary_structures` | `GET/POST /api/payroll/structures` |
| `onboarding_requests` | `GET /api/ats/onboarding/requests` |
| `notification_preferences` | `GET/PATCH /api/communication/preferences` |
| `profiles` | `GET /api/employees/me`, `GET /api/employees/:id` |
| `activity_logs` | `GET /api/access/audit-log` |
| `asset_assignments` | `POST /api/assets-mgmt/:id/assign`, `POST /api/assets-mgmt/:id/return` |
| `payroll_records` | `GET /api/payroll/payslip/:runId/:employeeId` |
| `review_kpi_ratings` | `GET /api/kpi/rating-config` |

### Backend endpoints: new ones needed

These tables have no MySQL equivalent yet. New endpoints + additive migrations required:

| Supabase Table | New Endpoint | Migration Needed |
|---|---|---|
| `company_events` | `GET/POST/PUT/DELETE /api/org/events` | `066_company_events.sql` |
| `push_subscriptions` | Remove entirely — push subscriptions require Supabase Realtime; feature dropped | None |
| `upload_batch` / `upload_batch_row` | `GET/POST /api/bulk-upload/batches` | `067_bulk_upload_batch.sql` |
| `employee_leave_eligibility` | `GET /api/leave/eligibility/:employeeId` — derived from `leave_type_master` + `employee_master` | No new table needed |
| `organization_settings` | `GET/PUT /api/org/settings` | `068_org_settings.sql` |
| `lms_content_master` / `lms_module_master` etc. | Redirect to LMS integration layer — these are LMS system-of-record tables. Replace queries with LMS sync snapshot read from `lms_learning_progress_snapshot` | No new table — use existing LMS snapshot tables |

### Frontend migration pattern

For each affected file, the migration is:
```typescript
// BEFORE
const { data, error } = await supabase.from("table_name").select("col1, col2").eq("id", x);
if (error) throw error;

// AFTER
const res = await hrmsApi.get<{ data: any[] }>("/api/endpoint?filter=value");
const data = res.data ?? [];
```

Mutations follow the same pattern using `hrmsApi.post/put/patch/delete`.

### `src/integrations/supabase/client.ts` — demo proxy

The 235-line demo proxy is deleted entirely. The demo mode `hrms_demo_session` localStorage key is no longer needed. Users log in with real MySQL accounts via `/api/auth/login`.

The only thing the proxy file provided beyond demo mode was the Supabase client itself — which is being removed. No replacement file is needed.

### `src/integrations/supabase/types.ts` — AppRole type

This file contains the `AppRole` type derived from Supabase's generated schema. Move it to a standalone file:

**Create:** `src/types/roles.ts`
```typescript
export type AppRole = "admin" | "hr" | "manager" | "employee" | "recruiter" |
  "qa" | "wfm" | "finance" | "trainer" | "ceo" | "process_manager" | "team_leader";
```

Update all imports of `Database["public"]["Enums"]["app_role"]` to `import { AppRole } from "@/types/roles"`.

### Files to migrate (grouped by module)

**Attendance (3 files):**
- `src/hooks/useAttendance.ts` → `/api/wfm/attendance/daily`
- `src/hooks/useAttendanceBreaks.ts` → `/api/wfm/attendance/daily`
- `src/hooks/useAttendanceReport.ts` → `/api/wfm/attendance/summary/:employeeId/:month`
- `src/pages/AttendanceRegularization.tsx` → `/api/leave/requests` + `/api/wfm/attendance`

**Leave (5 files):**
- `src/hooks/useLeaves.ts` → `/api/leave/requests`
- `src/hooks/useLeaveRequests.ts` → `/api/leave/requests`
- `src/hooks/useLeaveBalances.ts` → `/api/leave/balance/:employeeId`
- `src/hooks/useLeaveEligibility.ts` → `/api/leave/eligibility/:employeeId`
- `src/hooks/useLeaveBalanceReport.ts` → `/api/leave/balance/:employeeId`
- `src/hooks/useTeamLeaves.ts` → `/api/leave/requests?scope=team`
- `src/pages/Leaves.tsx` → `/api/leave/requests`, `/api/leave/types`, `/api/leave/holidays`
- `src/components/leaves/LeaveCalendarView.tsx` → `/api/leave/requests`

**Employees (6 files):**
- `src/hooks/useEmployees.ts` — already partially migrated; remove remaining Supabase calls
- `src/hooks/useEmployeeStatus.ts` → `/api/employees/:id`
- `src/hooks/useEmployeeCodePattern.ts` → `/api/employees/stats`
- `src/hooks/useNextEmployeeCode.ts` → `/api/employees/stats`
- `src/hooks/usePendingApprovals.ts` → `/api/inbox`
- `src/components/employees/EmployeeEditDialog.tsx` → `/api/employees/:id`
- `src/components/employees/EmployeeViewDialog.tsx` → `/api/employees/:id`
- `src/components/employees/BulkAssignManagerDialog.tsx` → `/api/employees`

**Dashboard (6 files):**
- `src/hooks/useDashboardStats.ts` → `/api/employees/stats`, `/api/leave/requests`
- `src/components/dashboard/RecentActivity.tsx` → `/api/access/audit-log`
- `src/components/dashboard/UpcomingCelebrations.tsx` → `/api/employees`
- `src/components/dashboard/UpcomingHolidays.tsx` → `/api/leave/holidays`
- `src/components/dashboard/WhosOut.tsx` → `/api/leave/requests`
- `src/components/dashboard/TeamLeaveCalendar.tsx` → `/api/leave/requests`
- `src/components/dashboard/LeaveCalendar.tsx` → `/api/leave/requests`

**Performance (7 files):**
- `src/hooks/usePerformance.ts` → `/api/performance-feedback/requests`, `/api/goals/goals`
- `src/components/performance/PerformanceAnalytics.tsx` → `/api/performance-feedback/reports`
- `src/components/performance/PerformanceReviews.tsx` → `/api/performance-feedback/reports`
- `src/components/performance/TeamAnalytics.tsx` → `/api/management`
- `src/components/performance/TeamGoalsView.tsx` → `/api/goals/goals`
- `src/components/performance/TeamReviewsManager.tsx` → `/api/performance-feedback`
- `src/pages/Performance.tsx` → `/api/performance-feedback`, `/api/goals`
- `src/pages/ReviewsManagement.tsx` → `/api/performance-feedback`
- `src/pages/TeamAnalytics.tsx` → `/api/management`
- `src/pages/UnifiedPerformanceCommandCenter.tsx` → `/api/management`

**Payroll (4 files):**
- `src/hooks/usePayroll.ts` → `/api/payroll/payslip`, `/api/payroll/structures`
- `src/hooks/usePayrollSummary.ts` → `/api/payroll`
- `src/components/payroll/PayrollTable.tsx` → `/api/payroll`
- `src/components/payroll/PayslipViewDialog.tsx` → `/api/payroll/payslip`
- `src/components/profile/PayslipViewer.tsx` → `/api/payroll/payslip`
- `src/components/profile/TaxDocumentsViewer.tsx` → `/api/employee-docs/:id` (files on disk)

**Company calendar/events (2 files):**
- `src/hooks/useCompanyEvents.ts` → `/api/org/events` (new)
- `src/hooks/useCompanyHolidays.ts` → `/api/leave/holidays`
- `src/pages/CompanyCalendar.tsx` → `/api/org/events`, `/api/leave/holidays`

**Profile (5 files):**
- `src/pages/Profile.tsx` → `/api/employees/me`, `/api/leave/balance`, `/api/employee-docs`
- `src/components/profile/LeaveRequestForm.tsx` → `/api/leave/requests`
- `src/components/profile/LeaveRequestHistory.tsx` → `/api/leave/requests`
- `src/components/profile/MyAssets.tsx` → `/api/assets-mgmt/employee/:id`
- `src/components/profile/MyAttendanceHistory.tsx` → `/api/wfm/attendance/daily`
- `src/components/profile/MyPerformanceReviews.tsx` → `/api/performance-feedback/reports`

**Settings/Org (4 files):**
- `src/components/settings/UserRolesManager.tsx` → `/api/access/roles/catalog`, `/api/access/roles/user/:id`
- `src/components/settings/DomainWhitelistSettings.tsx` → `/api/org/settings` (new)
- `src/components/settings/OfficeLocationSettings.tsx` → `/api/org/settings` (new)
- `src/pages/Departments.tsx` → `/api/org/departments` (already migrated in Task 2)

**Reports (2 files):**
- `src/components/reports/EmployeeReport.tsx` → `/api/employees`, `/api/leave/requests`, `/api/leave/balance`
- `src/hooks/useAssetReport.ts` → `/api/assets-mgmt`

**Onboarding (1 file):**
- `src/pages/Onboarding.tsx` → `/api/employees` (create), `/api/ats/onboarding`, `/api/employee-docs` (documents), `/api/account-control/provision` (invite employee)

**Bulk upload (1 file):**
- `src/pages/BulkUploadHub.tsx` → `/api/bulk-upload/batches` (new), `/api/files/upload` (file storage)

**Misc (3 files):**
- `src/hooks/useNotificationPreferences.ts` → `/api/communication/preferences`
- `src/hooks/useOnboardingRequest.ts` → `/api/ats/onboarding/requests`
- `src/hooks/useOnboardingRequests.ts` → `/api/ats/onboarding/requests`
- `src/hooks/usePushNotifications.ts` → **removed** (push subscriptions require Supabase Realtime; drop feature)
- `src/pages/ModuleLauncher.tsx` → `/api/employees/me`
- `src/pages/NativeLMSMyLearning.tsx` → `/api/lms/progress/:id`, `/api/lms/launch-urls/:id`
- `src/lib/version.ts` → version check removed; hardcode current version string

---

## Phase 2B — File Storage (local disk)

### What it does
Add a multipart file upload endpoint to Express. Serve uploaded files. Replace Supabase Storage calls in 3 files.

### Backend: new file upload module

**Create:** `backend/src/modules/files/files.routes.ts`

Endpoints:
```
POST /api/files/upload
  - Accepts: multipart/form-data with fields: file (binary), category (string), employee_id (optional)
  - Saves to: ./uploads/{category}/{uuid}.{original-extension}
  - Returns: { url: "/api/files/{category}/{uuid}.{ext}", filename: "...", size: N }
  - Auth: requireAuth + requireRole("admin", "hr") for employee-documents; requireAuth for ats-candidates
  - Max size: 10MB (matches existing Supabase limit)

GET /api/files/:category/:filename
  - Streams file from ./uploads/{category}/{filename}
  - Auth: requireAuth (employee can only access own docs — checked via filename prefix)
  - Returns: file stream with correct Content-Type
  - 404 if file not found
```

**Storage directory structure:**
```
backend/
  uploads/
    employee-documents/   ← employee ID proofs, contracts, offer letters
    ats-candidates/       ← resumes, selfies from walk-in registration
```

**Multer is already installed** (`multer@2.1.1` in package.json). Configuration:
```typescript
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const category = req.params.category ?? req.body.category ?? "misc";
    const dir = path.join(uploadsRoot, category);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});
```

**Mount in app.ts:** `app.use("/api/files", filesRouter)`

**Note for Railway deployment:** Mount a persistent volume at the `uploads/` path. For pure local dev, files persist in the project folder across restarts.

### Frontend files to migrate

**`src/hooks/useEmployeeDocuments.ts`** (partially migrated in Phase 1):
- Remove dynamic `import("@/integrations/supabase/client")` in `useUploadDocument`
- Replace with `POST /api/files/upload` (multipart) then `POST /api/employee-docs/:employeeId`
- Replace Supabase Storage cleanup in `useDeleteDocument` — file deletion via `DELETE /api/files/:category/:filename`

Add `DELETE /api/files/:category/:filename` endpoint to `files.routes.ts`:
```
DELETE /api/files/:category/:filename
  - Deletes file from ./uploads/{category}/{filename}
  - Auth: requireAuth + requireRole("admin", "hr")
  - 404 if not found, 200 { ok: true } on success
```

**`src/pages/NativeATSCandidateRegistration.tsx`** (lines 539–548):
- Replace `supabase.storage.from("ats-candidate-documents").upload(...)` with `POST /api/files/upload` (category: "ats-candidates")
- Replace `.getPublicUrl(...)` with the returned `url` field

**`src/components/documents/EmployeeDocuments.tsx`** and **`DocumentViewerDialog.tsx`**:
- Replace Supabase Storage `.download()` and `.createSignedUrl()` with `GET /api/files/:category/:filename`

**`src/components/profile/TaxDocumentsViewer.tsx`**:
- Replace Supabase Storage `.download()` with `GET /api/files/:category/:filename`

### File URL format migration

Existing records in `employee_documents.file_url` contain Supabase public URLs (`https://bebminxoqdjzzfhnrsge.supabase.co/storage/...`). New uploads will store `/api/files/employee-documents/{uuid}.{ext}`. The viewer components must handle both formats:
```typescript
const isLegacySupabaseUrl = (url: string) => url.startsWith("https://") && url.includes("supabase.co");
const fileUrl = isLegacySupabaseUrl(doc.file_url) ? doc.file_url : `${HRMS_API_URL}${doc.file_url}`;
```

---

## Phase 2C — Notifications + Final Cleanup

### What it does
Replace 7 Supabase Edge Function calls with the existing Communication module. Delete all Supabase integration files. Remove the npm package.

### Notification wiring

Each `supabase.functions.invoke("X", { body })` call is replaced with a fire-and-forget `hrmsApi.post` to the existing Communication dispatch endpoint:

```typescript
// BEFORE
await supabase.functions.invoke("leave-submission-notification", {
  body: { employeeId, leaveType, fromDate, toDate }
}).catch(() => {});

// AFTER
hrmsApi.post("/api/communication/dispatch", {
  template_code: "leave_submission",
  recipient_employee_id: employeeId,
  variables: { leaveType, fromDate, toDate },
}).catch(() => {}); // fire-and-forget, non-blocking
```

**Edge function → template_code mapping:**

| Edge Function | template_code | File |
|---|---|---|
| `leave-submission-notification` | `leave_submission` | `useLeaveRequests.ts` |
| `onboarding-request-notification` | `onboarding_request` | `useOnboardingRequest.ts`, `useOnboardingRequests.ts` |
| `review-notification` | `performance_review` | `usePerformance.ts` |
| `review-acknowledgment-notification` | `review_acknowledgment` | `usePerformance.ts` |
| `event-notification` | `company_event` | `CompanyCalendar.tsx` |
| `onboarding-notification` | `employee_onboarding` | `Onboarding.tsx` |
| `version-check` | **removed** — version.ts hardcodes version string instead | `version.ts` |

**`invite-employee` edge function** in `Onboarding.tsx` is different — it creates a Supabase Auth user. Replace with:
```typescript
await hrmsApi.post("/api/account-control/provision", {
  employee_id: employeeId,
  email: employeeEmail,
  role: "employee",
});
```
The `/api/account-control/provision` endpoint already exists and creates MySQL-backed user accounts.

### Communication templates needed

The `/api/communication/dispatch` endpoint uses the `communication_template` table. Ensure these template_codes are seeded or verified to exist before dispatch is called. Add a migration `069_notification_templates.sql` that inserts `INSERT IGNORE` rows for each template_code above so dispatch doesn't 404 on missing template.

### Final cleanup checklist

**Files to delete:**
```
src/integrations/supabase/client.ts
src/integrations/supabase/types.ts
src/integrations/supabase/index.ts (if exists)
```

**Directory to remove:**
```
src/integrations/supabase/
```

**File to create:**
```
src/types/roles.ts   ← AppRole type, extracted from supabase/types.ts
```

**package.json — remove:**
```bash
npm uninstall @supabase/supabase-js
```

**backend/.env + .env.example — remove:**
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
```

**backend/src/db/supabaseAdmin.ts:**
- Already has a graceful no-op stub when credentials missing
- After removing env vars it will use the stub
- Fully delete once `backend/src/modules/access/access.service.ts` `/rbac-reconciliation` endpoint is updated to not call it (the RBAC reconciliation endpoint's Supabase call becomes a no-op that returns `[]`)

**Verification after cleanup:**
```bash
# Must return zero results
grep -r "supabase" src --include="*.ts" --include="*.tsx" -l
grep -r "@supabase" package.json
grep -r "SUPABASE" backend/.env.example
```

---

## New SQL Migrations (Additive)

| File | Table | Purpose |
|---|---|---|
| `069_company_events.sql` | `company_event_master` | Calendar events (replaces Supabase `company_events`) |
| `070_bulk_upload_batch.sql` | `upload_batch`, `upload_batch_row` | Bulk upload tracking (replaces Supabase tables) |
| `071_org_settings.sql` | `org_settings` | Organisation-level config (domain whitelist, office location) |
| `072_notification_templates_seed.sql` | `communication_template` | Seed `INSERT IGNORE` rows for 6 notification template codes |

All migrations use `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE` — safe to run on any DB state.

---

## What is NOT changing

- Authentication: already 100% MySQL JWT (`/api/auth/login`) — no change
- `supabaseAdmin.ts` backend stub: already graceful — remove after cleanup phase
- LMS tables (`lms_content_master` etc.): these belong to the deployed LMS system, not HRMS. Frontend queries for LMS content are replaced with LMS integration layer reads (already done in Task 5)
- `src/integrations/supabase/types.ts` **Database type** (other than AppRole): no other type from this file is needed once supabase is removed

---

## Implementation Plan Structure (for writing-plans)

**Phase 2A — 4 tasks** (data layer, grouped by module):
1. Task 2A-1: Attendance, Leave, Leave Eligibility hooks and pages
2. Task 2A-2: Employees, Dashboard, Profile hooks and components
3. Task 2A-3: Performance, Goals, Payroll hooks and components
4. Task 2A-4: New backend endpoints (company_events, bulk_upload, org_settings, leave_eligibility) + remaining misc files

**Phase 2B — 2 tasks** (file storage):
1. Task 2B-1: Backend file upload module (`multer`, `files.routes.ts`, app.ts mount)
2. Task 2B-2: Frontend file upload migration (3 files: useEmployeeDocuments, NativeATSCandidateRegistration, DocumentViewerDialog + TaxDocumentsViewer)

**Phase 2C — 2 tasks** (notifications + cleanup):
1. Task 2C-1: Replace 7 edge function calls with Communication dispatch + notification template seed migration
2. Task 2C-2: Delete `src/integrations/supabase/`, create `src/types/roles.ts`, `npm uninstall @supabase/supabase-js`, remove backend Supabase vars, final grep verification

**Total: 8 tasks** across 3 phases.
