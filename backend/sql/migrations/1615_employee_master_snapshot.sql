-- Migration 1615: employee_master_snapshot — auto-refreshed materialized copy of the
-- Employee Master Export report (the 73-column legacy ExportEmployeeDetails format).
--
-- Why this exists: the employee-master report already computes the full 73-column row by
-- joining mas_hrms live tables AND two db_bill (legacy) tables (masjclrentry, employee_master)
-- as fallbacks for fields mas_hrms itself barely populates (see employee.executor.ts,
-- enrichWithLegacyMaster()). That computation is correct but not cheap — it re-runs every
-- source query and both cross-database fallback fetches on every request. This table lets a
-- background job (see cron/employee-master-snapshot.cron.ts) compute it once on a schedule and
-- have the export simply read a plain table.
--
-- Column set mirrors report-catalog.ts's "employee-master" columns exactly, plus employee_code
-- as the natural key and snapshot_refreshed_at for staleness visibility.
--
-- All data columns are TEXT, not sized VARCHAR: the first live population run hit
-- ER_DATA_TOO_LONG on a VARCHAR(30) landline column — db_bill's legacy text fields carry
-- unpredictable garbage lengths (matches the already-documented Excel-mangled-data issue on
-- bank fields), so guessing a "safe" width for free-text legacy data is a trap. This is a
-- reporting cache table, not a hot-path OLTP table, so TEXT's storage/index cost is
-- negligible. The two indexes that exist use explicit prefix lengths since MySQL requires
-- that on TEXT columns.
--
-- Purely additive (new table). Idempotent via CREATE TABLE IF NOT EXISTS.
-- Author: Claude Code, 2026-09-11

CREATE TABLE IF NOT EXISTS employee_master_snapshot (
  employee_code             VARCHAR(50)  NOT NULL PRIMARY KEY,
  biometric_code            TEXT NULL,
  employment_type           TEXT NULL,
  employee_name             TEXT NULL,
  father_husband_name       TEXT NULL,
  father_husband_relation   TEXT NULL,
  gender                    TEXT NULL,
  nominee_name              TEXT NULL,
  nominee_relation          TEXT NULL,
  nominee_dob               TEXT NULL,
  date_of_birth             TEXT NULL,
  date_of_joining           TEXT NULL,
  designation_name          TEXT NULL,
  billable_status           TEXT NULL,
  department_name           TEXT NULL,
  emp_for                   TEXT NULL,
  profile_type              TEXT NULL,
  branch_name               TEXT NULL,
  cost_centre_name          TEXT NULL,
  qualification             TEXT NULL,
  qualification_details     TEXT NULL,
  passed_out_year           TEXT NULL,
  passed_out_state          TEXT NULL,
  passed_out_city           TEXT NULL,
  passed_out_percentage     TEXT NULL,
  working_experience        TEXT NULL,
  experience_years          TEXT NULL,
  marital_status            TEXT NULL,
  family_annual_income      TEXT NULL,
  count_of_dependents       TEXT NULL,
  reporting_manager         TEXT NULL,
  reporting_manager_mobile  TEXT NULL,
  blood_group               TEXT NULL,
  permanent_address_line1   TEXT NULL,
  permanent_city            TEXT NULL,
  permanent_state           TEXT NULL,
  permanent_pincode         TEXT NULL,
  current_address_line1     TEXT NULL,
  current_city              TEXT NULL,
  current_state             TEXT NULL,
  current_pincode           TEXT NULL,
  contact_number            TEXT NULL,
  permanent_landline        TEXT NULL,
  temporary_mobile          TEXT NULL,
  temporary_landline        TEXT NULL,
  email                     TEXT NULL,
  document_done             TEXT NULL,
  gross                     TEXT NULL,
  ctc_offered               TEXT NULL,
  net_in_hand               TEXT NULL,
  bank_account_number       TEXT NULL,
  ifsc_code                 TEXT NULL,
  bank_name                 TEXT NULL,
  bank_branch               TEXT NULL,
  passport_no               TEXT NULL,
  dl_no                     TEXT NULL,
  uan_number                TEXT NULL,
  epf_number                TEXT NULL,
  pf_eligible               TEXT NULL,
  esi_number                TEXT NULL,
  esi_eligible              TEXT NULL,
  entry_date                TEXT NULL,
  status                    TEXT NULL,
  date_of_leaving           TEXT NULL,
  left_remarks              TEXT NULL,
  source_type               TEXT NULL,
  source                    TEXT NULL,
  box_file_no               TEXT NULL,
  aadhaar_number            TEXT NULL,
  pan_number                TEXT NULL,
  work_status               TEXT NULL,
  manual_update_by          TEXT NULL,
  manual_update_date        TEXT NULL,
  snapshot_refreshed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ems_status (status(50)),
  INDEX idx_ems_branch (branch_name(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
