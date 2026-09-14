-- 1643 - Dual_Review queue: extends payroll_attendance_conflict_review into a two-reviewer
-- Variance_Review_Queue, and creates attendance_adjustment_request (requirements.md criterion
-- 7.11 in full, plus 7.1, 7.2, 7.3, 7.4, 7.6, 7.8, 7.9, 7.10, Requirement 8, criterion 9.3).
--
-- NOT YET EXECUTED. Needs owner approval before it runs (CLAUDE.md).
--
-- ADDITIVE ONLY. Twenty-seven nullable-or-defaulted columns on an existing table, two indexes,
-- one ENUM widening that keeps all five existing values, one new table. No DROP, no DELETE, no
-- UPDATE, no backfill. The 268 rows already in payroll_attendance_conflict_review keep working
-- unchanged against the CURRENT single-reviewer code: every column added here is NULL or carries
-- a default on those rows, `status` keeps all five of its existing values, and
-- attachReviewState() in payroll-attendance-control.service.ts selects named columns, so the
-- live /payroll/attendance-control-tower surface is unaffected by this file alone.
--
-- Criterion 7.12's mapping of those 268 rows onto the Variance_Record and Review_Outcome
-- vocabulary is a LATER phase (Requirement 15). This migration deliberately does not touch a
-- single existing row: after it applies, every legacy row reads as
-- queue_state IS NULL / first_reviewer_role IS NULL, which is the honest state for a row that
-- was never a Dual_Review.
--
-- WHY EXTEND RATHER THAN REPLACE (criterion 7.11)
-- payroll_attendance_conflict_review (backend/sql/537_payroll_attendance_conflict_review.sql,
-- also created lazily by ensureReviewTable()) records ONE reviewer (`reviewed_by` /
-- `reviewed_at`) and ONE status, so it cannot represent a Dual_Review at all: there is nowhere
-- to put the second reviewer's outcome, and nowhere to say the two disagreed. It is also
-- already live - the control tower reads it - so replacing it would mean moving 268 rows and a
-- working read path to settle a shape question. 7.11 says extend it, and this file does.
--
-- THE TWO REVIEWER SLOTS ARE ROLE-LABELLED, NOT ROLE-TYPED
-- The existing `reviewed_by` / `reviewed_at` pair IS the first of the two slots; this migration
-- adds the SECOND identity and timestamp (`second_reviewer_user_id`, `second_reviewed_at`) plus
-- an outcome and a comment for each slot. Which slot holds the WFM_Reviewer and which holds the
-- Reporting_Manager is recorded per slot in `first_reviewer_role` / `second_reviewer_role` over
-- the Reviewer_Role vocabulary ('wfm_reviewer','reporting_manager') rather than being implied by
-- the column name.
--
-- design.md's data-model sketch instead names four `wfm_*` and four `manager_*` columns, i.e. two
-- brand-new slots. That is not used here for two reasons. First, it strands `reviewed_by` /
-- `reviewed_at`: 268 rows populate them and attachReviewState() reads them, so they would become
-- a third reviewer slot with no defined meaning, and 7.11 asks for A second reviewer identity,
-- not a second and a third. Second, role-typed slots cannot express criterion 7.6 honestly - when
-- the branch WFM point of contact stands in for an absent Reporting_Manager, a `manager_outcome`
-- column would be holding a WFM person's decision. With role labels the substitution is stated
-- (`manager_substitution_applied`, `substitute_spoc_user_id`) and the slot still says truthfully
-- which kind of reviewer filled it.
--
-- WHY THERE IS NO `contested` TINYINT
-- The contested state of criterion 7.10 is the new `status` ENUM value 'contested', added by the
-- MODIFY COLUMN below. A boolean column alongside it would be a second, independently writable
-- representation of one fact, and the two can disagree - so only `contested_at` (when it happened)
-- and `override_approver_user_id` (criterion 7.10's routing target) are added. That is also the
-- only reason the ENUM has to be widened at all.
--
-- CRITERION 7.2: SNAPSHOT THE SCALARS, JOIN THE SETS
-- 7.2 requires the queue to present Biometric_Minutes, Canonical_Productive_Minutes, the applied
-- APR_Corroboration_Threshold, the resolved Attendance_Source, the per-Dialler_Source
-- contributions and the biometric punch times. The four scalars are snapshotted onto the record
-- (criterion 6.3 requires them recorded ON the Variance_Record anyway, and a reviewer must see
-- the threshold that was applied when the record was raised, not the threshold configured today).
-- The two SET-VALUED items are NOT denormalised here and are joined at read time:
--
--   * per-Dialler_Source contributions -> attendance_productive_contribution (migration 1637),
--     keyed (employee_id, work_date), whose live set is `superseded_at IS NULL`. A corrected
--     re-upload supersedes contributions and re-derives Canonical_Productive_Minutes, so a JSON
--     copy taken at flag time would silently disagree with the aggregator's own rows the first
--     time a branch re-uploaded a report - and criterion 11.7's aggregation-traceability property
--     is only checkable against the same rows the aggregator wrote. A JSON blob would also have
--     to be re-validated on every read to be trusted, which is more work than the join it saves.
--   * biometric punch times -> attendance_daily_record.clock_in_time / clock_out_time
--     (backend/sql/070_attendance_clock_columns.sql) with the biometric_attendance_log first/last
--     punch fallback, which is the chain calculateLateArrival() already uses. Copying them would
--     fork that fallback chain into a second implementation that ages differently.
--
-- Both joins are on (employee_id, issue_date), already covered by
-- idx_payroll_att_conflict_employee_date, and both target tables are indexed on
-- (employee_id, work_date). The queue is at most a few hundred rows per branch-month
-- (Dual_Review_Ceiling defaults to 100), so this is a bounded join, not a scan.
--
-- CONVENTIONS
-- Every ADD COLUMN is guarded on information_schema.columns via PREPARE/EXECUTE, and both
-- indexes on information_schema.statistics. ADD COLUMN IF NOT EXISTS is MariaDB syntax that this
-- server's MySQL 8 rejects at parse time while the runner records the file as applied - that is
-- what got migration 1064 dropped. 1637 is the working guard pattern this file follows.
--
-- No AFTER clause on any ADD COLUMN, unlike 1637's three chained columns: with twenty-seven
-- guarded blocks, an AFTER naming the previous column makes each block's outcome depend on
-- whether the previous one ran, so a partially applied table would replay into a different
-- column order. Appending is order-independent and idempotent. Physical column order carries no
-- meaning here.
--
-- MODIFY COLUMN lists ALL SIX values (the five existing plus 'contested'). Dropping one would
-- orphan the rows holding it - 209 rows are 'reviewed' and 59 are 'notified' today. The MODIFY
-- deliberately carries NO COLLATE clause: 537 declared no CHARSET, the table is absent from
-- migration 1627's 49-table repair sweep, so its actual collation is the server default and
-- unverified here. Restating a collation on an existing column would convert that one column
-- away from the rest of its own table.
--
-- Every string column this file ADDS does carry an explicit COLLATE utf8mb4_unicode_ci, which is
-- load-bearing rather than cosmetic: the CHAR(36) user-id columns join to auth_user and employees
-- (both utf8mb4_unicode_ci), and a bare CHARSET=utf8mb4 resolves to the SERVER default on MySQL 8,
-- making that join a hard errno 1267 rather than a warning. Migration 1627 exists solely to
-- repair the 49 tables that already hit this. The consequence is deliberate: the columns added
-- here are utf8mb4_unicode_ci while the pre-existing columns of the same table may not be, so a
-- comparison BETWEEN an old and a new string column in this table would need a cast. No query
-- needs one - the new user-id columns are compared against auth_user, not against
-- payroll_attendance_conflict_review's own employee_id.
--
-- No FOREIGN KEY anywhere, matching every other table in this feature (see 1636's header -
-- migration 1500's FK to process_master is the one that blocked every deploy).
-- CREATE TABLE IF NOT EXISTS for the new table. A replay of this whole file is a no-op.
--
-- ROLLBACK
--   DROP TABLE attendance_adjustment_request;
--   ALTER TABLE payroll_attendance_conflict_review
--     DROP INDEX idx_pacr_queue_rank,
--     DROP INDEX idx_pacr_presented;
--   ALTER TABLE payroll_attendance_conflict_review
--     MODIFY COLUMN status ENUM('open','notified','reviewed','no_issue','regularization_required')
--       NOT NULL DEFAULT 'open';
--   ALTER TABLE payroll_attendance_conflict_review
--     DROP COLUMN first_reviewer_role,
--     DROP COLUMN first_review_outcome,
--     DROP COLUMN first_review_comment,
--     DROP COLUMN second_reviewer_user_id,
--     DROP COLUMN second_reviewed_at,
--     DROP COLUMN second_reviewer_role,
--     DROP COLUMN second_review_outcome,
--     DROP COLUMN second_review_comment,
--     DROP COLUMN contested_at,
--     DROP COLUMN override_approver_user_id,
--     DROP COLUMN presented_at,
--     DROP COLUMN escalation_age_days,
--     DROP COLUMN escalation_interval_days,
--     DROP COLUMN last_escalated_at,
--     DROP COLUMN variance_risk_score,
--     DROP COLUMN queue_state,
--     DROP COLUMN is_floor_absence,
--     DROP COLUMN manager_substitution_applied,
--     DROP COLUMN substitute_spoc_user_id,
--     DROP COLUMN biometric_minutes,
--     DROP COLUMN canonical_productive_minutes,
--     DROP COLUMN applied_corroboration_threshold,
--     DROP COLUMN applied_variance_tolerance,
--     DROP COLUMN resolved_attendance_source,
--     DROP COLUMN deciding_rule_id,
--     DROP COLUMN pay_month,
--     DROP COLUMN carried_forward_from_pay_month;
--   The status MODIFY must run only after any row holding 'contested' has been moved off it.

-- ---------------------------------------------------------------------------
-- Reviewer slot 1: the EXISTING reviewed_by / reviewed_at pair, plus its role,
-- outcome and comment (criteria 7.3, 7.4, 7.11).
-- ---------------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'first_reviewer_role') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN first_reviewer_role ENUM(''wfm_reviewer'',''reporting_manager'')
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Reviewer_Role held by the existing reviewed_by/reviewed_at slot. NULL on the 268 pre-Dual_Review rows.''',
  'SELECT ''first_reviewer_role already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'first_review_outcome') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN first_review_outcome ENUM(''apr_accepted'',''apr_disputed'',''adjustment_requested'')
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Review_Outcome recorded by the first reviewer (criterion 7.3).''',
  'SELECT ''first_review_outcome already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- TEXT, not VARCHAR(n): criterion 7.4 sets a 20-character FLOOR for apr_disputed and
-- adjustment_requested and no ceiling, and the reviewer is writing prose explaining a
-- productivity dispute. The 20-character minimum is enforced in the application, not here -
-- a CHECK constraint would refuse the shorter comment that apr_accepted is allowed to carry.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'first_review_comment') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN first_review_comment TEXT
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''First reviewer comment (criterion 7.3). Minimum 20 chars for apr_disputed/adjustment_requested enforced in the application (7.4).''',
  'SELECT ''first_review_comment already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Reviewer slot 2: the second reviewer identity and timestamp criterion 7.11
-- names, plus its role, outcome and comment.
-- ---------------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'second_reviewer_user_id') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN second_reviewer_user_id CHAR(36)
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Second reviewer identity (criterion 7.11). auth_user.id. No FK, per this feature.''',
  'SELECT ''second_reviewer_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'second_reviewed_at') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN second_reviewed_at DATETIME NULL
       COMMENT ''When the second reviewer recorded an outcome (criterion 7.3). Both slots set means reviewed (7.5).''',
  'SELECT ''second_reviewed_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'second_reviewer_role') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN second_reviewer_role ENUM(''wfm_reviewer'',''reporting_manager'')
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Reviewer_Role held by the second slot. Must differ from first_reviewer_role for a complete Dual_Review; enforced in the application.''',
  'SELECT ''second_reviewer_role already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'second_review_outcome') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN second_review_outcome ENUM(''apr_accepted'',''apr_disputed'',''adjustment_requested'')
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Review_Outcome recorded by the second reviewer (criterion 7.3). Conflicting outcomes set status = contested (7.10).''',
  'SELECT ''second_review_outcome already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'second_review_comment') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN second_review_comment TEXT
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Second reviewer comment (criterion 7.3). 20-char minimum enforced in the application (7.4).''',
  'SELECT ''second_review_comment already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Contested state (criterion 7.10). The state itself is status = 'contested',
