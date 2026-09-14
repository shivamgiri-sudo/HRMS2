# Requirements Document

## Introduction

The HRMS reporting module already implements a report under the code `attendance-register-monthly` ("Attendance Register") that is intended to reproduce the legacy MAS Callnet spreadsheet-style Attendance Register: one row per active employee, a fixed block of identity/org columns, one column per calendar day of the selected month carrying a single-letter attendance status code (P/A/HD/L/H/W/OD), and a trailing block of per-status summary counts.

The report is implemented across three layers that must agree with each other and with the legacy format:

- **Frontend column catalog** — `src/lib/report-catalog.ts` (`REPORT_CATALOG` entry for `attendance-register-monthly`), which declares the column keys, labels, formats and order the grid/export renders.
- **Backend column catalog** — `backend/src/modules/reporting/report-catalog.ts` (`REPORT_CATALOG` entry for `attendance-register-monthly`), which declares role-based access control, source tables and a partial column list (the day columns are generated dynamically and are not individually declared there).
- **Executor** — `backend/src/modules/reporting/executors/attendance.executor.ts`, function `attendanceRegisterMonthly`, which queries `attendance_daily_record` joined to `employees` and related master tables, pivots the day-wise rows into `day_1`..`day_31` keys per employee, computes the per-status summary counts, and paginates the result.

This spec covers validating and correcting the **format** of this existing report against the legacy layout and against real data in the `mas_hrms` database (staging host `122.184.128.90`, credentials already configured in `backend/.env`). It is explicitly a format/column validation and correction effort, not a general data-quality remediation project. Two decisions have already been made and are treated as fixed constraints throughout this spec:

1. The `Billable` column's current data source (`employees.is_billable`, a column default that is `1` on all rows and is never meaningfully populated — see `backend/sql/1065_billability_seat_cost.sql`) is kept exactly as-is. This is a known, pre-existing limitation being carried forward intentionally, not a defect this spec fixes.
2. The summary column set (`A`, `P`, `OD`, `HD/DH/FTP`, `L`, `H`, `W`, `SalDays`, `Total`) stays as currently implemented. It is not reduced or reinterpreted to match a narrower reading of the legacy screenshot.

## Glossary

- **Attendance Register**: The report identified by code `attendance-register-monthly`, rendering one row per active employee with day-wise attendance columns for a selected month.
- **Day-wise pivot**: The transformation performed by the executor that turns per-day `attendance_daily_record` rows into `day_1`..`day_31` keys on a single per-employee row.
- **Status code**: The single-letter/abbreviation value shown in a day column - `P` (present), `A` (absent), `HD` (half day), `L` (leave approved), `H` (holiday), `W` (week off), `OD` (on duty).
- **SalDays**: The computed salary days summary value, equal to present_count + half_day_count * 0.5 + on_duty_count + holiday_count + week_off_count.
- **Billable column**: The `Billable` column sourced from `employees.is_billable`, documented in this spec as carrying a known, unremediated data-quality limitation.
- **Catalog parity**: Agreement between the frontend column catalog, the backend column catalog, and the executor's actual row output for the same report code.
- **Worker mode / preview mode**: The two execution modes in ExecOptions.mode - worker returns the full unsliced result for export, while preview mode (offset/limit) returns a page for on-screen display.

## Requirements

### Requirement 1: Column presence and order match the legacy format

**User Story:** As an HR operations user who relies on the Attendance Register to reconcile payroll and attendance, I want the report's columns to appear in the same order and with the same identity as the legacy spreadsheet format, so that the report can be used as a drop-in replacement without retraining or re-mapping columns.

#### Acceptance Criteria

