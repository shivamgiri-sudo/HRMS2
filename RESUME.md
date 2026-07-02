# MAS Callnet HRMS — Session Resume Guide

> Last updated: commit `e3eb4d8`  
> Branch: `main`  
> Repo: https://github.com/shivamgiri-sudo/HRMS1.git

---

## Quick Start After Pull

```bash
git clone https://github.com/shivamgiri-sudo/HRMS1.git
# OR if already cloned:
git pull origin main
```

### Start Backend
```bash
npm --prefix backend run dev
# Runs on http://localhost:5055
# Entry point: backend/dist/server.js (NOT index.js)
```

### Start Frontend
```bash
npm install        # first time only
npm run dev        # Runs on http://localhost:8080
```

---

## Project Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite 5 + React 18 + TypeScript + Tailwind + shadcn/ui |
| Backend | Node.js + Express 4 + TypeScript |
| Database | MySQL 8 — `mas_hrms` (live) |
| ORM | mysql2 (raw SQL, no ORM) |
| Auth | JWT via `PORTAL_JWT_SECRET` |
| Email | Google Workspace SMTP via `careers@teammas.in` |

---

## Database Connections

### Primary (live) — mas_hrms
```
Host:     192.168.10.6:3306
User:     shivam_user
Password: qwersdfg!@#hjk
DB:       mas_hrms
```

### Legacy sync source — db_bill
```
Host:     192.168.10.22:3306
User:     shivam_user
Password: qwersdfg!@#hjk
DB:       db_bill
```

**Auto-sync:** Windows scheduled task `HRMS-db-bill-sync` runs `scripts/sync-from-db-bill.mjs` every 30 minutes. Syncs 32,671 employees from db_bill → mas_hrms.

---

## Backend Config (backend/.env)

```env
PORT=5055
NODE_ENV=development
FRONTEND_URL=http://localhost:8080
ACTIVE_DB_PROVIDER=mysql
DB_HOST=192.168.10.6
DB_PORT=3306
DB_USER=shivam_user
DB_PASSWORD=qwersdfg!@#hjk
DB_NAME=mas_hrms
DB_POOL_MAX=10
PORTAL_JWT_SECRET=change-me-to-random-32-char-string-here
JWT_SECRET=change-me-to-random-32-char-string-here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=careers@teammas.in
SMTP_PASS=ridn axbb xzhq gnqt
SMTP_FROM=careers@teammas.in
SMTP_FROM_NAME=MAS Callnet HRMS
```

---

## What Was Completed

### ✅ Employee Auto-Sync
- Script: `scripts/sync-from-db-bill.mjs`
- 32,671 employees synced, 0 errors
- Windows task: `HRMS-db-bill-sync` (every 30 min)

### ✅ Employee Portal Data Visibility
- `GET /api/employees/me` — returns full profile with JOINed master data
  - Fixed mysql2 duplicate-column-alias bug (was overwriting aliased fields)
  - Removed non-existent columns (`working_hours_start/end/working_days`)
- `GET /api/payroll/payslip/my?year=YYYY` — payslip listing for logged-in employee

### ✅ SMTP / Email
- Configured and verified via Google Workspace app password
- `forgotPassword()` only sends to `active_status = 1` employees

### ✅ Auth
- Case-insensitive email login (`LOWER()` in SQL)
- Rate limiter: 10 attempts / 15 min per IP (in-memory, resets on server restart)
- Auth backend correct entry point: `backend/dist/server.js`

### ✅ Frontend Data Fetching — IIFE Pattern Fixed (30 files)
All files previously had this broken pattern where return value was discarded:
```ts
// BROKEN (data and error are always undefined)
await (async () => { const res = await hrmsApi.get(...); return { data: res.data, error: null }; })();
if (error) throw error;   // ← error is undefined
return data as Foo[];     // ← data is undefined
```
Fixed to:
```ts
const res = await hrmsApi.get<{success:boolean;data:any}>("/api/...");
return (res.data ?? []) as Foo[];
```
Files fixed: LeaveRequestHistory, MyAttendanceHistory, LeaveRequestForm, MyAssets,
MyPerformanceReviews, TaxDocumentsViewer, LeaveCalendar, PerformanceWidget,
UpcomingCelebrations, BulkAssignManagerDialog, EmployeeEditDialog, EmployeeViewDialog,
LeaveCalendarView, PayrollTable, PayslipViewDialog, PerformanceAnalytics,
PerformanceReviews, TeamAnalytics (component + page), TeamGoalsView, TeamReviewsManager,
EmployeeReport, UserRolesManager, Departments, Performance, ReviewsManagement,
UnifiedPerformanceCommandCenter, Dashboard.