-- widened at the foot of this file.
-- ---------------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'contested_at') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN contested_at DATETIME NULL
       COMMENT ''When the two reviewers were found to conflict (criterion 7.10). Set with status = contested.''',
  'SELECT ''contested_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'override_approver_user_id') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN override_approver_user_id CHAR(36)
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Override_Approver for the employee branch that a contested record routes to (criterion 7.10). auth_user.id.''',
  'SELECT ''override_approver_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Escalation / SLA (criteria 7.8, 7.9).
-- ---------------------------------------------------------------------------

-- 7.8 counts whole days SINCE THE RECORD WAS PRESENTED, which is not created_at: a record
-- raised while mismatch_workflow_enabled is 0 is recorded and presented to nobody (criterion
-- 9.9), so created_at would start an SLA clock against reviewers who cannot see the item.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'presented_at') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN presented_at DATETIME NULL
       COMMENT ''When the record was first presented for Dual_Review. Start of the escalation clock (criterion 7.8). NULL = presented to nobody yet.''',
  'SELECT ''presented_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- NULL-able WITH a DEFAULT of 3: an INSERT that omits the column carries criterion 7.9's three
-- whole days as a stored fact, while an explicit NULL remains writable so "the configured
-- escalation age is absent" stays representable and the application applies 3 on read.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'escalation_age_days') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN escalation_age_days SMALLINT UNSIGNED NULL DEFAULT 3
       COMMENT ''Whole days unreviewed before escalating (criterion 7.8). Absent means three whole days (criterion 7.9).''',
  'SELECT ''escalation_age_days already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- No DEFAULT: no criterion states an escalation interval, and a number defaulted in DDL would
