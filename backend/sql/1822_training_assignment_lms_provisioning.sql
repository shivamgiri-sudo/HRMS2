-- 1822_training_assignment_lms_provisioning.sql
--
-- Tracks whether a training_assignment's LMS side has been provisioned, and is honest
-- about the boundary of what HRMS can automate there.
--
-- WHY THIS IS NOT A REAL CONTENT ASSIGNMENT
-- -------------------------------------------
-- Investigated before writing this migration: mcn_lms (the external LMS database) has no
-- per-trainee content-assignment table. A trainee's visible curriculum is a pure cascade —
-- trainee_master.classroom_id -> module_master.classroom_id -> content_master.module_id —
-- with no override or ad-hoc assignment mechanism anywhere in that schema. On top of that,
-- this codebase's own UAT governance checklist (1103_uat_governance_checklist.sql, rule
-- CS-04) is an explicit BLOCK-tier rule: "No change to the deployed LMS or LMS-owned
-- domains." lms.routes.ts states the same thing directly in a comment: "the LMS is a
-- protected system we do not alter."
--
-- So this migration does NOT create a new mcn_lms write path, and does NOT invent a fake
-- "assignment" that the LMS has no way to represent. What IS automatable, and what this
-- tracks:
--
--   1. Confirming/creating the employee's LEARNER IDENTITY in the LMS (trainee_master row)
--      — this already has a safe, existing, best-effort write path:
--      provisionLmsIdentityForEmployee() in lms-provisioning.service.ts. Calling it here is
--      reuse, not a new LMS write surface.
--   2. Recording that a human (training coordinator) still needs to add the mapped content
--      to that employee's classroom curriculum in the LMS — because there is currently no
--      other way for the content to become visible to them. This is the same "automate
--      detection/audit, hand the actual system-of-record action to a human who has real
--      access" pattern as training_dialer_hold (1821_training_dialer_hold.sql).
--
-- WHAT
-- ----
-- training_assignment gains:
--   lms_learner_id            — denormalised from lms_employee_mapping/trainee_master at
--                               provisioning time, so the manager dashboard and admin
--                               routes can display it without a second cross-DB query.
--   lms_provisioning_status   — pending -> identity_provisioned -> content_manual_pending
--                               -> content_confirmed, or provisioning_failed. See the
--                               ENUM comment below for what each state means and who acts.
--   lms_provisioning_note     — the best-effort failure message from
--                               provisionLmsIdentityForEmployee, or a coordinator's note
--                               when confirming manual content assignment.
--   lms_content_confirmed_by  — auth_user.id of the coordinator who confirmed the mapped
--                               content is now visible to the trainee in their classroom.
--   lms_content_confirmed_at  — when.
--
-- ADDITIVE ONLY. All columns nullable / defaulted; no existing row or query is affected
-- until the provisioning service starts populating them.
--
-- ROLLBACK
--   ALTER TABLE training_assignment
--     DROP COLUMN lms_learner_id,
--     DROP COLUMN lms_provisioning_status,
--     DROP COLUMN lms_provisioning_note,
--     DROP COLUMN lms_content_confirmed_by,
--     DROP COLUMN lms_content_confirmed_at;

SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='training_assignment' AND COLUMN_NAME='lms_learner_id') = 0,
  'ALTER TABLE training_assignment ADD COLUMN lms_learner_id VARCHAR(20) NULL AFTER assigned_content',
  'SELECT "training_assignment.lms_learner_id exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='training_assignment' AND COLUMN_NAME='lms_provisioning_status') = 0,
  'ALTER TABLE training_assignment ADD COLUMN lms_provisioning_status
     ENUM(''pending'',''identity_provisioned'',''content_manual_pending'',''content_confirmed'',''provisioning_failed'')
     NOT NULL DEFAULT ''pending''
     COMMENT ''pending: not yet attempted. identity_provisioned: trainee_master row confirmed, content still needs a coordinator to add it to the classroom curriculum. content_manual_pending: identity provisioning failed or the employee has no mapped identity, a human must set this up. content_confirmed: a coordinator has confirmed the mapped content is now visible in the trainee''''s classroom. provisioning_failed: the best-effort identity write itself failed.''
     AFTER lms_learner_id',
  'SELECT "training_assignment.lms_provisioning_status exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='training_assignment' AND COLUMN_NAME='lms_provisioning_note') = 0,
  'ALTER TABLE training_assignment ADD COLUMN lms_provisioning_note VARCHAR(500) NULL AFTER lms_provisioning_status',
  'SELECT "training_assignment.lms_provisioning_note exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='training_assignment' AND COLUMN_NAME='lms_content_confirmed_by') = 0,
  'ALTER TABLE training_assignment ADD COLUMN lms_content_confirmed_by CHAR(36) NULL AFTER lms_provisioning_note',
  'SELECT "training_assignment.lms_content_confirmed_by exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='training_assignment' AND COLUMN_NAME='lms_content_confirmed_at') = 0,
  'ALTER TABLE training_assignment ADD COLUMN lms_content_confirmed_at DATETIME NULL AFTER lms_content_confirmed_by',
  'SELECT "training_assignment.lms_content_confirmed_at exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The manager dashboard and coordinator worklist both filter on "who still needs a manual
-- action" — status IN ('content_manual_pending','identity_provisioned') AND NOT completed.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='training_assignment' AND INDEX_NAME='idx_ta_provisioning_status') = 0,
  'ALTER TABLE training_assignment ADD INDEX idx_ta_provisioning_status (lms_provisioning_status)',
  'SELECT "training_assignment.idx_ta_provisioning_status exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Verification
-- SHOW COLUMNS FROM training_assignment LIKE 'lms_%';
--   -- expect 5 rows: lms_learner_id, lms_provisioning_status, lms_provisioning_note,
--   -- lms_content_confirmed_by, lms_content_confirmed_at
