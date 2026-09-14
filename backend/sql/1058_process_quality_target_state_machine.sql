-- 1058_process_quality_target_state_machine.sql
--
-- Turns the quality target from a two-state row (draft -> active) into a
-- governed lifecycle, and makes the parts that must not be bypassable
-- unbypassable in the database rather than only in the service.
--
-- WHY
-- ---
-- 1057 shipped the thresholds and an approve() that flipped draft straight to
-- active. That is enough to store a policy and not enough to defend one. A
-- target decides who gets coached: it needs to be simulated before anyone can
-- approve it, approved by someone other than its author, and impossible to
-- edit quietly after approval.
--
-- The lifecycle:
--
--   draft ──simulate──> simulation_reviewed ──submit──> pending_approval
--     ^                                                    │
--     │                                              approve│reject
--     └──────── edit (any governed field) ────────┐         │
--                                                 │         v
--   inactive <──deactivate── active <──activate── approved   rejected
--                              │                             │
--                              └──superseded (by a newer dated row)
--
-- Editing a governed field sends the row back to draft. That is the point of
-- config_fingerprint below: an approval is an approval OF SPECIFIC NUMBERS, so
-- changing the numbers must void it rather than silently inherit it.
--
-- WHAT THE DATABASE ENFORCES BY ITSELF
-- ------------------------------------
--   * the set of legal states (enum)
--   * a rejection always carries a reason
--   * approved/active always names an approver
--   * the approver is not the author, unless an explicit, reasoned exception
--     is recorded on the row
--   * at most ONE open-ended active target per process and metric
--   * config_fingerprint cannot be forged — it is STORED GENERATED from the
--     governed columns, so it changes if and only if they do
--
-- WHAT REMAINS THE SERVICE'S JOB (and is tested there)
-- ---------------------------------------------------
-- Rejecting a stale simulation — that simulated_config_fingerprint still equals
-- config_fingerprint — is enforced in the transition service, not by a CHECK.
-- MySQL's documented CHECK restrictions do not clearly cover references to
-- generated columns, and there is no environment here to prove it against; a
-- migration that might fail on a fresh database is the exact defect this
-- session just spent its time repairing. The fingerprint being generated is
-- what makes the service-side comparison trustworthy: the service can refuse a
-- mismatch, but it cannot manufacture a match.
--
-- Full range-overlap exclusion is likewise the service's job. The unique key
-- below catches the common and dangerous case (two open-ended actives); two
-- closed rows with overlapping windows are rejected in the transaction, which
-- takes a row lock first.
--
-- ADDITIVE. Both tables are empty in production (verified 2026-08-02: 0 rows in
-- process_quality_target, 0 in process_quality_target_audit), so widening the
-- enum and adding generated columns rewrites nothing. 'retired' is dropped
-- because no row and no code path ever used it; 'inactive' replaces it.
--
-- ROLLBACK
--   ALTER TABLE process_quality_target
--     DROP INDEX uq_pqt_one_open_active,
--     DROP COLUMN active_open_sentinel, DROP COLUMN config_fingerprint,
--     DROP COLUMN simulated_config_fingerprint, DROP COLUMN simulated_at,
--     DROP COLUMN simulated_by, DROP COLUMN simulation_summary_json,
--     DROP COLUMN submitted_by, DROP COLUMN submitted_at,
--     DROP COLUMN rejected_by, DROP COLUMN rejected_at, DROP COLUMN rejection_reason,
--     DROP COLUMN activated_by, DROP COLUMN activated_at,
--     DROP COLUMN deactivated_by, DROP COLUMN deactivated_at, DROP COLUMN deactivation_reason,
--     DROP COLUMN self_approval_exception, DROP COLUMN self_approval_exception_reason,
--     DROP CHECK chk_pqt_rejection_reason, DROP CHECK chk_pqt_approver_present,
--     DROP CHECK chk_pqt_separation_of_duties, DROP CHECK chk_pqt_self_approval_reason,
--     DROP CHECK chk_pqt_simulation_required,
--     MODIFY status ENUM('draft','active','superseded','retired') NOT NULL DEFAULT 'draft';

ALTER TABLE process_quality_target
  MODIFY status ENUM(
    'draft',
    'simulation_reviewed',
    'pending_approval',
    'approved',
    'active',
    'inactive',
    'superseded',
    'rejected'
  ) NOT NULL DEFAULT 'draft';