-- read back as configured policy when nothing chose it. NULL means unconfigured.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'escalation_interval_days') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN escalation_interval_days SMALLINT UNSIGNED NULL
       COMMENT ''Days between repeat escalation notices (criterion 7.8). NULL = unconfigured; no criterion states a default.''',
  'SELECT ''escalation_interval_days already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'last_escalated_at') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN last_escalated_at DATETIME NULL
       COMMENT ''Last escalation notice sent. Makes criterion 7.8 once-per-interval idempotent across worker runs.''',
  'SELECT ''last_escalated_at already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Ranking and queue state (criteria 6.9, 6.11, 7.1, 7.11).
-- ---------------------------------------------------------------------------

-- SIGNED INT, deliberately. design.md defines
-- Variance_Risk_Score = Biometric_Minutes - Canonical_Productive_Minutes, and criterion 6.4
-- raises a Variance_Record on the dialler-resolved side too, where productive minutes can
-- exceed biometric minutes - so the score goes negative. An UNSIGNED column would wrap those
-- to a huge positive value and put the least risky records at the TOP of criterion 6.9's
-- ranking, silently inverting the ceiling.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'variance_risk_score') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN variance_risk_score INT NULL
       COMMENT ''Biometric_Minutes minus Canonical_Productive_Minutes. SIGNED: negative under criterion 6.4. Ranks criterion 6.9.''',
  'SELECT ''variance_risk_score already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Criterion 7.1: a recorded_not_queued record stays retrievable and reportable (6.11, 9.5) but
-- is never presented for Dual_Review. NULL is the third, honest state - a legacy row that was
-- never a Variance_Record at all - and is likewise not presented.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'queue_state') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN queue_state ENUM(''queued_for_dual_review'',''recorded_not_queued'')
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Queue_State (criteria 6.9, 6.11, 7.1). Only queued_for_dual_review is presented for review. NULL = not a Variance_Record.''',
  'SELECT ''queue_state already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'is_floor_absence') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN is_floor_absence TINYINT NOT NULL DEFAULT 0
       COMMENT ''1 = carries a Floor_Absence_Pattern occurrence, so queued irrespective of the Dual_Review_Ceiling (criterion 6.8).''',
  'SELECT ''is_floor_absence already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Criterion 7.6 substitution: the branch WFM point of contact stood in for an
-- absent Reporting_Manager. Two facts, both required: THAT it happened, and WHO.
-- ---------------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'manager_substitution_applied') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN manager_substitution_applied TINYINT NOT NULL DEFAULT 0
       COMMENT ''1 = routed to the branch WFM point of contact because the employee has no Reporting_Manager (criterion 7.6). 1 of 1,123 active employees.''',
  'SELECT ''manager_substitution_applied already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The resolved user, stored rather than re-derived: branch_wfm_spoc_config is effective-dated
