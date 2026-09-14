-- 1096_uat_release.sql
--
-- Phase 1, part two: the half of the lifecycle that runs AFTER a fix exists — approvals,
-- releases, retest evidence and rollback.
--
-- WHY THIS IS IN PHASE 1 AND NOT PHASE 4
--   A merged PR is not a fixed defect. UAT ends when the reporter confirms the fix works,
--   in production. Nothing in this file depends on the AI pipeline: it applies verbatim to
--   fixes a human engineer writes by hand, which is every fix until Phase 4 is enabled.
--   Shipping it now means the governance value lands immediately rather than being held
--   hostage to the automation.
--
-- WHY uat_approval IS HERE RATHER THAN WITH THE CHECKLIST (Phase 2)
--   Release and retest need approvals on day one. Deferring the table to Phase 2 would
--   mean either a second approval mechanism now and a migration to merge them later, or a
--   Phase 1 with no approval record at all. Both are worse than one table introduced early
--   with approval_type values that Phase 2 and 3 extend.
--
-- MAKER-CHECKER
--   uq_uat_appr enforces one decision per (feedback, approval_type, required_role). The
--   submitter-is-not-approver and rule-editor-is-not-approver rules cannot be expressed as
--   constraints — they are enforced in uat-approval.service.ts, which returns 409 — but the
--   unique key stops the same gate being satisfied twice, which is the part a race could
--   otherwise win.
--
-- COLLATION
--   As 1095: server default is utf8mb4_0900_ai_ci, employees.id is utf8mb4_unicode_ci.
--   Every table declares COLLATE=utf8mb4_unicode_ci and every CHAR(36) actor/FK column
--   declares it at column level. See 1095 for the full reasoning.
--
-- Idempotent: every CREATE is IF NOT EXISTS. Safe to re-run.

START TRANSACTION;

-- ── Approvals ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uat_approval (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id       CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  approval_type     ENUM('review_tier','capability','change_type','dispatch',
                         'merge','retest','release','rollback') NOT NULL,
  capability_key    VARCHAR(60)  NULL,   -- set when approval_type = 'capability'
  required_role     VARCHAR(60)  NOT NULL,
  approver_user_id  CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  delegation_id     CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,   -- set when a backup approver acted
  decision          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reason            VARCHAR(1000) NULL,
  evidence_sha256   CHAR(64)     NULL,
  requested_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at        DATETIME     NULL,
  UNIQUE KEY uq_uat_appr (feedback_id, approval_type, required_role),
  INDEX idx_uat_appr_fb       (feedback_id),
  INDEX idx_uat_appr_pending  (decision, required_role),
  INDEX idx_uat_appr_approver (approver_user_id),
  CONSTRAINT fk_uat_appr_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Releases ──────────────────────────────────────────────────────────────────
-- approved_release_version is stored separately from version so RS-04 ("production
-- version equals the approved release version") is a comparison of two recorded facts
-- rather than an assumption. verified_by is constrained in code to the reporter or the
-- QA owner: production verification by a generic admin is not verification.

CREATE TABLE IF NOT EXISTS uat_release (
  id                          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  release_code                VARCHAR(60)  NOT NULL UNIQUE,
  name                        VARCHAR(200) NULL,
  environment                 ENUM('uat','production') NOT NULL DEFAULT 'uat',
  version                     VARCHAR(60)  NULL,
  approved_release_version    VARCHAR(60)  NULL,
  frontend_sha                VARCHAR(64)  NULL,
  backend_sha                 VARCHAR(64)  NULL,
  status                      VARCHAR(40)  NOT NULL DEFAULT 'planned',
  deployed_at                 DATETIME     NULL,
  deployed_by                 CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  verified_at                 DATETIME     NULL,
  verified_by                 CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  verification_checklist_json JSON         NULL,
  notes                       TEXT         NULL,
  created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_uat_rel_status (status),
  INDEX idx_uat_rel_env    (environment, deployed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Retest evidence ───────────────────────────────────────────────────────────
-- Structured evidence, deliberately NOT a Pass button. A retest that records only
-- "passed" is indistinguishable from a retest nobody performed, and six months later
-- there is no way to tell which. Every field below is what an auditor would ask for.
-- build_sha ties the result to the exact artefact tested, which is what makes RS-03
-- ("merge_sha equals the SHA that passed verification") checkable.

CREATE TABLE IF NOT EXISTS uat_retest (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  feedback_id      CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  release_id       CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  attempt_no       INT          NOT NULL DEFAULT 1,
  tested_by        CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  tester_role      VARCHAR(60)  NULL,
  environment      VARCHAR(30)  NOT NULL,
  build_sha        VARCHAR(64)  NULL,
  app_version      VARCHAR(50)  NULL,
  scenario         VARCHAR(500) NOT NULL,
  steps_performed  TEXT         NOT NULL,
  expected_result  TEXT         NOT NULL,
  actual_result    TEXT         NOT NULL,
  result           ENUM('pass','fail') NOT NULL,
  failure_reason   VARCHAR(1000) NULL,
  attachment_id    CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  evidence_sha256  CHAR(64)     NULL,
  tested_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_uat_retest (feedback_id, attempt_no),
  INDEX idx_uat_retest_fb     (feedback_id, tested_at),
  INDEX idx_uat_retest_result (result),
  INDEX idx_uat_retest_rel    (release_id),
  CONSTRAINT fk_uat_retest_fb FOREIGN KEY (feedback_id)
    REFERENCES uat_feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- A production regression is a rollback, not an ordinary reopen. Keeping it as a distinct
-- record rather than another status value means "how often do we roll back" is a query,
-- and the revert-rate figure in the Phase 6 entry criteria has a source.

CREATE TABLE IF NOT EXISTS uat_rollback (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  release_id        CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  feedback_id       CHAR(36)     COLLATE utf8mb4_unicode_ci NULL,
  reason            VARCHAR(1000) NOT NULL,
  initiated_by      CHAR(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  rolled_back_at    DATETIME     NULL,
  restored_version  VARCHAR(60)  NULL,
  verification      TEXT         NULL,
  status            ENUM('required','in_progress','completed','abandoned')
                                 NOT NULL DEFAULT 'required',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_uat_rb_release (release_id),
  INDEX idx_uat_rb_fb      (feedback_id),
  INDEX idx_uat_rb_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;

-- Rollback:
--   DROP TABLE IF EXISTS uat_rollback;
--   DROP TABLE IF EXISTS uat_retest;
--   DROP TABLE IF EXISTS uat_release;
--   DROP TABLE IF EXISTS uat_approval;
-- None of these tables existed before this migration. uat_approval and uat_retest FK to
-- uat_feedback (1095), so drop them before dropping that table if unwinding both.
