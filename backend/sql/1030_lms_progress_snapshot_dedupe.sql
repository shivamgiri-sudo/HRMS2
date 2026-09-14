-- 1030_lms_progress_snapshot_dedupe.sql
--
-- Stops lms_learning_progress_snapshot growing without bound, and makes the upsert that
-- was always intended actually work.
--
-- THE BUG
-- lms.sync.service.ts:99 inserts with `ON DUPLICATE KEY UPDATE ... synced_at = NOW()`.
-- That clause can never fire: the only unique key on the table is PRIMARY (id), and `id`
-- is a fresh randomUUID() on every call. So each hourly run of lms-sync appends 211 brand
-- new rows instead of updating the existing ones.
--
-- Measured on production 2026-07-31:
--   172,470 rows for 264 distinct (employee_id, course_id) pairs — 653 copies of each
--   41.6 MB data + 36.2 MB index, first row 2026-06-21, growing ~5,000 rows/day
--
-- Nothing reads the history: the dashboards select current progress per employee, so the
-- 653 stale copies are pure waste, and they make every read slower.
--
-- THE FIX
-- 1. Collapse to the newest row per (employee_id, course_id).
-- 2. Add the unique key the upsert has always assumed.
-- After this the existing ON DUPLICATE KEY UPDATE works unchanged — no code change is
-- needed for this half of the fix, which is why the table was designed this way.
--
-- SAFETY: the dedupe keeps the row with the greatest synced_at per pair, so current
-- progress values are preserved exactly. Verify counts before and after with the queries
-- at the bottom.
--
-- NOT EXECUTED against production without explicit approval (CLAUDE.md rule 4). This one
-- DELETES rows, so it warrants more care than the additive migrations in this series.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 0. Safety net — full copy of the table before any delete.
--    Drop it once the result has been reviewed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_learning_progress_snapshot_backup_1030
  AS SELECT * FROM lms_learning_progress_snapshot;

-- ---------------------------------------------------------------------------
-- 1. Collapse to the newest row per (employee_id, course_id).
--
--    Keyed on id via a join to the winning row, rather than a correlated subquery over a
--    172k-row table, so this completes in seconds. COALESCE on course_id so any future
--    NULL still groups rather than escaping the dedupe.
-- ---------------------------------------------------------------------------
DELETE s FROM lms_learning_progress_snapshot s
  JOIN (
    SELECT employee_id, COALESCE(course_id, '') AS ck,
           SUBSTRING_INDEX(
             GROUP_CONCAT(id ORDER BY synced_at DESC, id DESC SEPARATOR ','), ',', 1
           ) AS keep_id
      FROM lms_learning_progress_snapshot
     GROUP BY employee_id, COALESCE(course_id, '')
  ) w
    ON w.employee_id = s.employee_id
   AND w.ck = COALESCE(s.course_id, '')
 WHERE s.id <> w.keep_id;

-- ---------------------------------------------------------------------------
-- 2. course_id NOT NULL so the unique key cannot be bypassed.
--
--    In MySQL, NULLs never collide in a UNIQUE index — two rows with course_id NULL for
--    the same employee would both insert, quietly reintroducing the duplication this
--    migration exists to remove. Production currently has zero NULLs, so this is a no-op
--    on today's data and a guard against tomorrow's.
-- ---------------------------------------------------------------------------
UPDATE lms_learning_progress_snapshot SET course_id = '' WHERE course_id IS NULL;

ALTER TABLE lms_learning_progress_snapshot
  MODIFY COLUMN course_id VARCHAR(128) NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- 3. The unique key the upsert has always assumed.
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
-- lms_assessment_scores and lms_certification_snapshot use the identical
-- `INSERT ... ON DUPLICATE KEY UPDATE` with a randomUUID() primary key, so their upserts
-- are dead code too. They have not blown up only because nothing currently syncs into
-- them — assessments were stranded by the watermark bug (fixed in lms.sync.service.ts
-- alongside this migration) and no trainee in the LMS is certified yet.
--
-- Both are empty today, so these are clean adds with no dedupe needed. Doing it now stops
-- them repeating the 172k-row growth the moment they start receiving data — in the
-- assessment table's case, that is the very next sync run after this ships.
-- ---------------------------------------------------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_assessment_scores'
      AND INDEX_NAME='uq_lms_assess_attempt') = 0,
  'ALTER TABLE lms_assessment_scores
     ADD UNIQUE KEY uq_lms_assess_attempt (employee_id, assessment_name, attempt_no)',
  'SELECT "uq_lms_assess_attempt exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_certification_snapshot'
      AND INDEX_NAME='uq_lms_cert_emp_name') = 0,
  'ALTER TABLE lms_certification_snapshot
     ADD UNIQUE KEY uq_lms_cert_emp_name (employee_id, certification_name)',
  'SELECT "uq_lms_cert_emp_name exists"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) rows_now, COUNT(DISTINCT employee_id, course_id) pairs
--   FROM lms_learning_progress_snapshot;
--   -- expect rows_now == pairs (2026-07-31 baseline: 264)
--
-- SELECT COUNT(*) FROM lms_learning_progress_snapshot_backup_1030;
--   -- expect the pre-migration count (2026-07-31 baseline: 172,470)
--
-- No progress value was lost — every surviving row is the newest for its pair:
-- SELECT b.employee_id, b.course_id, COUNT(*) copies_before
--   FROM lms_learning_progress_snapshot_backup_1030 b
--  GROUP BY 1,2 HAVING copies_before > 1 LIMIT 5;
--
-- Confirm the upsert now works — run lms-sync twice and check the count does NOT grow:
-- SELECT COUNT(*) FROM lms_learning_progress_snapshot;
--
-- Once satisfied:
-- DROP TABLE lms_learning_progress_snapshot_backup_1030;
