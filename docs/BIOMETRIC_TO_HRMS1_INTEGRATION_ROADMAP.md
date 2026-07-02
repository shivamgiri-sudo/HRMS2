# Biometric to HRMS1 Integration Roadmap

## Purpose

This document converts the Biometric comparison into a safe HRMS1 implementation plan. HRMS1 is already much larger than the Biometric project, so the correct approach is not to copy Biometric into HRMS1. The correct approach is to extract the useful attendance/WFM ideas and implement them as additive, feature-flagged HRMS1 modules using the existing backend, schema, RBAC, audit, and reporting structure.

## Guiding rules

1. Do not replace existing HRMS1 attendance, WFM, payroll, leave, or roster modules.
2. Do not copy hardcoded DB/JWT/host configuration from Biometric.
3. Use `.env` or encrypted integration config only.
4. Keep all changes additive and behind feature flags where possible.
5. Use HRMS1 tables already present in `mas_hrms` before creating new tables.
6. Ensure every attendance decision is explainable: source punch, rule applied, roster/leave/holiday override, final status.
7. Manager/TL views must be scope-limited by reporting hierarchy, branch, process, and cost centre.
8. All manual overrides must require reason and should be auditable.

## Current HRMS1 baseline

HRMS1 already has these routes/modules:

- Attendance
- Attendance Regularization
- Attendance Rules Master
- WFM Roster
- Auto Roster
- RTA Board
- Control Tower
- Reports
- Payroll
- Payslips
- Leave
- Access Control
- Integration Hub
- Compliance / DPDP

HRMS1 also already contains a live biometric webhook route:

- `POST /api/wfm/biometric-punch`

That route writes biometric evidence to `integration_biometric_daily`, keeps `wfm_attendance_session` in sync, processes attendance through `attendanceEngineService`, updates `attendance_daily_record`, and triggers mismatch notification.

## Schema-backed HRMS1 tables to use

### Biometric / attendance source

- `integration_biometric_daily`
- `attendance_daily_record`
- `attendance_regularization`
- `attendance_rule_config`
- `employee_biometric_enrollment`
- `wfm_attendance_session`

### Roster / WFM

- `wfm_roster_assignment`
- `roster_master`
- `roster_capacity_config`
- `roster_preference`

### Leave / exception source

- `leave_request`
- `leave_balance_ledger`
- `leave_holiday_master`

### Payroll downstream

- `salary_prep_run`
- `salary_prep_line`
- `salary_prep_line_component`

### Scope and access

- `employees`
- `user_roles`
- `user_page_access`
- `access_requests`
- `account_control_log`

## Biometric feature mapping

| Priority | Biometric idea | HRMS1 additive implementation | Breaking risk | Safe implementation method |
|---|---|---|---|---|
| P0 | Raw COSEC punch ingestion | Create scheduled SQL Server pull into `integration_biometric_daily` plus existing webhook support | Medium | Add new sync service, do not change existing attendance pages first |
| P0 | Punch-to-daily materialization | Convert raw punches into `attendance_daily_record` through `attendanceEngineService` | Low/Medium | Use existing engine and add source lineage fields |
| P0 | Reconciliation | Compare biometric punches, daily attendance, leave, roster, and payroll LWP | Low | Add new reconciliation endpoint/report first |
| P0 | Adherence Command Center | New dashboard under WFM/Reports using `attendance_daily_record` + roster + employees | Low | Read-only dashboard first |
| P0 | Agent View | Employee-level attendance/adherence row with punch, late, hours, status, manager, process | Low | Read-only endpoint/export first |
| P0 | Manager-scoped attendance | Enforce reporting hierarchy in attendance APIs | Medium | Add scope helper and tests before UI changes |
| P1 | Manager-employee assignment console | Strengthen RM mapping and bulk assignment | Medium | Add approval/audit and avoid direct overwrite |
| P1 | Shift/roster rules with punch calculation | Link roster assignment and attendance rule config in daily calculation | Medium | Add rule explanation output before changing payroll impact |
| P1 | Bulk roster assignment | Paste employee codes + date range + shift + weekdays | Medium | Validate-only mode first, then commit mode |
| P1 | My Attendance Report | Add self-service monthly report with punches, status, late, regularization action | Low | Add tab/page using existing APIs |
| P1 | Attendance support/query | Add attendance-specific ticket type from attendance page | Low | Use Helpdesk integration rather than new system |
| P2 | App access status panel | Active/inactive/no-login/last-login/biometric mapped | Low | Read-only admin panel |
| P2 | Biometric employee import validation | Validate employee code + COSEC UserID + manager + process + LOB | Low/Medium | Dry-run import first |