-- Simulation. Bound to the exact configuration it was run against, so an edit
-- after simulating is detectable rather than invisible.
ALTER TABLE process_quality_target
  ADD COLUMN simulated_config_fingerprint VARCHAR(255) NULL AFTER approval_note,
  ADD COLUMN simulated_at            DATETIME      NULL AFTER simulated_config_fingerprint,
  ADD COLUMN simulated_by            CHAR(36)      NULL AFTER simulated_at,
  -- The impact numbers the reviewer actually saw. Kept so an approval can be
  -- explained later without re-running a simulation against changed data.
  ADD COLUMN simulation_summary_json JSON          NULL AFTER simulated_by;

ALTER TABLE process_quality_target
  ADD COLUMN submitted_by CHAR(36) NULL AFTER simulation_summary_json,
  ADD COLUMN submitted_at DATETIME NULL AFTER submitted_by,
  ADD COLUMN rejected_by  CHAR(36) NULL AFTER submitted_at,
  ADD COLUMN rejected_at  DATETIME NULL AFTER rejected_by,
  ADD COLUMN rejection_reason VARCHAR(1000) NULL AFTER rejected_at,
  ADD COLUMN activated_by CHAR(36) NULL AFTER rejection_reason,
  ADD COLUMN activated_at DATETIME NULL AFTER activated_by,
  ADD COLUMN deactivated_by CHAR(36) NULL AFTER activated_at,
  ADD COLUMN deactivated_at DATETIME NULL AFTER deactivated_by,
  ADD COLUMN deactivation_reason VARCHAR(1000) NULL AFTER deactivated_at;

-- Separation of duties, with a door rather than a wall: some processes have a
-- single quality owner, so the exception exists — but it is recorded ON the row
-- with a reason, not configured away invisibly.
ALTER TABLE process_quality_target
  ADD COLUMN self_approval_exception TINYINT(1) NOT NULL DEFAULT 0 AFTER deactivation_reason,
  ADD COLUMN self_approval_exception_reason VARCHAR(1000) NULL AFTER self_approval_exception;

-- The identity of a configuration. STORED GENERATED, so it tracks the governed
-- columns exactly and no caller can set it. effective_to is COALESCEd because
-- an open-ended row and one ending today are different policies.
ALTER TABLE process_quality_target
  ADD COLUMN config_fingerprint VARCHAR(255)
    AS (CONCAT_WS('|',
          target_score,
          warning_threshold_pct,
          critical_threshold_pct,
          min_audit_count,
          evaluation_period,
          effective_from,
          COALESCE(effective_to, '-')
        )) STORED AFTER self_approval_exception_reason;

-- Exactly one open-ended active target per process and metric. NULL for every
-- other row, and MySQL does not collide NULLs in a unique key — the same
-- NULL-is-not-NULL behaviour that has bitten this schema before, used
-- deliberately here.
ALTER TABLE process_quality_target
  ADD COLUMN active_open_sentinel VARCHAR(160)
    AS (IF(status = 'active' AND effective_to IS NULL,
           CONCAT(process_id, '|', metric_code),
           NULL)) STORED AFTER config_fingerprint,
  ADD UNIQUE KEY uq_pqt_one_open_active (active_open_sentinel);

ALTER TABLE process_quality_target
  -- A rejection without a reason tells the author nothing and cannot be argued
  -- with.
  ADD CONSTRAINT chk_pqt_rejection_reason
    CHECK (status <> 'rejected'
           OR (rejection_reason IS NOT NULL AND CHAR_LENGTH(TRIM(rejection_reason)) > 0)),

  -- Nothing governs coaching without a named approver.
  ADD CONSTRAINT chk_pqt_approver_present
    CHECK (status NOT IN ('approved','active') OR approved_by IS NOT NULL),

  ADD CONSTRAINT chk_pqt_separation_of_duties
    CHECK (status NOT IN ('approved','active')
           OR approved_by IS NULL
           OR created_by IS NULL
           OR approved_by <> created_by
           OR self_approval_exception = 1),

  ADD CONSTRAINT chk_pqt_self_approval_reason
    CHECK (self_approval_exception = 0
           OR (self_approval_exception_reason IS NOT NULL
               AND CHAR_LENGTH(TRIM(self_approval_exception_reason)) > 0)),

  -- Past draft, an unsimulated target cannot exist: nobody submits or approves
  -- a threshold without having seen who it would coach.
  ADD CONSTRAINT chk_pqt_simulation_required
    CHECK (status IN ('draft','rejected') OR simulated_config_fingerprint IS NOT NULL);

-- The audit table gains the transitions that did not exist in 1057. It is
-- append-only and already carries before_json/after_json, so widening the
-- action list is all that is needed.
ALTER TABLE process_quality_target_audit
  MODIFY action ENUM(
    'created',
    'updated',
    'simulated',
    'submitted',
    'approved',
    'rejected',
    'activated',
    'deactivated',
    'superseded',
    'retired'
  ) NOT NULL;
