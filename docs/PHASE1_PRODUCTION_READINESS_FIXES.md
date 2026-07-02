# Phase 1 Production Readiness Fixes

## Branch

`fix/production-readiness-phase1`

## Why this branch exists

This branch starts the practical stabilization work before adding more HRMS pages. The project already has many modules, so the first fix is to make readiness, data source ownership, and sensitive workflow risks visible to developers and operators.

## Changes included

### 1. Page readiness registry

Added:

- `src/lib/pageReadiness.ts`

This registry lists high-risk pages and modules that require additional validation before production sign-off.

Initial registered areas:

- Attendance
- Reports
- Payroll
- Payslip Center
- WFM Live Tracker
- Quality Dashboard
- Operations Dashboard
- DPDP / Privacy
- Integration Hub
- Migration Console

Each registry entry includes:

- path
- title
- module
- maturity status
- risk level
- data source requirement
- audit/review requirement
- download/export control requirement
- data sensitivity level
- owner role
- missing controls
- recommended next actions

### 2. Backend readiness endpoint

Updated:

- `backend/src/routes/health.routes.ts`

Added:

```http
GET /api/health/readiness
```

This endpoint returns a structured readiness response covering:

- primary MySQL connectivity
- migration status
- attendance/report validation warning
- payroll/report validation warning
- privacy and sensitive export warning

Example response shape:

```json
{
  "success": true,
  "service": "MCN HRMS Backend API",
  "status": "ready_with_warnings",
  "checks": [
    {
      "area": "database",
      "status": "ok",
      "message": "Primary MySQL connection is reachable.",
      "owner": "IT / Backend"
    }
  ],
  "summary": {
    "errors": 0,
    "warnings": 3,
    "ok": 2
  }
}
```

## What this fixes immediately

- Gives developers and auditors one place to track high-risk pages.
- Adds an operational readiness endpoint beyond simple health check.
- Makes attendance, reports, payroll, privacy, and export concerns visible before production release.
- Creates a foundation for UI warnings, admin dashboards, and CI checks.

## What still needs fixing next

### Reports

- Start-of-year count must use active employee count as of 1 January.
- Termination count must use termination/exit effective date.
- Employee growth month-on-month must count active employees as of each month end.
- Payroll trend must show all months with valid payroll data.
- Monthly payroll summary must compare current and previous month.
- Leave balance report must use authoritative leave ledger for selected year.
- Attendance reports must use branch/process/cost-centre filters and correct employee scope.

### Attendance

- Show COSEC/MIS sync health and last import timestamp.
- Add branch, process, cost-centre, employee, month, and date-range filters.
- Add missing punch diagnostics.
- Add regularization audit trail.
- Add calculation explanation drawer.

### Payroll

- Validate salary component breakdown before payslip generation.
- Prevent NULL component values from being presented as confirmed zero unless source table confirms zero.
- Add maker-checker before publish.
- Add variance warnings.
- Add download logs and PDF watermarking.

### Compliance and security

- Add download/export trail for sensitive reports.
- Add field masking for salary, PAN, Aadhaar, phone, address, bank details.
- Add consent register, DSAR tracker, retention scheduler, and breach register.
- Add periodic access review for admin/payroll/compliance roles.

## Local validation commands

```bash
cd HRMS1
npm install
cd backend
npm install
npm run typecheck
npm run dev
```

Then test:

```bash
curl http://localhost:5055/api/health
curl http://localhost:5055/api/health/readiness
```

## Sign-off rule

No page should be marked production-ready unless it has:

- loading state
- empty state
- error state
- permission-denied state
- data source label
- last sync timestamp
- role/branch/process scope
- review/audit trail for sensitive actions
- controlled downloads/exports
- field masking where required
- responsive layout
- test coverage for success and failure states