-- (effective_from / effective_to / is_active), so re-resolving it later would name whoever holds
-- the post now, not the person who was actually asked to review this record.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'substitute_spoc_user_id') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN substitute_spoc_user_id CHAR(36)
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''The branch WFM point of contact who stood in (criterion 7.6), resolved from branch_wfm_spoc_config at routing time. auth_user.id.''',
  'SELECT ''substitute_spoc_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Evidence snapshot (criteria 6.3, 7.2). Scalars only - see the header on why
-- the per-Dialler_Source contributions and punch times are joined, not copied.
-- ---------------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'biometric_minutes') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN biometric_minutes SMALLINT UNSIGNED NULL
       COMMENT ''Biometric_Minutes as at flag time (criteria 6.3, 7.2). NULL = absent, never a measured zero.''',
  'SELECT ''biometric_minutes already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'canonical_productive_minutes') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN canonical_productive_minutes SMALLINT UNSIGNED NULL
       COMMENT ''Canonical_Productive_Minutes as at flag time (criteria 6.3, 7.2). NULL = absent, never a measured zero.''',
  'SELECT ''canonical_productive_minutes already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The threshold that WAS applied, not the one configured now: attendance_threshold_rule (1635)
-- is effective-dated, so a reviewer reading a record raised last month must see the number that
-- raised it or the flag cannot be explained.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'applied_corroboration_threshold') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN applied_corroboration_threshold SMALLINT UNSIGNED NULL
       COMMENT ''APR_Corroboration_Threshold applied when this record was raised (criteria 6.3, 7.2). Default 480.''',
  'SELECT ''applied_corroboration_threshold already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'applied_variance_tolerance') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN applied_variance_tolerance SMALLINT UNSIGNED NULL
       COMMENT ''Variance_Tolerance applied when this record was raised (criterion 6.3). Default 60.''',
  'SELECT ''applied_variance_tolerance already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'resolved_attendance_source') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN resolved_attendance_source ENUM(''dialler'',''biometric'')
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Attendance_Source the rule store resolved for this employee-date (criteria 6.3, 7.2).''',
  'SELECT ''resolved_attendance_source already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'deciding_rule_id') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN deciding_rule_id CHAR(36)
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''attendance_source_rule.id that resolved the source (criterion 6.3). Also drives criterion 14.5 rule-author-cannot-approve.''',
  'SELECT ''deciding_rule_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Pay_Month (criteria 9.3, 13.2). CHAR(7) 'YYYY-MM', matching
-- attendance_source_rule_proposal.applied_in_pay_month (1642) and
-- salary_prep_run.run_month, which is compared as a string.
-- ---------------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'pay_month') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN pay_month CHAR(7)
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Pay_Month (YYYY-MM) the issue_date falls in. Scopes criteria 6.9 ranking and 9.5 reconciliation.''',
  'SELECT ''pay_month already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Criterion 9.3: an unreviewed record survives Payroll_Cut_Off and is PRESENTED AS CARRIED