1. WHEN the Attendance Register is rendered or exported THEN the system SHALL present columns in the following order: `SNo`, `EmpCode`, `BioCode`, `EmpName`, `Department`, `Designation`, `Profile`, `CostCenter`, `EmpLocation`, `Billable`, followed by one column per calendar day of the selected month, followed by the summary columns `A`, `P`, `OD`, `HD/DH/FTP`, `L`, `H`, `W`, `SalDays`, `Total`.
2. WHEN the frontend column catalog (`src/lib/report-catalog.ts`) and the backend executor's row output are compared THEN every column key declared in the frontend catalog SHALL have a corresponding value in the executor's output, and every value the executor emits per row SHALL have a corresponding declared column (no silently dropped or silently blank columns).
3. IF a discrepancy is found between the frontend catalog's declared columns and the executor's actual output for this report THEN the system SHALL be corrected so the two agree, preserving the column order specified in Criterion 1.
4. WHEN the report is generated for any valid month and employee scope THEN the system SHALL include the `Profile` column sourced from the employee's profile/employment type, matching the legacy format's `Profile` column, even though this column is not currently declared in the backend catalog's partial column list.

### Requirement 2: Day-wise attendance status codes are correct against real data

**User Story:** As a QA reviewer validating the Attendance Register before it replaces the legacy report, I want the day-wise status codes (P/A/HD/L/H/W/OD) to be verified against real attendance records in the `mas_hrms` database, so that the report can be trusted to reflect actual employee attendance rather than only being verified for code correctness.

#### Acceptance Criteria

1. WHEN the executor's status-to-code mapping (`present`→P, `absent`→A, `half_day`→HD, `week_off`→W, `holiday`→H, `leave_approved`→L, `on_duty`→OD, `unreconciled`→A) is applied to a real month of `attendance_daily_record` data in `mas_hrms` THEN the resulting day codes SHALL be spot-checked against the known attendance history of a sample of specific real employees for that month, and any mismatch SHALL be documented as a finding.
2. WHEN a real month and branch/process scope is selected for validation THEN the system SHALL confirm, by direct query against the staging `mas_hrms` database, that the number of days marked with each status code for a sampled employee matches that employee's actual attendance records for the month.
3. IF an employee has no `attendance_daily_record` row for a given day in the selected month THEN the corresponding day column SHALL render as an empty value (not a fabricated status code), consistent with the executor's current pivot logic.
4. WHEN validation identifies a mismatch between the executor's SQL/status-mapping logic and the real attendance data THEN the mismatch SHALL be documented with the specific employee, date, expected status, and actual rendered status, so it can be triaged as either a mapping defect or a data-quality issue outside this spec's scope.

### Requirement 3: Day column headers show actual calendar dates

**User Story:** As an HR operations user reading the Attendance Register for a specific month, I want each day column's header to show the actual calendar date in "Mon-DD" format (e.g. "Jul-01") rather than a generic "Day 1", "Day 2" label, so that I can read the report without cross-referencing a separate calendar to know which date each column represents.

#### Acceptance Criteria

1. WHEN the Attendance Register is rendered or exported for a selected month THEN each day column's header SHALL display ONLY the actual calendar date for that column in the exact format "Mon-DD" (three-letter month abbreviation, hyphen, two-digit day, for example "Jul-01", "Jul-02", "Jul-03" ... "Jul-31"). The header text SHALL NOT contain the literal words "Day 1", "Day 2", or any generic "Day N" label -- the generic Day-N labels currently declared in the frontend catalog SHALL be removed entirely and replaced with "Mon-DD" date labels, not shown alongside them.
2. WHEN the selected month changes THEN the day column headers SHALL update to reflect the calendar dates of the newly selected month, since the underlying `day_1`..`day_31` data keys are month-agnostic but their displayed labels must reflect the actual dates.
3. WHEN the investigation determines whether column labels are static catalog metadata or must be computed per request THEN the system SHALL implement date-aware label generation at whichever layer(s) are necessary (frontend rendering, backend response metadata, or both) so that both the on-screen preview and the exported file show correct calendar-date headers.
4. IF a month has fewer than 31 days THEN the system SHALL NOT render day columns beyond the last actual date of that month (e.g. no "31" column header for a 30-day month), consistent with the executor's existing `daysInMonth` handling.
5. WHEN the exported file (e.g. XLSX) is opened THEN the day column headers in the exported file SHALL match the day column headers shown in the on-screen preview for the same month.

### Requirement 4: Billable column limitation is documented, not remediated

**User Story:** As a product owner scoping this validation effort, I want the known limitation in the `Billable` column's data source to be explicitly documented as an accepted constraint, so that future readers of the report or this spec do not mistake the unpopulated `is_billable` flag for an unnoticed defect.

