# HRMS Reports Dictionary — Production Source of Truth

**Version:** 1.0  
**Date:** 2026-07-22  
**Status:** Production  

---

## Overview

The Reports Center provides a comprehensive, role-based reporting platform covering all major HR, Payroll, Attendance, Operations, and Statutory domains.

### Architecture

| Layer | Component | Description |
|-------|-----------|-------------|
| Frontend | `src/pages/NativeReportsCenterV2.tsx` | Main UI — RBAC-filtered catalog, pagination, export |
| Frontend Catalog | `src/lib/report-catalog.ts` | Column definitions, RBAC roles per report |
| Backend Routes | `backend/src/modules/reporting/report-suite.routes.ts` | SQL queries, export handling |
| Backend Catalog | `backend/src/modules/reporting/report-catalog.ts` | Full definitions with source tables, calculation notes |

### Key Features

1. **Server-side pagination** — default 100 rows/page, total count always shown
2. **Full export** — `?export=true` removes all limits, exports complete filtered dataset
3. **RBAC at 4 levels** — route, catalog visibility, API, export
4. **Duplicate detection** — warns when row grain violation detected
5. **Type-aware formatting** — currency (₹), percentage (%), duration (HH:mm), masked PII
6. **Process & Branch filters** — on all applicable reports

---

## Report Categories

### 1. HR & Workforce
Reports covering employee master data, headcount, lifecycle events, and HR calendar.

| Report Code | Name | Row Grain | Primary Key |
|-------------|------|-----------|-------------|
| `headcount` | Active Headcount Summary | Per branch/dept/process | branch+dept+process |
| `employee-master` | Employee Master Export | Per employee | employee_code |
| `manager-mapping` | Manager Mapping Report | Per employee | employee_code |
| `org-structure-snapshot` | Org Structure Snapshot | Per org unit | branch+dept |
| `cost-centre-headcount` | Cost Centre Headcount | Per cost centre | cost_centre_name |
| `employee-movement` | New Joiners & Exits | Per movement event | employee_code+movement_type |
| `confirmation-due-list` | Confirmation Due List | Per employee | employee_code |
| `contract-expiry-list` | Contract Expiry List | Per employee | employee_code |
| `lifecycle-events` | Employee Lifecycle Events | Per event | employee_code+event_date+event_type |
| `increment-promotion-history` | Increment / Promotion History | Per event | employee_code+effective_date |
| `birthday-list` | Birthday List | Per employee | employee_code |
| `anniversary-list` | Work Anniversary List | Per employee | employee_code |

---

### 2. Attendance
Day-wise and monthly attendance reports, exception handling, BPO shrinkage metrics.

#### Daily Reports

| Report Code | Name | Row Grain | Source Tables |
|-------------|------|-----------|---------------|
| `attendance-daily` | Daily Attendance Report | Per employee per date | `attendance_daily_record`, `wfm_attendance_session`, `wfm_roster_assignment`, `wfm_shift_master` |
| `daily-hc-shift` | Daily Headcount by Shift | Per date per branch per process per shift | `attendance_daily_record`, `wfm_roster_assignment` |
| `shift-adherence-detail` | Shift Adherence Detail | Per employee per date | `attendance_daily_record`, `wfm_attendance_session`, `wfm_roster_assignment` |

**Key Calculations:**
- **Punch In/Out**: From `wfm_attendance_session.login_time / logout_time`
- **Total Login Hours**: `TIMESTAMPDIFF(MINUTE, login_time, logout_time)` formatted as HH:mm
- **Late Minutes**: `GREATEST(0, punch_in - shift_start - grace_minutes)`
- **Adherence %**: `(actual_within_shift_minutes / scheduled_shift_minutes) × 100`
- **Shift**: From date-specific `wfm_roster_assignment` — shows "Roster Not Assigned" when missing

#### Monthly Reports

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `attendance-summary` | Monthly Attendance Summary | Per employee per month |
| `attendance-register-grid` | Monthly Attendance Register Grid | Per employee (day-wise grid) |
| `late-arrival-summary` | Late Arrival Summary | Per employee per late date |
| `overtime-summary` | Overtime Summary | Per employee per month |

**Late Arrival**: Only includes records where `late_by_minutes > 0` (after grace period).  
**Overtime**: `actual_minutes - scheduled_shift_minutes` when positive. Based on approved attendance rules.