-- FORWARD FROM that Pay_Month. That needs the originating month kept separately from pay_month,
-- because a record carried into a later open month must still say which closed month it came
-- from; rewriting pay_month alone would erase it.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'carried_forward_from_pay_month') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD COLUMN carried_forward_from_pay_month CHAR(7)
       COLLATE utf8mb4_unicode_ci NULL
       COMMENT ''Pay_Month (YYYY-MM) this record was carried forward from after Payroll_Cut_Off (criterion 9.3). NULL = not carried forward.''',
  'SELECT ''carried_forward_from_pay_month already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Indexes. Guarded on information_schema.statistics: CREATE INDEX has no
-- IF NOT EXISTS on MySQL 8 either, and a duplicate key name is errno 1061.
-- ---------------------------------------------------------------------------

-- Criterion 6.9 ranks candidates by variance_risk_score DESC within one branch and Pay_Month
-- and queues up to the ceiling. design.md stores the score precisely so that is a sort on an
-- indexed column rather than a computed expression; without this index the stored column buys
-- nothing.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND index_name = 'idx_pacr_queue_rank') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD INDEX idx_pacr_queue_rank (pay_month, queue_state, variance_risk_score)',
  'SELECT ''idx_pacr_queue_rank already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Criterion 7.8's escalation sweep: unreviewed records whose presented_at is at least the
-- escalation age old. Without this the sweep scans the whole table on every worker run.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND index_name = 'idx_pacr_presented') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     ADD INDEX idx_pacr_presented (presented_at, last_escalated_at)',
  'SELECT ''idx_pacr_presented already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- status ENUM: add 'contested' (criterion 7.10), keep all five existing values.
-- Guarded on column_type so a replay is a no-op. No COLLATE clause - see header.
-- ---------------------------------------------------------------------------

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'payroll_attendance_conflict_review'
      AND column_name = 'status'
      AND column_type LIKE '%contested%') = 0,
  'ALTER TABLE payroll_attendance_conflict_review
     MODIFY COLUMN status
       ENUM(''open'',''notified'',''reviewed'',''no_issue'',''regularization_required'',''contested'')
       NOT NULL DEFAULT ''open''
       COMMENT ''Presentation state. contested added by 1643 (criterion 7.10); the five original values are unchanged and the 268 existing rows keep theirs.''',
  'SELECT ''status already carries contested'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Requirement 8: the adjustment request, distinct from the Review_Outcome.