## P0 implementation details

### 1. COSEC SQL Server punch sync

Add a new backend service, not a UI-only change.

Recommended file structure:

```text
backend/src/modules/wfm/cosec-sync.service.ts
backend/src/modules/wfm/cosec-sync.routes.ts
backend/src/modules/wfm/cosec-reconciliation.service.ts
```

Data flow:

```text
COSEC SQL Server Mx_ATDEventTrn
  -> raw pull / webhook
  -> integration_biometric_daily
  -> attendanceEngineService.processEmployee()
  -> attendance_daily_record
  -> WFM dashboards / Reports / Payroll LWP
```

Minimum sync fields:

```text
source_system
source_table
source_event_id
cosec_user_id
employee_code
employee_id
punch_datetime
activity_date
punch_type
device_id
branch/process if available
raw_payload
sync_run_id
```

Do not store SQL Server credentials in code. Store through Integration Hub encrypted credential flow or `.env`.

### 2. Biometric reconciliation layer

Add read-only reconciliation first.

Mismatch categories:

```text
NO_PUNCH
MISSING_LOGOUT
DUPLICATE_PUNCH
UNMAPPED_COSEC_USER
LEAVE_BUT_PUNCHED
PUNCHED_BUT_ABSENT
ROSTER_OFF_BUT_PUNCHED
PUNCHED_OUTSIDE_SHIFT
BIOMETRIC_HOURS_BELOW_HALF_DAY
BIOMETRIC_HOURS_BELOW_FULL_DAY
MANUAL_OVERRIDE_PRESENT
LOCKED_ATTENDANCE_CHANGED
PAYROLL_LWP_MISMATCH
```

Suggested endpoint:

```http
GET /api/wfm/biometric-reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=&processId=&managerId=&status=
```

Response should include:

```json
{
  "employee_id": "...",
  "employee_code": "...",
  "employee_name": "...",
  "record_date": "2026-06-01",
  "first_punch": "09:02:00",
  "last_punch": "18:16:00",
  "biometric_minutes": 554,
  "attendance_status": "present",
  "roster_status": "Working",
  "leave_status": null,
  "mismatch_type": null,
  "explanation": "Full-day threshold met from biometric source."
}
```

### 3. Adherence Command Center

Add under WFM/Reports as a separate page first; do not mix with generic Reports until validated.

Route suggestion:

```text
/wfm/adherence-command-center
```

Widgets:

```text
Mandate agent-days
Present agent-days
Absent agent-days
Half-day agent-days
Late count
On-time percentage
Late percentage
Shrinkage percentage
Adherence percentage
Leave-but-punched count
Punched-but-absent count
Unmapped biometric users
Manual override count
```

Filters:

```text
Date range
Branch
Process
LOB
Cost Centre
Manager
TL
Shift
Attendance source
Status
Mismatch type
```

Export rules:

- HR/Admin/WFM can export full report.
- Manager/TL can export only scoped team.
- Employee cannot export team data.
- Exports must be logged.

### 4. Agent Attendance View

Route suggestion:

```text
/wfm/agent-attendance-view
```

Columns:

```text
Employee Code
Employee Name
Branch
Process
LOB
Manager
TL
Shift
Working Days
Present
Half Day
Absent
Late Days
Average Punch In
Average Punch Out
Total Biometric Hours
Adherence %
Late %
Regularization Count
Override Count
Mismatch Count
```

### 5. My Attendance Report

Enhance employee self-service under:

```text
/profile?tab=attendance
```

Daily row should show:

```text
Date
Roster shift
First punch
Last punch
Total biometric hours
Attendance source
Final status
Late by minutes
LWP value
Leave/holiday/week-off override
Regularization button
Explanation drawer
```

### 6. Attendance query workflow

Use existing Helpdesk rather than creating a new parallel ticket system.

Add attendance categories:

```text
Missing punch
Wrong punch time
Late dispute
Roster mismatch
Leave mismatch
Payroll LWP mismatch
Biometric mapping issue
```

Auto-routing:

```text
Employee -> TL/Manager -> WFM -> HR -> Payroll if LWP impact
```

## Role-by-role integration impact

### Employee

Add:

- My Attendance Report
- Raise attendance query from a daily row
- See biometric first/last punch
- See reason for late/half-day/absent
- Download own monthly attendance PDF/CSV

