-- 1023_discard_approved_records.sql
--
-- Discard of APPROVED leave / attendance regularization / attendance dispute.
--
-- Why this exists
-- ---------------
-- Approval is currently a one-way door. `leave.service.reviewRequest` deducts
-- `leave_balance_ledger.used_days` and overwrites `attendance_daily_record`, and
-- `wfm.service.reviewRegularization` overwrites ~20 columns of the same table —
-- but only `old_attendance_status` and `old_lwp_value` are saved first. Punch
-- times, minutes, source lineage and late marks are lost on approval, and a day
-- that had NO attendance row before approval is indistinguishable from one that
-- had a row with a NULL status (both leave `old_attendance_status` NULL).
--
-- Live census 2026-07-31 (mas_hrms): 25 approved regularizations, of which 23
-- have NO usable `old_attendance_status`. Those must be rebuilt by the
-- attendance engine rather than restored. Everything approved from now on gets a
-- full row snapshot here instead.
--
-- Additive and idempotent: two new tables plus one page grant. Nothing existing
-- is altered.

-- ─────────────────────────────────────────────────────────────────────────────
-- attendance_state_snapshot
--   One row per (source, date) captured INSIDE the approval transaction, before
--   attendance_daily_record is touched. `row_existed` is the column the current
--   schema cannot express: 0 means discard must DELETE the row, not UPDATE it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_state_snapshot (
  id            CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  source_type   VARCHAR(20) NOT NULL COMMENT 'regularization | dispute | leave',
  source_id     CHAR(36)    NOT NULL COMMENT 'attendance_regularization.id or leave_request.id',
  employee_id   CHAR(36)    NOT NULL,
  record_date   DATE        NOT NULL,
  row_existed   TINYINT(1)  NOT NULL COMMENT '0 = no attendance_daily_record row before approval; discard must DELETE',
  snapshot_json JSON        NULL     COMMENT 'full attendance_daily_record row before mutation; NULL when row_existed = 0',
  captured_by   VARCHAR(36) NULL,
  captured_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snapshot_source_date (source_type, source_id, record_date),
  KEY idx_snapshot_emp_date (employee_id, record_date),
  KEY idx_snapshot_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- approval_discard_log
--   Append-only record of every discard. Deliberately NOT unique on
--   (entity_type, entity_id): a record can legitimately be re-approved and
--   discarded again. Idempotency comes from the SELECT ... FOR UPDATE +
--   status = 'approved' precondition inside the discard transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_discard_log (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  entity_type           VARCHAR(20)  NOT NULL COMMENT 'leave | regularization | dispute',
  entity_id             CHAR(36)     NOT NULL,
  employee_id           CHAR(36)     NOT NULL,
  discarded_by          VARCHAR(36)  NOT NULL COMMENT 'auth_user.id of the actor',
  discarded_by_role     VARCHAR(50)  NULL,
  reason                TEXT         NOT NULL,
  restore_mode          VARCHAR(20)  NOT NULL COMMENT 'snapshot = exact restore | partial = old_* columns only | recompute = engine rebuilt the day',
  leave_type_id         CHAR(36)     NULL,
  balance_year          INT          NULL,
  days_restored         DECIMAL(6,2) NULL,
  balance_before        DECIMAL(6,2) NULL,
  balance_after         DECIMAL(6,2) NULL,
  affected_dates        JSON         NULL,
  before_state_json     JSON         NULL,
  after_state_json      JSON         NULL,
  payroll_month         VARCHAR(7)   NULL,
  payroll_recalc_status VARCHAR(30)  NULL,
  discarded_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_discard_entity (entity_type, entity_id),
  KEY idx_discard_emp (employee_id),
  KEY idx_discard_at (discarded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Discard & Reversal Center page + grants.
-- page_catalog.page_code is UNIQUE and role_page_access has uq_role_page
-- (role_key, page_code), so both upserts are safe to re-run. Neither table has
-- foreign keys; 'super_admin' and 'wfm' are both present and active in
-- workforce_role_catalog.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES (UUID(), 'DISCARD_CENTER', 'Discard & Reversal Center', '/admin/discard-center', 'Attendance',
        'Discard approved leave, attendance regularizations and attendance disputes; restores leave balance and attendance state', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin', 'DISCARD_CENTER', 1, 1, 1, 1, 1, 1),
  (UUID(), 'wfm',         'DISCARD_CENTER', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_export    = VALUES(can_export),
  active_status = 1;
