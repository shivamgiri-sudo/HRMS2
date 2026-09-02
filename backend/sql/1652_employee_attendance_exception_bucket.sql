-- 1652_employee_attendance_exception_bucket.sql
--
-- WHY
-- ---
-- Owner requirement, 2026-09-02: a small number of privileged employees (senior and field staff
-- who are on and off visiting outside) do not fit the standard COSEC rules, and the Payroll Head
-- needs to name them individually rather than describe them by department or designation.
--
-- Two concrete exceptions were asked for, and they are independent of each other:
--
--   1. "Even if single punch observed in COSEC it should be present."
--      Today a lone punch is not a short day — it is nothing at all. cosec-punch-interpretation
--      .service.ts's assessAggregatePunches() returns effectiveWorkingMinutes: 0 with
--      reason 'single_punch', that zero is what cosec-sync.service.ts writes to
--      wfm_attendance_session.total_login_minutes, and attendance-engine.service.ts then sees
--      rawMinutes === 0 and files the day as 'missing_punch' with lwp 0.00 pending review. For
--      someone who genuinely tapped in and then left the building on work, that is a day of pay
--      held hostage to a review queue every single time they travel.
--
--   2. "For few employee 8 hrs of COSEC instead of 9 hrs."
--      classifyCosecMinutes() hardcodes 540 minutes for a full day, identically for all 1,115
--      active employees. There is no way to say that one person's full day is 480.
--
-- WHY A NEW TABLE, AND NOT ONE OF THE FOUR THAT ALREADY EXIST
-- ----------------------------------------------------------
-- Every existing attendance config table is scoped by group, never by person:
--   * attendance_rule_config (044)      — designation_id / process_id / branch_id.
--   * apr_eligibility_config (1032)     — department_id / designation_id / process_id.
--   * attendance_source_rule_store (1633) and day_threshold_rule_store (1634) — cost_centre /
--     process / branch / department / designation / employment_profile, and both are documented
--     by their own service files as not yet wired into classification at all.
-- None of them can express "these four named people". Widening any of them to carry an
-- employee_id would change the resolution semantics of a table the live engine already reads,
-- for every row in it. A separate, additive table changes nothing that exists.
--
-- The shape is modelled on employee_statutory_override (290_pf_esic_optout.sql): a per-employee
-- flag table read by the calculation path, written only by an authorised role, audited.
--
-- WHAT CHANGES — one purely additive table, no existing table touched
-- ------------------------------------------------------------------
-- single_punch_counts_as_present and full_day_threshold_minutes are deliberately TWO columns and
-- not one 'is_exception' flag. The owner's requirement names two different populations ("even if
-- single punch observed... and for few employee 8 hrs"), so a combined flag would force the
-- 8-hour people to also accept single-punch days and vice versa.
--
-- full_day_threshold_minutes is NULLable and NULL means "no override, use the engine's 540".
-- It is not defaulted to 540, because a stored 540 and an absent override are different facts:
-- the first is a Payroll Head decision that this person's full day is nine hours, the second is
-- that nobody has ruled on it. Only the first should survive a future change to the global
-- default.
--
-- One row per employee (UNIQUE on employee_id). Removing someone from the bucket sets
-- active_status = 0 rather than deleting the row, so "who was exempt in August, and why" is still
-- answerable after they are taken out — the same reason 1651 keeps its prior cycle's snapshot.
--
-- No approval workflow columns, unlike employee_statutory_override's requested/approved/revoked
-- lifecycle. Ruling of 2026-09-02: the Payroll Head assigns directly, because this IS the Payroll
-- Head's own authority and a second approver on their own exception list is ceremony, not
-- control. reason is NOT NULL so the justification is captured at the moment of the decision, and
-- every write goes through logSensitiveAction() into sensitive_action_log (entity_type =
-- 'employee_attendance_exception_bucket'), which is where the who/when/what-changed trail lives.
-- That is the same audit mechanism attendance.manual-override.routes.ts and
-- payroll-statutory-override.routes.ts already use, so no new audit table is needed.
--
-- COLLATION: every string column carries an explicit COLLATE utf8mb4_unicode_ci. A bare
-- CHARSET=utf8mb4 takes this server's default (utf8mb4_0900_ai_ci) and the first join to
-- employees / auth_user is then a hard errno 1267 — the systemic defect 1627 exists to repair
-- across 49 tables. CHAR(36) id/employee_id/created_by/updated_by columns carry it for the same
-- reason: they are joined to employees.id and auth_user.id on every read.
--
-- No FOREIGN KEY, matching employee_statutory_override and every sibling payroll table
-- (migration 1500's WFM FK blocked deploys for days).
--
-- No new page_catalog / role_page_access rows: the screen is served under the existing
-- PAYROLL_ATTENDANCE_CONTROL_TOWER page code, whose grants already cover payroll_head.
--
-- ROLLBACK
-- --------
-- DROP TABLE IF EXISTS employee_attendance_exception_bucket;
-- The engine treats an absent table as "nobody is bucketed" (errno 1146 is caught explicitly at
-- the lookup and degrades to the pre-existing behaviour), so dropping it restores the exact
-- classification every employee had before this migration.

CREATE TABLE IF NOT EXISTS employee_attendance_exception_bucket (
  id                             CHAR(36)     NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci PRIMARY KEY,
  employee_id                    CHAR(36)     NOT NULL COLLATE utf8mb4_unicode_ci,

  -- Exception 1: a day on which COSEC saw at least one punch but never a matching pair is
  -- credited as a full present day instead of falling into the missing_punch review queue.
  single_punch_counts_as_present TINYINT(1)   NOT NULL DEFAULT 0,

  -- Exception 2: minutes that count as a full day for this employee. NULL = use the engine
  -- default of 540 (9h). 480 is the eight-hour case the owner asked for.
  full_day_threshold_minutes     SMALLINT     NULL,

  reason                         TEXT         NOT NULL COLLATE utf8mb4_unicode_ci,
  active_status                  TINYINT(1)   NOT NULL DEFAULT 1,

  created_by                     CHAR(36)     NOT NULL COLLATE utf8mb4_unicode_ci,
  created_at                     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by                     CHAR(36)     NULL COLLATE utf8mb4_unicode_ci,
  updated_at                     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  deactivated_by                 CHAR(36)     NULL COLLATE utf8mb4_unicode_ci,
  deactivated_at                 DATETIME     NULL,
  deactivation_reason            TEXT         NULL COLLATE utf8mb4_unicode_ci,

  UNIQUE KEY uq_eaeb_employee (employee_id),
  INDEX idx_eaeb_active (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