#### Exception Reports

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `regularization-summary` | Regularization Summary | Per regularization request |
| `attendance-dispute-summary` | Attendance Dispute Summary | Per dispute request |
| `habitual-absentee-list` | Habitual Absentee / Late List | Per employee (meeting threshold) |
| `biometric-reconciliation` | Biometric Reconciliation | Per employee per date |

**Regularization vs Dispute**: Disputes are regularizations where `dispute_type IS NOT NULL`.  
**Biometric Reconciliation statuses**: OK, NO_BIOMETRIC_FOR_PRESENT, PUNCHED_BUT_ABSENT.

#### BPO Metrics

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `daily-shrinkage-report` | Daily Shrinkage Report | Per date per branch per process |
| `monthly-shrinkage-trend` | Monthly Shrinkage Trend | Per month per branch per process |
| `punch-raw-export` | Punch Raw Data Export | Per employee per date |

**Shrinkage Formulas:**
- **Total Shrinkage %** = `(Scheduled - Present) / Scheduled × 100`
- **Unplanned Shrinkage %** = `Absent_HC / Scheduled × 100` (excludes leave, WO, holiday)
- **3-Month Moving Average** available in monthly trend report

---

### 3. Leave

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `leave-balance` | Leave Balance Report | Per employee per leave type |
| `leave-allocation-register` | Leave Allocation Register | Per employee per leave type per year |
| `leave-utilization` | Leave Utilization Report | Per leave request |
| `leave-trend-monthly` | Leave Trend (Monthly) | Per month per leave type |
| `leave-lwp-reconciliation` | Leave vs LWP Reconciliation | Per employee per month |
| `maternity-paternity-register` | Maternity / Paternity Register | Per leave request |
| `leave-encashment-register` | Leave Encashment Register | Per encashment request |
| `leave-lapse-summary` | Leave Lapse Summary | Per employee per leave type |
| `holiday-master-list` | Holiday Master List | Per holiday |

---

### 4. Payroll

| Report Code | Name | Row Grain | Notes |
|-------------|------|-----------|-------|
| `payroll-register` | Salary Register | Per employee per payroll month | Requires finalized run |
| `payroll-variance` | Payroll Variance Report | Per employee | Compares current vs previous month |
| `salary-sheet-onfido` | Salary Sheet (Onfido Format) | Per employee | Direct download |
| `bank-advice` | Bank Advice / Transfer Sheet | Per employee | Sensitive — limited roles |
| `payroll-reconciliation` | Payroll Reconciliation | Per employee | Compares attendance days vs payroll days |
| `arrear-payment-register` | Arrear Payment Register | Per employee per arrear type | — |

**Deduplication Note**: Salary Register uses `GROUP BY employee_id, run_id` to prevent duplication from multiple `salary_prep_line_component` rows.

---

### 5. Statutory

| Report Code | Name | Statutory Domain |
|-------------|------|-----------------|
| `pf-contribution-register` | PF Contribution Register | EPF/PF |
| `pf-ecr-format` | PF ECR Format Export | EPF — portal upload format |
| `esic-contribution-register` | ESIC Contribution Register | ESIC |
| `pt-register` | Professional Tax Register | PT |
| `tds-computation-register` | TDS Computation Register | Income Tax |
| `form-16-status` | Form 16 Status | Income Tax |
| `investment-declaration-status` | Investment Declaration Status | Income Tax |
| `gratuity-liability-register` | Gratuity Liability Register | Gratuity Act |

**PF Calculation Notes:**
- Employee PF = 12% of PF Basic (capped at ₹15,000 basic)
- Employer PF = 12% (split as EPS 8.33% + EPF Diff 3.67%)
- NCP Days = LWP days in the month

---

### 6. Exit & Separation

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `resignation-register` | Resignation Register | Per resignation request |
| `fnf-pending-register` | F&F Pending Register | Per employee |
| `fnf-settlement-register` | F&F Settlement Register | Per settlement |
| `clearance-status-register` | Clearance Status Register | Per employee per dept |

---

### 7. Attrition & Trends

| Report Code | Name | Key Calculation |
|-------------|------|----------------|
| `monthly-attrition-summary` | Monthly Attrition Summary | Attrition % = Exits / Avg HC × 100 |
| `exit-reason-analysis` | Exit Reason Analysis | Count by reason category |
| `tenure-distribution` | Tenure Distribution Report | Bands: 0-3m, 3-6m, 6-12m, 1-2y, 2-5y, 5+ |
| `early-attrition-report` | Early Attrition Report | Exits where tenure ≤ 90 days |

---

