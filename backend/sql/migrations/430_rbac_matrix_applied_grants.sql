-- Tracks exactly which (role_key, page_code) grants were written by
-- scripts/apply-rbac-page-matrix.mjs, so a later run can tell "the matrix
-- stopped listing this" apart from "someone else granted this by hand."
--
-- Before this table existed, the applier's --allow-revoke path deactivated
-- ANY active grant absent from today's matrix, regardless of who granted it.
-- Measured 2026-08-18: 63 live grants across 21 roles (PAYROLL_BANK_READINESS,
-- PAYROLL_PF_MANAGEMENT, FINANCE_PNL_CONFIG, ATTENDANCE_RULES_MASTER, etc.)
-- were "not in the matrix" and would have been silently revoked.
--
-- Starts empty. A grant is only ever a revocation candidate once this same
-- tool has recorded applying it — nothing that already exists in
-- role_page_access today is at risk from this table's introduction.
CREATE TABLE IF NOT EXISTS rbac_matrix_applied_grants (
  role_key VARCHAR(64) NOT NULL,
  page_code VARCHAR(128) NOT NULL,
  first_applied_at DATETIME NOT NULL,
  last_applied_at DATETIME NOT NULL,
  PRIMARY KEY (role_key, page_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
