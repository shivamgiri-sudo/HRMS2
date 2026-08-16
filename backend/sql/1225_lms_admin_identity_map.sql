-- 1225_lms_admin_identity_map.sql
--
-- Per-person LMS administrator identity (owner ruling 2026-08-16, decision 7).
--
-- Today resolveDirectLmsIdentity() in lms.routes.ts picks the LMS admin account with
--   ORDER BY CASE WHEN admin_id = 'LMS-ADMIN' THEN 0 ELSE 1 END, created_at ASC LIMIT 1
-- which always returns the shared 'LMS-ADMIN' account when it is active. Every HRMS admin who
-- launches the LMS therefore acts as one identity: the LMS's own audit_log, login_session_log and
-- content-change history record "LMS Admin" no matter who was actually at the keyboard. Verified
-- read-only against the LMS database 2026-08-16 — four real named administrators exist and are
-- active (Shivamgiri, hk_entrust, sachin.ahuja1, ashwaniwadhwa) and none of them is ever selected.
--
-- The LMS is a protected, independently deployed system and its admin_user_master carries no
-- employee_code or email column to join on, so the mapping is held here, on the HRMS side, and the
-- LMS schema is not touched. This mirrors how the LMS already stores branch_hrms_id against an
-- admin: HRMS identifiers crossing into LMS records is an established pattern here.
--
-- Deliberately empty on creation. Which HRMS person corresponds to which LMS admin account is a
-- fact only the LMS administrator holds, and a wrong row hands one person another person's
-- administrative identity — the exact defect this closes. It is not inferred from name similarity.
-- Until a row exists the launch refuses with LMS_IDENTITY_NOT_MAPPED, the same way the coordinator
-- and trainee resolvers already do.
--
-- Additive: one CREATE TABLE IF NOT EXISTS, no FK (avoids both FK-ordering on a rebuilt database
-- and the utf8mb4_unicode_ci collation mismatch that FKs to employees(id) trip on), no DROP,
-- no DELETE, re-runnable.

CREATE TABLE IF NOT EXISTS lms_admin_identity_map (
  id CHAR(36) NOT NULL,

  -- Employee code rather than a user_id: it is what an LMS administrator can actually read off an
  -- HRMS profile when populating this, and it is what the coordinator and trainee resolvers match on.
  -- VARCHAR(50) mirrors employees.employee_code exactly (verified live 2026-08-16; longest code in
  -- use is 11 characters, so a narrower column would fit today and truncate silently later).
  hrms_employee_code VARCHAR(50) NOT NULL,

  -- The admin_user_master.admin_id this person signs in to the LMS as. Existence and active state
  -- are re-checked against the LMS at launch, so a stale row here cannot mint a session.
  lms_admin_id VARCHAR(100) NOT NULL,

  active TINYINT(1) NOT NULL DEFAULT 1,
  mapped_by VARCHAR(100) NULL COMMENT 'HRMS user_id of whoever recorded this mapping',
  mapped_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  remarks TEXT NULL,

  PRIMARY KEY (id),

  -- One LMS identity per person, and one person per LMS identity. The second half is the control
  -- that matters: without it, two HRMS admins could be pointed at the same LMS account and the
  -- shared-identity problem would simply come back through the mapping table.
  UNIQUE KEY uq_lms_admin_map_employee (hrms_employee_code),
  UNIQUE KEY uq_lms_admin_map_admin (lms_admin_id),
  KEY idx_lms_admin_map_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
