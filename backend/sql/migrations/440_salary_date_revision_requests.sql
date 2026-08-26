-- 440_salary_date_revision_requests.sql
-- Salary Date Sync Feature: Employee salary date revision requests table
-- Allows employees/HR to request changes to salary date effective_from
-- with approval workflow support

CREATE TABLE IF NOT EXISTS employee_salary_date_revision_requests (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  current_effective_from   DATE NOT NULL,
  requested_effective_from DATE NOT NULL,
  reason                   TEXT NOT NULL,
  status                   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by             CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  reviewed_by              CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
  reviewed_at              DATETIME NULL,
  review_remarks           TEXT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_esdrr_employee (employee_id),
  INDEX idx_esdrr_status (status)
);

-- ── WHY THE ID COLUMNS ARE CHAR(36) AND NOT INT ──────────────────────────────
-- This migration was never in the manifest, so it had never run and the table did not
-- exist: /api/salary-revision returned 500 on every call
-- ("Table 'mas_hrms.employee_salary_date_revision_requests' doesn't exist"), which is the
-- Payroll Head Salary Review Queue page. Adding the manifest entry alone would have created
-- the table AS WRITTEN, and it was written wrong:
--
--   requested_by / reviewed_by were INT, but they hold auth_user.id, which is CHAR(36) on
--   this database (verified 2026-08-27, as is employees.id). salary-revision.service.ts says
--   so itself -- `requested_by: string; // auth_user.id (string in this codebase)` -- and the
--   route passes String(req.authUser!.id). With sql_mode including STRICT_TRANS_TABLES, every
--   INSERT would have hard-errored on the UUID rather than coercing, and
--   `LEFT JOIN auth_user au ON au.id = r.requested_by` could never have matched, so
--   requested_by_email would always be ''.
--
-- That would have turned one loud 500 into a table that reads fine and refuses every write.
-- Collation is stated explicitly because a new table otherwise takes the server default and
-- joins to employees(id)/auth_user(id) then fail on mismatched collation -- both are
-- utf8mb4_unicode_ci here.
--
-- Safe to (re-)apply: CREATE TABLE IF NOT EXISTS, and the table does not exist in production.