-- ---------------------------------------------------------------------------
--
-- Criterion 8.2 requires the request to be a THING, not a status: recording
-- `adjustment_requested` is a reviewer's opinion and changes nothing an employee is paid
-- (criterion 8.1), while approving the request moves salary days (8.3). Those are different
-- acts by different people at different times, so they cannot share a row with the review.
--
-- Criteria 8.5 and 8.6 are enforced in the application - a CHECK cannot see salary_prep_run,
-- and 8.5's own criterion is about refusing an APPROVAL, not about a storable invariant. The
-- table is nevertheless shaped so both are auditable AFTER the fact from this table alone:
-- 8.5 by requesting_user_id <> approver_user_id on any row with approval_state = 'approved',
-- 8.6 by target_pay_month against salary_prep_run for the same rows. Neither audit needs a
-- join to a log.
--
-- superseded_classification / superseded_lwp_value carry criterion 8.7's reversibility
-- property: the classification daily processing produced BEFORE the adjustment applied. They
-- are written at approval time, from the record being replaced, which is the only moment the
-- prior value is still readable.
CREATE TABLE IF NOT EXISTS attendance_adjustment_request (
  id                        CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  -- payroll_attendance_conflict_review.id. Not unique: a rejected request may be followed by
  -- another for the same Variance_Record, and losing that history would hide a second attempt.
  variance_record_id        CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  employee_id               CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  target_date               DATE          NOT NULL,
  -- 'YYYY-MM' of target_date, stored so criterion 8.6's cut-off audit is a single-table read
  -- against salary_prep_run.run_month rather than arithmetic over target_date.
  target_pay_month          CHAR(7)       COLLATE utf8mb4_unicode_ci NOT NULL,
  requested_classification  VARCHAR(64)   COLLATE utf8mb4_unicode_ci NOT NULL,
  requested_lwp_value       DECIMAL(4,2)  NULL,
  requesting_user_id        CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  requesting_reviewer_role  ENUM('wfm_reviewer','reporting_manager') COLLATE utf8mb4_unicode_ci NULL,
  -- TEXT and NOT NULL: criterion 8.3 requires the justification recorded with the approval, and
  -- 8.2 requires the requesting reviewer to state one, so a request without it is not a request.
  justification             TEXT          COLLATE utf8mb4_unicode_ci NOT NULL,
  approval_state            ENUM('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  approver_user_id          CHAR(36)      COLLATE utf8mb4_unicode_ci NULL,
  approved_at               DATETIME      NULL,
  decision_note             TEXT          COLLATE utf8mb4_unicode_ci NULL,
  -- criterion 8.7 reversibility. NULL while pending: there is nothing superseded yet.
  superseded_classification VARCHAR(64)   COLLATE utf8mb4_unicode_ci NULL,
  superseded_lwp_value      DECIMAL(4,2)  NULL,
  -- criterion 9.4: the earliest open Pay_Month the arrear or recovery was raised in, when the
  -- target month had already reached Payroll_Cut_Off. NULL = applied in its own month.
  arrear_pay_month          CHAR(7)       COLLATE utf8mb4_unicode_ci NULL,
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aar_variance (variance_record_id),
  KEY idx_aar_employee_date (employee_id, target_date),
  KEY idx_aar_state_month (approval_state, target_pay_month),
  KEY idx_aar_requester (requesting_user_id),
  KEY idx_aar_approver (approver_user_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Requirement 8 adjustment requests: a request to change a classification, separate from the Review_Outcome that prompted it. Not written by anything yet.';

SELECT '1643 applied: payroll_attendance_conflict_review Dual_Review columns + status contested + attendance_adjustment_request' AS migration_status;
