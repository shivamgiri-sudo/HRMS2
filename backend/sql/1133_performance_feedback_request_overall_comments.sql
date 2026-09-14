-- 1133_performance_feedback_request_overall_comments.sql
--
-- Adds performance_feedback_request.overall_comments, the only field in a submitted review
-- that 037_performance_feedback.sql left without a home.
--
-- WHY THE COLUMN IS NEEDED
--
-- The feedback schema stores ratings at one row per (request_id, competency_id) in
-- performance_feedback_response, whose columns are competency_id, rating and comments — the
-- comment there is per competency. A reviewer also writes one closing narrative for the whole
-- review (managerFinalComment in submitFeedbackSchema, max 2000 chars), and there is no
-- column anywhere at that grain: not on the response, which is per competency, and not on the
-- request, which is the reviewer's submission and where it belongs.
--
-- performance_feedback_report.manager_feedback is the field that narrative is ultimately read
-- back into, but the report is generated later by a separate admin-only step
-- (POST /requests/:id/report), so there is nowhere to hold the text between submission and
-- report generation. Without this column generateReport has nothing to put in
-- manager_feedback, and submitFeedback accepts the narrative over the wire and discards it.
--
-- The service used to write the narrative into performance_feedback_response.development_areas
-- and overall_strengths. Neither column exists — see the accompanying service fix — so the
-- text has never actually been stored by any path.
--
-- SHAPE
--
-- TEXT NULL, matching performance_feedback_report.manager_feedback and
-- performance_feedback_response.comments, the two columns it flows between. Nullable because a
-- reviewer submitting ratings without a closing note is normal, and because the five existing
-- performance_feedback_request rows predate the field.
--
-- Additive only. No existing column, index or constraint is touched, and no read path selects
-- * from this table into a positional consumer. Idempotent: guarded by information_schema, so
-- re-running is a no-op.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'performance_feedback_request'
     AND column_name = 'overall_comments'
);

SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE performance_feedback_request ADD COLUMN overall_comments TEXT NULL AFTER status',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
