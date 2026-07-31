-- 1030_lms_progress_snapshot_dedupe.sql
--
-- Stops the LMS snapshot tables growing without bound, and makes the upserts that were
-- always intended actually work.
--
-- APPLIED TO PRODUCTION 2026-07-31. This file has been rewritten to match what was
-- actually run — see "RACE CONDITION" below. Do not use the original GROUP_CONCAT form.
--
-- THE BUG
-- All three LMS snapshot tables insert with `ON DUPLICATE KEY UPDATE`, but their only
-- unique key is PRIMARY (id) and `id` is a fresh randomUUID() on every call
-- (lms.sync.service.ts:99, :153, :220). The clause can never fire, so each hourly run of
-- lms-sync appends instead of updating.
--
-- Measured before this ran:
--   lms_learning_progress_snapshot: 173,314 rows for 264 distinct (employee_id, course_id)
--   pairs — up to 928 copies of a single pair. 41.6 MB data + 36.2 MB index, growing about
--   5,000 rows/day since 2026-06-21.
--
-- It was also corrupting the training dashboard, which does COUNT(*) over the raw table
-- (dashboard-metric.service.ts:1118, dashboard-drilldown.service.ts:775): it reported
-- 171,468 assignments for 214 learners — an 801x overstatement. Completion RATE was only
-- ~0.5pt off, because the duplicates are mostly identical; the absolute counts were
-- nonsense.
--
-- ⚠ RACE CONDITION — WHY THE DEDUPE AND THE KEY MUST BE ADJACENT AND RETRIED
-- The first attempt used GROUP_CONCAT to pick a survivor, then added the unique key as a
-- later statement. The DELETE succeeded (173,314 -> 264) but lms-sync ran in the gap and
-- inserted its 211 rows, so ADD UNIQUE KEY failed with ER_DUP_ENTRY and the table was left
-- deduped but unprotected. Every leftover duplicate was exactly n=2, which is what
-- identified it as a race rather than a logic error.
--
-- The self-join below replaces GROUP_CONCAT (no group_concat_max_len limit to trip over at
-- 928 ids per group), and the guidance is to run the DELETE and the ALTER back to back,
-- retrying on ER_DUP_ENTRY. If applying by hand, simply run this file again — it is
-- idempotent, and once the unique key exists the worker can no longer create duplicates.
--
-- SAFETY: keeps the newest row per pair, so current progress values are preserved exactly.
-- A full backup table is taken first.
--
-- NOTE: this DELETEs rows, unlike the additive migrations 1022-1029. It also needs
-- OPTIMIZE TABLE afterwards — InnoDB does not return freed pages to disk on delete alone,
-- so without it the 78 MB stays allocated.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 0. Safety net — full copy before any delete. Drop once the result is reviewed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_learning_progress_snapshot_backup_1030
  AS SELECT * FROM lms_learning_progress_snapshot;

-- ---------------------------------------------------------------------------
-- 1. course_id NOT NULL first, so the unique key cannot be bypassed.
--
--    In MySQL, NULLs never collide in a UNIQUE index — two rows with course_id NULL for
--    the same employee would both insert, quietly reintroducing the duplication this
--    migration removes. Production had zero NULLs, so this is a no-op on today's data and
--    a guard against tomorrow's. Done BEFORE the dedupe so the self-join can compare
--    course_id directly without COALESCE.
-- ---------------------------------------------------------------------------
UPDATE lms_learning_progress_snapshot SET course_id = '' WHERE course_id IS NULL;

ALTER TABLE lms_learning_progress_snapshot
  MODIFY COLUMN course_id VARCHAR(128) NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- 2. Delete any row that has a strictly-newer sibling for the same pair.
--    Ties on synced_at break on id, so exactly one row always survives.
-- ---------------------------------------------------------------------------
DELETE s FROM lms_learning_progress_snapshot s
  JOIN lms_learning_progress_snapshot t
    ON t.employee_id = s.employee_id
   AND t.course_id   = s.course_id
   AND (t.synced_at > s.synced_at OR (t.synced_at = s.synced_at AND t.id > s.id));

-- ---------------------------------------------------------------------------
-- 3. The unique key the upsert has always assumed. Run immediately after step 2;
--    on ER_DUP_ENTRY, re-run this file.
-- ---------------------------------------------------------------------------
SET @db := DATABASE();
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_learning_progress_snapshot'
      AND INDEX_NAME='uq_lms_prog_emp_course') = 0,
  'ALTER TABLE lms_learning_progress_snapshot
     ADD UNIQUE KEY uq_lms_prog_emp_course (employee_id, course_id)',
  'SELECT "uq_lms_prog_emp_course exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 4. The same flaw exists in the other two LMS snapshot tables.
--
--    lms_certification_snapshot was empty (no LMS trainee is certified yet), but
--    lms_assessment_scores was NOT: between diagnosis and fix it went from 0 to 70 rows
--    with 3 duplicates already, because the assessment sync had begun importing. Both are
--    deduped defensively before the key is added.
-- ---------------------------------------------------------------------------
DELETE s FROM lms_assessment_scores s
  JOIN lms_assessment_scores t
    ON t.employee_id     = s.employee_id
   AND t.assessment_name = s.assessment_name
   AND t.attempt_no      = s.attempt_no
   AND (t.synced_at > s.synced_at OR (t.synced_at = s.synced_at AND t.id > s.id));

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_assessment_scores'
      AND INDEX_NAME='uq_lms_assess_attempt') = 0,
  'ALTER TABLE lms_assessment_scores
     ADD UNIQUE KEY uq_lms_assess_attempt (employee_id, assessment_name, attempt_no)',
  'SELECT "uq_lms_assess_attempt exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

DELETE s FROM lms_certification_snapshot s
  JOIN lms_certification_snapshot t
    ON t.employee_id        = s.employee_id
   AND t.certification_name = s.certification_name
   AND (t.synced_at > s.synced_at OR (t.synced_at = s.synced_at AND t.id > s.id));

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_certification_snapshot'
      AND INDEX_NAME='uq_lms_cert_emp_name') = 0,
  'ALTER TABLE lms_certification_snapshot
     ADD UNIQUE KEY uq_lms_cert_emp_name (employee_id, certification_name)',
  'SELECT "uq_lms_cert_emp_name exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 5. Reclaim the disk. InnoDB keeps freed pages allocated until the table is rebuilt.
-- ---------------------------------------------------------------------------
OPTIMIZE TABLE lms_learning_progress_snapshot;

-- ---------------------------------------------------------------------------
-- Verification — production results 2026-07-31 in brackets
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) rows_now, COUNT(DISTINCT employee_id, course_id) pairs
--   FROM lms_learning_progress_snapshot;                       -- [264 / 264]
--
-- SELECT INDEX_NAME FROM information_schema.STATISTICS
--  WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN
--    ('uq_lms_prog_emp_course','uq_lms_assess_attempt','uq_lms_cert_emp_name')
--  GROUP BY INDEX_NAME;                                        -- [all 3 present]
--
-- Dashboard is no longer inflated:
-- SELECT COUNT(*) assignments, COUNT(DISTINCT s.employee_id) learners
--   FROM lms_learning_progress_snapshot s
--   JOIN employees e ON e.id = s.employee_id AND e.active_status = 1;
--                                                              -- [214 / 214, was 171,468]
--
-- PROOF the upsert now works — run the same INSERT ... ON DUPLICATE KEY UPDATE twice and
-- confirm COUNT(*) does not change. [verified: 264 -> 264]
--
-- Once satisfied:
-- DROP TABLE lms_learning_progress_snapshot_backup_1030;       -- [173,315 rows, 29.6 MB]