### 8. Recruitment

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `recruitment-pipeline` | Recruitment Pipeline Report | Per stage per job |
| `candidate-tracker` | Candidate Tracker | Per candidate |
| `source-effectiveness` | Source Effectiveness Report | Per source |
| `recruiter-productivity` | Recruiter Productivity Report | Per recruiter |
| `offer-tracker` | Offer Tracker | Per offer |
| `joining-pending` | Pending Joinings | Per candidate |

---

### 9. Operations & Quality

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `agent-performance-summary` | Agent Performance Summary | Per agent per month |
| `team-performance-summary` | Team Performance Summary | Per team per month |
| `quality-audit-log` | Quality Audit Log | Per audit |
| `fatal-error-register` | Fatal Error Register | Per fatal error |

---

### 10. WFM & Roster

| Report Code | Name | Row Grain |
|-------------|------|-----------|
| `roster-published` | Published Roster Report | Per employee per date |
| `roster-variance` | Roster vs Actual Variance | Per employee per date |
| `shift-swap-register` | Shift Swap Register | Per swap request |
| `week-off-calendar` | Week Off Calendar | Per employee per week |

---

### 11. Assets

| Report Code | Name |
|-------------|------|
| `asset-inventory` | Asset Inventory Report |
| `asset-allocation-register` | Asset Allocation Register |
| `asset-movement-log` | Asset Movement Log |

---

### 12. Training (LMS Integration)

> Data synced from deployed LMS via integration layer. HRMS provides read-only visibility.

| Report Code | Name |
|-------------|------|
| `training-completion-status` | Training Completion Status |
| `certification-status` | Certification Status |
| `training-batch-summary` | Training Batch Summary |

---

### 13. Documents

| Report Code | Name |
|-------------|------|
| `document-expiry-tracker` | Document Expiry Tracker |
| `document-verification-status` | Document Verification Status |
| `missing-documents-report` | Missing Documents Report |

---

### 14. Identity

> Sensitive — limited to compliance and finance roles.

| Report Code | Name |
|-------------|------|
| `uan-status-report` | UAN Status Report |
| `esic-status-report` | ESIC Status Report |
| `pan-verification-status` | PAN Verification Status |
| `bank-account-verification` | Bank Account Verification Status |
| `identity-source-snapshot` | Identity Source Snapshot |

---

## RBAC Matrix

| Role | HR Reports | Attendance | Payroll | Statutory | ATS | Operations |
|------|-----------|-----------|---------|-----------|-----|------------|
| super_admin | All | All | All | All | All | All |
| admin | All | All | All | All | All | All |
| hr / hr_head | Yes | Yes (view) | No | Limited | Yes | No |
| finance / payroll | No | No | All | All | No | No |
| wfm | No | All | No | No | No | No |
| manager / process_manager | Partial | Own process | No | No | No | Own process |
| branch_head | Partial | Own branch | No | No | No | No |
| ceo | Summary only | Summary only | Summary only | Summary only | No | Summary only |
| operations / quality | No | No | No | No | No | All |
| recruiter | No | No | No | No | All | No |
| trainer | No | No | No | No | No | Training only |

---

## Sensitive Fields Policy

The following fields are masked (`****1234`) unless the user has explicit export authorization:

- Bank Account Number
- PAN Card Number
- Aadhaar Number  
- Passport Number
- Driving License Number

Salary/CTC data is restricted to `finance`, `payroll`, `hr_head`, `super_admin`, `admin` only.

---

## Export Behavior

| Parameter | Behavior |
|-----------|----------|
| `?export=true` | Full dataset, no limit — all filtered rows |
| `?limit=100&offset=0` | Paginated screen view (default) |
| `?limit=0` | All rows (equivalent to export) |

Export files are named: `{report-code}_{YYYY-MM-DD}.xlsx`

Export includes:
- Formatted values (not raw DB values)
- All columns in defined order
- Consistent with screen display

---

## Source of Truth Declaration

| Domain | Authoritative Source | Source Table |
|--------|---------------------|--------------|
| Employee Identity | Employee Master | `employees` |
| Daily Attendance Status | Attendance Processing | `attendance_daily_record` |
| Punch Times | WFM Session | `wfm_attendance_session` |
| Roster / Shift | WFM Roster | `wfm_roster_assignment` |
| Payroll Results | Payroll Run | `salary_prep_line` |
| Leave Balance | Leave Ledger | `leave_balance_ledger` |
| Training / Certification | LMS Integration Sync | `lms_learner_progress`, `lms_certification_status` |

No report derives final business data without tracing to one of the above authoritative sources.