### ✅ Scroll-to-Top Fix
`src/components/layout/ScrollToTop.tsx` — now only scrolls on pathname change,
not on query-param change. Profile tabs (`?tab=leaves`) no longer jump to top.

### ✅ Faded Text Fix
`src/index.css` — `--muted-foreground` darkened from 47% → 35% lightness.

### ✅ Dashboard Real Stats
`getDashboardStats()` in `src/pages/Dashboard.tsx` now fetches:
- Department count from `GET /api/org/departments`
- Approved leave count from `GET /api/leave/requests?status=approved`
- Payroll run count from `GET /api/payroll/runs`

---

## Known Constraints (Do Not Change)

- **No Supabase** — 100% MySQL deployment only
- **No Vercel** — deployed locally
- **Attendance** — marked via Biometric (support staff) and APR report (analysts)
  Clock-in/out NOT used for attendance/payroll
- **Deployment** — local Windows server

---

## What Still Needs Work

### 1. Leave Balance Seeding
`leave_balance_ledger` is empty for all synced employees. HR must seed via:
```
POST /api/leave/balance/seed
Body: [{ employee_id, leave_type_id, year, allocated_days }, ...]
```
No UI for this yet — needs an HR admin screen.

### 2. Attendance Data Population
`attendance_daily_record` table is empty. Attendance import pipeline needs to be
built/wired for:
- **Support staff** → Biometric device export
- **Analysts** → APR report import
MyAttendanceHistory tab will show empty until records exist.

### 3. Assets Module
`asset_assignment` table may be empty. MyAssets tab will show "no assets" until
HR assigns assets via the Assets admin page.

### 4. Performance / Goals Data
`performance_feedback_report`, `goals` tables likely empty. Performance tabs
will show empty until managers create review cycles and set KPIs.

### 5. Documents
`employee_documents` table likely empty. TaxDocumentsViewer will show empty
until HR uploads documents.

### 6. Test Passwords (Change Before Production)
- `admin@mascallnet.com` → `Admin@1234`
- `naresh.chauhan@teammas.in` → `Admin@1234`

### 7. Security — JWT Secrets
Change in `backend/.env` before production:
```
PORTAL_JWT_SECRET=<generate random 32+ char string>
JWT_SECRET=<generate random 32+ char string>
```

### 8. Dashboard `onboarding` stat
Still hardcoded `0` — needs a count of employees with `employment_status = 'onboarding'`
from `/api/employees/stats` or a new endpoint.

---

## Key File Locations

| What | Where |
|------|-------|
| Backend entry | `backend/src/server.ts` → compiled to `backend/dist/server.js` |
| DB connection | `backend/src/db/mysql.ts` |
| Auth routes | `backend/src/modules/auth/auth.routes.ts` |
| Employee routes | `backend/src/modules/employees/employee.routes.ts` |
| Leave routes | `backend/src/modules/leave/leave.routes.ts` |
| Payroll routes | `backend/src/modules/payroll/payroll.routes.ts` |
| Notification/SMTP | `backend/src/services/notification.service.ts` |
| Sync script | `scripts/sync-from-db-bill.mjs` |
| Frontend API client | `src/lib/hrmsApi.ts` |
| Auth context | `src/contexts/AuthContext.tsx` |
| Profile page | `src/pages/Profile.tsx` |
| Dashboard | `src/pages/Dashboard.tsx` |
| CSS theme vars | `src/index.css` |
| Scroll fix | `src/components/layout/ScrollToTop.tsx` |

---

## Useful Debug Commands

```bash
# Check what's listening on backend port
netstat -ano | grep :5055 | grep LISTEN

# Kill stale process on port 5055 (replace PID)
taskkill /F /PID <PID>

# Re-run employee sync manually
node scripts/sync-from-db-bill.mjs

# TypeScript check (frontend)
./node_modules/.bin/tsc --noEmit

# TypeScript build (backend)
npm --prefix backend run build
```

---

## mysql2 Gotcha (Important)

When a SELECT has two columns that produce the same key name (e.g. both aliased
and unaliased `employment_status`), mysql2 JS objects keep the **last** value.
This silently overwrites earlier aliases to `undefined`.

**Rule:** Every column in a JOIN query must have a unique alias. No bare
`e.column_name` if the same name appears aliased elsewhere in the same SELECT.

---
