# Codex Local Validation Checklist

Use this checklist after checking out `fix/production-readiness-phase1` locally.

## 1. Pull branch

```bash
git fetch origin
git checkout fix/production-readiness-phase1
```

## 2. Install and typecheck

```bash
npm install
cd backend
npm install
npm run typecheck
```

## 3. Configure local environment

Confirm `backend/.env` contains only rotated credentials and is not committed.

Required minimum values:

```env
DB_HOST=your-host
DB_PORT=3306
DB_USER=your-user
DB_PASSWORD=your-rotated-secret
DB_NAME=mas_hrms
JWT_SECRET=local-or-prod-secret
JWT_REFRESH_SECRET=local-or-prod-refresh-secret
ENCRYPTION_KEY=64-char-hex-key
ENABLE_SCHEDULERS=false
```

## 4. Backend health checks

Run backend:

```bash
npm run dev
```

Then test:

```bash
curl http://localhost:5055/api/health
curl http://localhost:5055/api/health/readiness
```

Expected:

- `/api/health` returns `healthy` or clear degraded reason.
- `/api/health/readiness` returns checks for database, migrations, attendance/report readiness, payroll/report readiness, and privacy/download readiness.

## 5. Run MySQL production readiness validator

From `backend` folder:

```bash
npx tsx scripts/validate-hrms-production-readiness.ts > ../readiness-output.json
```

Check `readiness-output.json`.

Pass criteria:

- `summary.error` should be `0`.
- Any `warning` must be reviewed and either fixed or accepted with reason.
- `employees` table must have active/status and joining-date columns mapped.
- `attendance_daily` must have employee and date columns mapped.
- Payroll tables must include run, line, and component breakdown tables.

## 6. Reports page validation

Open:

```text
http://localhost:8083/reports
```

Check these items:

1. Start-of-year count uses active employees as of `1 Jan 2026`, not full employee table.
2. Termination count is populated from exit/termination effective date.
3. Employee growth month-on-month counts active employees as of each month end.
4. Payroll trend shows all months with payroll data, including April if data exists.
5. Payroll trend should display as a line chart.
6. Monthly payroll summary shows current month and previous month.
7. Leave balance report pulls selected-year balance from authoritative leave ledger.
8. Attendance report does not stop at 50 employees unless pagination says so clearly.
9. Branch, Process, and Cost Centre filters work together.
10. Long lists use search, pagination, and expand/collapse grouping.

## 7. Attendance validation

Open:

```text
http://localhost:8083/attendance
```

Check:

1. Page loads without crash.
2. Empty state appears when no data is available.
3. Error state is readable if backend/API fails.
4. Date-range filter works.
5. Branch/process/cost-centre filters work.
6. Missing punch cases are visible.
7. Regularization updates are logged.
8. COSEC/MIS last sync time is visible or at least available through backend diagnostics.

## 8. Payroll and payslip validation

Open:

```text
http://localhost:8083/payroll
http://localhost:8083/payroll/payslips
```

Check:

1. Salary components are fetched from component breakdown table.
2. NULL values are not silently shown as real zero values.
3. Gross salary equals sum of earnings.
4. Net salary equals earnings minus deductions.
5. Employee details in payslip are not hardcoded.
6. Current and previous month values match MySQL.
7. PDF payslip displays correct component details.
8. Download action is role-protected.
9. Payroll publish/freeze has maker-checker or clear approval status.

## 9. WFM validation

Open:

```text
http://localhost:8083/wfm/roster
http://localhost:8083/wfm/live-tracker
http://localhost:8083/wfm/auto-roster
http://localhost:8083/rta-board
```

Check:

1. WFM Live Tracker is not a blank/placeholder page.
2. Roster source and attendance source are visible.
3. Branch/process scoping works.
4. Manager approval page shows pending and completed approvals.
5. Auto-roster explains why a shift was assigned.
6. Manual override requires a reason.

## 10. Compliance and security validation

Open:

```text
http://localhost:8083/compliance/dpdp
http://localhost:8083/compliance/statutory
http://localhost:8083/integration-hub
http://localhost:8083/settings/access-control
http://localhost:8083/super-admin/page-access
```

Check:

1. DPDP page includes consent register, DSAR, retention, and breach tracking or marks them as pending.
2. Integration Hub never displays secret values.
3. Connection tests are logged.
4. Access-control changes are logged.
5. Sensitive exports are logged.
6. Salary, bank, PAN, Aadhaar, phone, and address fields are masked for unauthorized roles.
7. Admin-only pages are blocked for non-admin users on frontend and backend.

## 11. Public candidate pages validation

Open:

```text
http://localhost:8083/interview-registration
http://localhost:8083/candidate-portal/login
```

Check:

1. Candidate consent is displayed.
2. File upload validates type and size.
3. Registration prevents duplicate candidate records.
4. Public endpoints are rate-limited.
5. Candidate portal cannot access another candidate profile by changing URL/id.

## 12. Final sign-off rule

Do not mark a page production-ready unless it has:

- loading state
- empty state
- error state
- permission-denied state
- data source label
- last sync timestamp
- role and branch/process scope
- review trail for sensitive actions
- controlled downloads
- field masking where needed
- mobile responsive layout
- success/failure test coverage
