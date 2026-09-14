-- 1651_payroll_cc_attendance_finalization.sql
--
-- WHY
-- ---
-- Owner requirement, 2026-09-02: /payroll/readiness?scope=branch must become branch-specific and
-- cost-centre-granular. Branch Payroll HR (payroll_hr) and the Branch WFM person (wfm) open their
-- branch, see every cost centre under it with a processed/unprocessed status, drill into a cost
-- centre to see each employee's month (TotalDays / A / P / OD / HD / L / H / W / SalDays), and
-- finalize that cost centre's attendance. Finalization flows to the Branch Head for approval, and
-- from there to the HO Payroll Head for final approval. If a correction surfaces AFTER the HO has
-- approved but BEFORE payroll runs, the branch raises an unlock request; only the Payroll Head can
-- grant it, and granting it sends the whole cost centre back through the same three stages again.
--
-- WHAT THIS REPLACES
-- ------------------
-- Today "attendance is ready" for a branch is a single self-reported checkbox
-- (payroll_branch_readiness.attendance_data_ready). 1643_payroll_readiness_visibility.sql's own
-- header says it plainly: "the five manually ticked readiness items verify NOTHING - the checklist
-- POST writes the column with no query behind it". This gives that attestation real underlying
-- data, cost-centre granularity, three named approval stages, and an auditable redo path.
--
-- WHAT CHANGES — three purely additive new tables, no existing table touched
-- -------------------------------------------------------------------------
-- 1. payroll_cc_attendance_finalization — one row per (process_month, branch_id, cost_centre_id).
--    cost_centre_id is VARCHAR(64) NOT NULL rather than a nullable FK to cost_centre_master
--    because the no-cost-centre bucket needs to be a real, addressable row: employees whose
--    cost_centre_id is NULL are grouped under the sentinel 'UNASSIGNED' so they appear on the
--    screen and can be finalized like anyone else, instead of vanishing from every cost centre's
--    count. (Live check 2026-09-02: 1 of 1,115 active employees is in that state. It is rare,
--    not impossible — employee-master-bulk.service.ts still accepts a blank cost_centre_code —
--    and an employee who is invisible to payroll attendance sign-off is exactly the failure this
--    screen exists to prevent.) A NULL would additionally defeat the UNIQUE key, since MySQL
--    treats every NULL in a unique index as distinct: two 'no cost centre' rows for the same
--    branch-month would both be allowed. Same reasoning as 1534's sub_head NOT NULL DEFAULT ''.
--
--    cycle_no exists because an unlock is not an edit of history. When the Payroll Head grants an
--    unlock, the row returns to 'unprocessed' with cycle_no + 1; the previous cycle's employee
--    snapshot and its approval events stay exactly where they are, so "what did the Branch Head
--    approve on the 3rd, before the correction" is still answerable afterwards.
--
-- 2. payroll_cc_attendance_line — the employee grid AS FINALIZED, one set of rows per
--    (finalization_id, cycle_no). Not a cache: it is what the approvers actually approved. The
--    live numbers are re-derived from attendance_daily_record on every read, and a late
--    regularization can move them between HR finalizing and the Payroll Head approving. Without a
--    snapshot the approval chain would silently be a signature on whatever the data happened to
--    say at the moment each person clicked, which is not a sign-off. With it, the UI can show the
--    approver that the live data no longer matches what was finalized.
--
-- 3. payroll_cc_attendance_unlock_request — one row per unlock request, single-stage
--    (Payroll Head approves or rejects), modelled directly on
--    1534_budget_subhead_business_case_closure.sql's finance_budget_closure_reopen_request.
--
-- The approval TIMELINE is not a fourth table: every transition writes finance_approval_event
-- (1089) with entity_type = 'payroll_cc_attendance', which is already polymorphic by design
-- (entity_id is VARCHAR(64) with no FK precisely so non-GRN entities can use it) and is already
-- written inside the caller's transaction and allowed to throw.
--
-- COLLATION: every string column carries an explicit COLLATE utf8mb4_unicode_ci. A bare
-- CHARSET=utf8mb4 takes this server's default (utf8mb4_0900_ai_ci) and the first join to
-- employees / cost_centre_master / auth_user is then a hard errno 1267 — the systemic defect
-- 1627 exists only to repair across 49 tables.
--
-- No FOREIGN KEY anywhere, matching payroll_branch_readiness and every sibling payroll table
-- (migration 1500's WFM FK blocked deploys for days).
--
-- No new page_catalog / role_page_access rows: the screen is served under the existing
-- PAYROLL_BRANCH_READINESS page code, whose grants (including the payroll_hr grant added by
-- 1643_payroll_readiness_visibility.sql) already cover exactly the roles this feature needs.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS payroll_cc_attendance_unlock_request;
--   DROP TABLE IF EXISTS payroll_cc_attendance_line;
--   DROP TABLE IF EXISTS payroll_cc_attendance_finalization;

CREATE TABLE IF NOT EXISTS payroll_cc_attendance_finalization (
  id                       CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  process_month            VARCHAR(7)   COLLATE utf8mb4_unicode_ci NOT NULL,
  branch_id                CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  -- cost_centre_master.id, or the literal 'UNASSIGNED' bucket. See header.
  cost_centre_id           VARCHAR(64)  COLLATE utf8mb4_unicode_ci NOT NULL,
  cost_centre_name         VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
  status                   ENUM('unprocessed','hr_finalized','branch_head_approved','ho_approved','unlock_requested')
                                        COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unprocessed',
  cycle_no                 INT          NOT NULL DEFAULT 1,
  total_employees          INT          NOT NULL DEFAULT 0,

  hr_finalized_by          CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  hr_finalized_at          DATETIME     NULL,
  hr_remarks               TEXT         COLLATE utf8mb4_unicode_ci NULL,

  branch_head_approved_by  CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  branch_head_approved_at  DATETIME     NULL,
  branch_head_remarks      TEXT         COLLATE utf8mb4_unicode_ci NULL,

  ho_approved_by           CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  ho_approved_at           DATETIME     NULL,
  ho_remarks               TEXT         COLLATE utf8mb4_unicode_ci NULL,

  -- Set when a stage sends the packet back down; cleared on the next finalize. Kept as plain
  -- columns rather than a status value so "rejected" does not become a state the UI has to
  -- distinguish from "not started" — a sent-back packet IS unprocessed, with a reason attached.
  last_rejected_by         CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  last_rejected_at         DATETIME     NULL,
  last_rejected_stage      VARCHAR(32)  COLLATE utf8mb4_unicode_ci NULL,
  last_rejected_reason     TEXT         COLLATE utf8mb4_unicode_ci NULL,

  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_cc_att_month_branch_cc (process_month, branch_id, cost_centre_id),
  KEY idx_cc_att_branch_month_status (branch_id, process_month, status),
  KEY idx_cc_att_month_status (process_month, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_cc_attendance_line (
  id                CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  finalization_id   CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  cycle_no          INT          NOT NULL DEFAULT 1,
  employee_id       CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  employee_code     VARCHAR(64)  COLLATE utf8mb4_unicode_ci NULL,
  employee_name     VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
  emp_location      VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
  total_days        INT          NOT NULL DEFAULT 0,
  absent_days       DECIMAL(6,2) NOT NULL DEFAULT 0,
  present_days      DECIMAL(6,2) NOT NULL DEFAULT 0,
  od_days           DECIMAL(6,2) NOT NULL DEFAULT 0,
  half_days         DECIMAL(6,2) NOT NULL DEFAULT 0,
  leave_days        DECIMAL(6,2) NOT NULL DEFAULT 0,
  holiday_days      DECIMAL(6,2) NOT NULL DEFAULT 0,
  weekoff_days      DECIMAL(6,2) NOT NULL DEFAULT 0,
  sal_days          DECIMAL(6,2) NOT NULL DEFAULT 0,
  captured_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cc_att_line_cycle_emp (finalization_id, cycle_no, employee_id),
  KEY idx_cc_att_line_final_cycle (finalization_id, cycle_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_cc_attendance_unlock_request (
  id                CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  finalization_id   CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  cycle_no          INT         NOT NULL DEFAULT 1,
  process_month     VARCHAR(7)  COLLATE utf8mb4_unicode_ci NOT NULL,
  branch_id         CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  cost_centre_id    VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  reason            TEXT        COLLATE utf8mb4_unicode_ci NOT NULL,
  status            ENUM('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  requested_by      CHAR(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  requested_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by       CHAR(36)    COLLATE utf8mb4_unicode_ci NULL,
  reviewed_at       DATETIME    NULL,
  review_notes      TEXT        COLLATE utf8mb4_unicode_ci NULL,
  PRIMARY KEY (id),
  KEY idx_cc_att_unlock_final_status (finalization_id, status),
  KEY idx_cc_att_unlock_status (status, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
