# HRMS1 Schema Deep Audit Notes

Source reviewed: `hrms1schema.sql` supplied for database `mas_hrms`.

## Schema scale

- Tables parsed: 400
- The database is enterprise-scale and covers HR core, ATS, WFM, attendance, leave, payroll, LMS, performance, engagement, compliance, integration, and audit/security.

## Major functional areas detected

| Area | Approx table count | Notes |
|---|---:|---|
| Compliance / Audit / Security | 72 | Access requests, account control logs, audit logs, compliance workflows |
| ATS / Hiring | 69 | Candidate, BGV, onboarding, offer, walk-in, branch head approvals |
| HR Core / Org Master | 61 | Employees, org masters, documents, lifecycle, journey, statutory data |
| Attendance / WFM | 41 | Attendance daily records, roster, adherence, biometric, shift governance |
| Performance / KPI | 36 | KPI, appraisal, feedback, goals, calculations |
| Payroll / Statutory | 29 | Salary prep, payslips, components, compliance, disbursement |
| Engagement | 14 | Badges, kudos, surveys, gamification |
| Integration | 13 | Connectors, field maps, raw payloads, schema snapshots |
| Leave | 10 | Leave request, balance ledger, holidays, policy config |
| LMS | 5 | Learning/training integration and mapping |

## Critical schema findings for current fixes

### 1. Profile photo upload

The `employees` table contains both:

- `photo_url`
- `avatar_url`

The frontend profile page uses `avatar_url`. The upload route was already writing `avatar_url`, but the frontend rendered a relative `/api/files/...` URL. In a Vite frontend running on another port, that can resolve against the frontend host instead of backend.

Fix added:

- `src/components/employee/PhotoUpload.tsx` now normalizes `/api/...` file URLs to the backend `API_BASE` for display.
- The upload component now handles non-JSON error responses safely.
- It now accepts `avatarUrl`, `photoUrl`, or `url` from the backend response.

Additional recommended backend follow-up:

- Keep `avatar_url` and `photo_url` synchronized during upload/delete for compatibility with old and new code.
- Use one canonical field long-term, preferably `avatar_url`, and deprecate `photo_url` after migration.

### 2. Attendance report table name

The real daily attendance table is:

- `attendance_daily_record`

Important columns:

- `employee_id`
- `record_date`
- `clock_in_time`
- `clock_out_time`
- `process_id`
- `branch_id`
- `attendance_source`
- `source_system`
- `dialler_minutes`
- `biometric_minutes`
- `raw_minutes`
- `attendance_status`
- `lwp_value`
- `late_mark`
- `late_by_minutes`
- `regularization_id`
- `override_by`
- `override_reason`
- `is_locked`
- `processed_at`

Report and attendance code should not query a generic `attendance_daily` table unless a view is created.

### 3. Leave balance table name

The real leave balance table is:

- `leave_balance_ledger`

Important columns:

- `employee_id`
- `leave_type_id`
- `balance_year`
- `allocated_days`
- `used_days`
- `adjusted_days`

Any leave balance report for 2026 must filter on `balance_year = 2026` and compute:

```sql
allocated_days + adjusted_days - used_days
```

### 4. Payroll component breakdown

The real payroll component table is:

- `salary_prep_line_component`

Important columns:

- `run_id`
- `line_id`
- `employee_id`
- `component_code`
- `component_name`
- `component_type`
- `amount`
- `source`
- `taxable`

Payslip and payroll report pages must use this table for component-level display. Do not silently show missing component values as confirmed zero.

### 5. Payroll run and line tables

Real payroll run table:

- `salary_prep_run`

Important columns:

- `run_month`
- `branch_filter`
- `process_filter`
- `status`
- `total_employees`
- `total_gross`
- `total_deductions`
- `total_net`
- `branch_id`
- `process_id`
- `financial_year`
- `attendance_snapshot_locked`
- `compliance_checked`
- `compliance_issues_count`

Real payroll line table:

- `salary_prep_line`

Important columns:

- `employee_id`
- `employee_code`
- `working_days`
- `present_days`
- `leave_days`
- `lwp_days`
- `gross_salary`
- `total_deductions`
- `net_salary`
- `pf_employee`
- `pf_employer`
- `esic_employee`
- `esic_employer`
- `professional_tax`
- `tds`
- `gross_before_lwp`
- `basic`
- `hra`
- `special_allowance`
- `manual_adjustment_total`
- `calculation_status`
- `calculation_version`

### 6. Employee reports

The `employees` table has the correct fields for accurate reporting:

- `date_of_joining`
- `date_of_exit`
- `date_of_leaving`
- `resignation_date`
- `employment_status`
- `active_status`
- `branch_id`
- `process_id`
- `cost_centre_id`
- `department_id`

Start-of-year active count should be calculated from date logic, not full table count:

```sql
SELECT COUNT(*)
FROM employees
WHERE active_status = 1
  AND date_of_joining <= '2026-01-01'
  AND (date_of_exit IS NULL OR date_of_exit >= '2026-01-01')
  AND LOWER(COALESCE(employment_status, 'active')) NOT IN ('terminated','inactive','offboarded','absconded');
```

Termination count should use:

```sql
WHERE date_of_exit IS NOT NULL
   OR date_of_leaving IS NOT NULL
   OR resignation_date IS NOT NULL
```

### 7. Documents and file access

Employee documents table:

- `employee_documents`

Important columns:

- `employee_id`
- `doc_type`
- `doc_category`
- `doc_name`
- `file_url`
- `verified`
- `uploaded_by`
- `expiry_date`
- `verified_by`
- `verification_date`
- `verification_remarks`

Document access log table:

- `employee_document_access_log`

This should be used for view/download/export access trails.

## New schema-aware validator

Added:

```bash
backend/scripts/validate-hrms1-live-schema.ts
```

Run locally:

```bash
cd backend
npx tsx scripts/validate-hrms1-live-schema.ts > ../hrms1-live-schema-validation.json
```

This validator checks actual HRMS1 table names and columns for:

- employees report fields
- profile photo columns
- attendance daily records
- leave balance ledger
- payroll component breakdown
- payroll run/line/payslip tables
- integration and access-control tables

## Next code fixes recommended

1. Update report backend routes to use `attendance_daily_record`, not `attendance_daily`.
2. Update leave balance reports to use `leave_balance_ledger.balance_year`.
3. Update payslip display to join `salary_prep_line_component` by `line_id`.
4. Update profile photo backend route to write both `avatar_url` and `photo_url` until old references are removed.
5. Add `employee_document_access_log` entries for document/profile photo downloads if required by compliance.
6. Add report export log for all payroll and employee reports.