Do not allow:

- Viewing raw data of others
- Editing biometric punches
- Changing attendance status directly

### TL / Manager

Add:

- Team Attendance View
- Team mismatch queue
- Missing logout list
- Late dispute approval
- Roster mismatch review
- Scoped export

Do not allow:

- Other teams' attendance
- Direct payroll LWP changes
- Backdated override without reason

### WFM / RTA

Add:

- Adherence Command Center
- Live mismatch queue
- COSEC sync health
- Roster-vs-punch reconciliation
- Manual override with reason
- Bulk roster validation

### HR

Add:

- Employee biometric mapping review
- Manager/TL assignment console
- Attendance policy exception approval
- Attendance impact report for payroll

### Payroll / Finance

Add:

- Attendance-to-LWP reconciliation before payroll run
- Lock attendance snapshot before salary prep
- Payroll mismatch report
- Exception approval before publish

### IT Security

Add:

- COSEC connector health
- Secret rotation status
- Failed sync alerts
- Integration access audit
- Device/source whitelist if available

### Compliance / Data Security Officer

Add:

- Export logs
- Override logs
- Attendance dispute audit
- Retention policy for raw biometric events
- Purpose limitation for biometric data

## UI/UX design recommendations

### Color system

```text
Biometric source / punch: Indigo
Roster: Purple
Present / resolved: Green
Late / warning: Amber
Absent / mismatch: Red
Locked payroll-impacting state: Slate/Dark
Manual override: Orange
```

### Layout for Adherence Command Center

Top row:

```text
Date range | Branch | Process | Cost Centre | Manager | TL | Source | Export
```

KPI row:

```text
Mandate | Present | Absent | Half Day | Late % | Adherence % | Shrinkage % | Mismatches
```

Main body:

```text
Left: trend line chart
Middle: mismatch breakdown
Right: top exception employees
Bottom: employee-level table with expandable details
```

### Explainability drawer

Each attendance row should have an explanation drawer:

```text
Source: Biometric
First punch: 09:02
Last punch: 18:16
Raw minutes: 554
Rule: COSEC full day >= 540 minutes
Roster: 09:00-18:00
Grace: 15 minutes
Leave: none
Holiday/weekoff: none
Final status: Present
Payroll LWP: 0
```

## Backend implementation phases

### Phase B1: Read-only diagnostics

- Add COSEC sync health endpoint.
- Add reconciliation endpoint.
- Add agent attendance view endpoint.
- Add adherence summary endpoint.

No existing attendance calculation should be changed in this phase.

### Phase B2: Materialization

- Scheduled COSEC SQL Server pull.
- Store raw/source data.
- Materialize into `integration_biometric_daily`.
- Run `attendanceEngineService`.
- Write `attendance_daily_record` only when not locked.

### Phase B3: UI integration

- Adherence Command Center page.
- Agent View page.
- My Attendance Report enhancement.
- Attendance query button.

### Phase B4: Payroll protection

- Attendance snapshot lock.
- Payroll mismatch report.
- Maker-checker exception approval.
- Export audit.

## Validation checklist

### API validation

```bash
curl /api/wfm/biometric-punch
curl /api/wfm/attendance/daily
curl /api/wfm/biometric-reconciliation
curl /api/reports
```

### DB validation

```sql
SELECT COUNT(*) FROM integration_biometric_daily;
SELECT COUNT(*) FROM attendance_daily_record;
SELECT COUNT(*) FROM attendance_regularization;
SELECT COUNT(*) FROM salary_prep_line WHERE lwp_days > 0;
```

### UI validation

- `/attendance`
- `/profile?tab=attendance`
- `/wfm/roster`
- `/wfm/live-tracker`
- `/wfm/auto-roster`
- `/rta-board`
- `/reports`

## What not to import from Biometric

Do not import:

- hardcoded SQL Server host/user/password values
- JWT secrets
- separate auth model that bypasses HRMS1 access control
- duplicate employee master
- duplicate leave/payroll system
- duplicate helpdesk system

Use Biometric only as a reference for attendance-focused calculations and dashboards.

## Final recommendation

Treat Biometric as a specialized attendance intelligence micro-module. HRMS1 should absorb the concepts, not the codebase. The safest first addition is a read-only Adherence Command Center backed by `integration_biometric_daily`, `attendance_daily_record`, `employees`, `wfm_roster_assignment`, and `leave_request`. Once validated, connect it to payroll LWP and manager/TL approvals.