#### Acceptance Criteria

1. WHEN the Attendance Register's `Billable` column is validated THEN the system SHALL continue to source its value from `employees.is_billable` via the existing `CASE WHEN COALESCE(e.is_billable, 1) = 1 THEN 'Yes' ELSE 'No' END` logic, unchanged.
2. WHEN this validation effort is documented THEN the system SHALL record that `employees.is_billable` is a column default that reads `1` on effectively all rows and is not populated with meaningful billability data, and that this is a known, pre-existing, and intentionally accepted limitation.
3. IF a future spec or task proposes re-sourcing the `Billable` column from a different table or field (e.g. the `billability_seat_cost`-related tables) THEN that change SHALL be treated as out of scope for this spec and tracked separately.

### Requirement 5: Summary columns are validated as currently implemented

**User Story:** As a QA reviewer, I want the existing summary columns (A, P, OD, HD/DH/FTP, L, H, W, SalDays, Total) to be validated for correctness against real attendance data without changing which summary columns exist, so that the report's totals can be trusted without altering its current scope.

#### Acceptance Criteria

1. WHEN the Attendance Register is validated THEN the summary column set SHALL remain exactly `A`, `P`, `OD`, `HD/DH/FTP`, `L`, `H`, `W`, `SalDays`, `Total`, matching the current frontend catalog declaration.
2. WHEN a sampled employee's summary counts are computed by the executor for a real month THEN each summary count SHALL be independently verified (by direct query or manual tally against that employee's day-wise codes for the month) to equal the count of matching day codes, and `SalDays` SHALL be verified to equal `present_count + half_day_count * 0.5 + on_duty_count + holiday_count + week_off_count` as implemented.
3. IF a summary column's computed value does not match an independent tally for a sampled employee THEN the mismatch SHALL be documented as a finding with the employee, month, and expected vs. actual values.
4. WHEN validating summary columns THEN the system SHALL NOT add, remove, or rename any summary column beyond what is currently implemented, even if the legacy screenshot could be read as implying a narrower or different set.

### Requirement 6: Existing pagination and export behavior is preserved

**User Story:** As a user relying on the Attendance Register's export to download the full register for a month, I want the report's existing pagination and export behavior to continue working exactly as it does today, so that this validation effort does not regress a feature that was already fixed.

#### Acceptance Criteria

1. WHEN the Attendance Register is exported via worker mode THEN the system SHALL continue to return every employee row for the selected month in a single export, without applying page-based slicing, as currently implemented.
2. WHEN the Attendance Register is previewed on screen with a given `limit` and `offset` THEN the system SHALL continue to return the correctly sliced subset of the full pivoted row set, with `SNo` values reflecting each row's position in the whole register rather than restarting at 1 per page.
3. WHEN any format or column change from Requirements 1–5 is implemented THEN the system SHALL NOT alter the pagination slicing logic (`options.mode === "worker"` vs. offset/limit slicing) in `attendanceRegisterMonthly`, unless a regression is found and explicitly documented as a separate fix.
4. WHEN the report is exported after any changes made under this spec THEN the exported row count for a given month and scope SHALL match the on-screen `rowCount` for the same month and scope.

### Requirement 7: Role-based access control remains unchanged

**User Story:** As a security-conscious administrator, I want the Attendance Register's view and export permissions to remain exactly as currently configured, so that this format validation effort does not inadvertently widen or narrow who can see or export attendance data.

#### Acceptance Criteria

1. WHEN the Attendance Register's format is validated and corrected under this spec THEN the backend catalog's `viewRoles` and `exportRoles` for the `attendance-register-monthly` entry SHALL remain unchanged from their current values.
2. WHEN the Attendance Register's format is validated and corrected under this spec THEN the frontend catalog's `viewRoles` and `exportRoles` for the `attendance-register-monthly` entry SHALL remain unchanged from their current values.
3. IF any code change under this spec incidentally touches the role arrays for this report THEN the change SHALL be reverted or corrected so the role arrays are byte-for-byte identical to their pre-change values, unless a role-related defect is explicitly identified and separately confirmed with the user.
