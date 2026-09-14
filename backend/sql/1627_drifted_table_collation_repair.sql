-- Migration: 1627_drifted_table_collation_repair.sql
-- Purpose: Convert 49 tables from utf8mb4_0900_ai_ci to the schema default
--          utf8mb4_unicode_ci, so any string column on them can be joined to the rest of
--          mas_hrms at all.
-- Date: 2026-08-28
--
-- Issue: On MySQL 8 a bare CHARSET=utf8mb4 in a CREATE TABLE resolves to the server default
--        utf8mb4_0900_ai_ci, not the database default. mas_hrms and employees are
--        utf8mb4_unicode_ci. Comparing two differently-collated VARCHARs is not a warning,
--        it is a hard ER_CANT_AGGREGATE_2COLLATIONS (errno 1267) — so each of these tables
--        breaks the first time anyone joins it on a string. Migrations 1617 and 1618 each
--        fixed one instance of this AFTER it took an endpoint or a cron down in production.
--        A live sweep on 2026-08-28 found 57 tables still carrying the wrong collation.
--
--        The second cost is silent: where code already works around the clash with an inline
--        COLLATE cast, that cast makes the column a non-indexable expression. Measured on
--        cosec_punch_sync (3.04M rows), a sole-predicate lookup:
--            no cast                       23ms   ref/idx_user_date
--            cast to its OWN collation     12ms   ref/idx_user_date
--            cast to a DIFFERENT collation 4157ms index scan, 3,039,163 rows
--        So once the collations agree, the ~127 existing COLLATE casts in backend/src stop
--        costing anything and can be left exactly where they are. This migration deliberately
--        ships WITHOUT any code change: converting the tables is safe on its own, whereas
--        removing casts before the tables convert would raise errno 1267 immediately.
--
-- Scope: every drifted table at or under 50 MB that carries no foreign key.
--        Deliberately EXCLUDED, each needing its own scheduled window because CONVERT
--        rewrites the whole table:
--          - cosec_punch_sync (3039163 rows, 390 MB)
--          - attendance_legacy_snapshot (2105841 rows, 724 MB)
--          - migration_error (7158 rows, 57 MB)
--        Also excluded, because converting one side of a foreign key before the other is
--        rejected with errno 3780 and these are all empty anyway (no urgency):
--          - outbound_funnel_detail (0 rows)
--          - inbound_funnel_detail (0 rows)
--          - email_funnel_detail (0 rows)
--          - conversion_funnel_event (0 rows)
--          - chat_funnel_detail (0 rows)
--
-- Safety: every statement is guarded on the table's CURRENT collation, so it is a no-op once
--        applied and re-running costs one information_schema lookup each. utf8mb4_unicode_ci
--        and utf8mb4_0900_ai_ci are both case- and accent-insensitive over the same utf8mb4
--        repertoire, so no row can collide or change meaning — only sort/compare rules change,
--        which is the entire point. No column is added, dropped or retyped; no row is deleted.
--        Existing inline COLLATE casts keep working against a converted table (verified on a
--        scratch copy: identical 771-row result before and after).

--  1. cosec_daily_agg  (277842 rows, 35 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cosec_daily_agg');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE cosec_daily_agg CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''cosec_daily_agg already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

--  2. wfh_attendance_snapshot  (267860 rows, 44 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfh_attendance_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE wfh_attendance_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''wfh_attendance_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

--  3. doc_legacy_snapshot  (264829 rows, 44 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'doc_legacy_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE doc_legacy_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''doc_legacy_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

--  4. field_attendance_snapshot  (106607 rows, 19 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'field_attendance_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE field_attendance_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''field_attendance_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

--  5. cosec_unmapped_users  (91040 rows, 16 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cosec_unmapped_users');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE cosec_unmapped_users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''cosec_unmapped_users already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

--  6. migration_log  (89972 rows, 21 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'migration_log');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE migration_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''migration_log already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

--  7. incentive_upload_snapshot  (80532 rows, 20 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE incentive_upload_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''incentive_upload_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

--  8. salary_upload_snapshot  (39259 rows, 12 MB)
--
-- This one table needs sql_mode relaxed around its CONVERT, and it is the ONLY one of the 49
-- that does. CONVERT TO CHARACTER SET rewrites every row, which re-validates it against the
-- session sql_mode -- and the server runs STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE
-- while all 39,099 rows of salary_upload_snapshot.sal_date hold '0000-00-00 00:00:00'. So the
-- rewrite aborts with "Incorrect datetime value: '0000-00-00 00:00:00' for column 'sal_date' at
-- row 1", the migration is recorded success=0, and the boot guard then refuses to start the
-- backend -- which is why every Deploy to Production run failed from 2026-08-26 to 2026-08-28
-- (10 consecutive, health check never satisfied, dist rolled back each time). The migration's
-- own pre-flight exercised cosec_daily_agg, billing_provision_snapshot and lms_learner_progress;
-- salary_upload_snapshot was not among them, so this never surfaced before it shipped.
--
-- Relaxing the mode does NOT change any data: the zero dates are preserved exactly as they are.
-- It only stops a collation change from doubling as a date-validation gate, which was never this
-- migration's job. Fixing the data instead would mean writing 39,099 rows of a salary table, so
-- it is deliberately not done here. Verified 2026-08-28 that this is the only affected table:
-- every date/datetime/timestamp column on all 42 still-drifted tables was scanned for
-- '0000-00-00%' and salary_upload_snapshot.sal_date is the sole hit.
--
-- The previous mode is captured and restored so the remaining 41 conversions still run under
-- the server's normal strictness.
SET @prev_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION';

SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_upload_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE salary_upload_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''salary_upload_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET SESSION sql_mode = @prev_sql_mode;

--  9. qual_leave_snapshot  (18389 rows, 2 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qual_leave_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE qual_leave_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''qual_leave_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 10. qual_attendance_snapshot  (11011 rows, 2 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qual_attendance_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE qual_attendance_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''qual_attendance_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 11. billing_invoice_snapshot  (10730 rows, 7 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_invoice_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE billing_invoice_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''billing_invoice_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 12. qual_salary_snapshot  (9216 rows, 3 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qual_salary_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE qual_salary_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''qual_salary_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 13. billing_provision_snapshot  (7126 rows, 4 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_provision_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE billing_provision_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''billing_provision_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 14. od_register_snapshot  (3432 rows, 2 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'od_register_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE od_register_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''od_register_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 15. security_audit_event  (2287 rows, 1 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'security_audit_event');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE security_audit_event CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''security_audit_event already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 16. leave_el_accrual_ledger  (1865 rows, 1 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leave_el_accrual_ledger');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE leave_el_accrual_ledger CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''leave_el_accrual_ledger already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 17. master_activity_status_backup  (1627 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'master_activity_status_backup');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE master_activity_status_backup CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''master_activity_status_backup already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 18. change_doj_snapshot  (1541 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'change_doj_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE change_doj_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''change_doj_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 19. incometax_legacy_snapshot  (1509 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incometax_legacy_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE incometax_legacy_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''incometax_legacy_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 20. lms_learner_progress  (1240 rows, 1 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_learner_progress');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE lms_learner_progress CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''lms_learner_progress already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 21. employee_move_snapshot  (1063 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_move_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE employee_move_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''employee_move_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 22. lms_sync_audit  (991 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_sync_audit');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE lms_sync_audit CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''lms_sync_audit already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 23. bill_client_snapshot  (893 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bill_client_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE bill_client_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''bill_client_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 24. lms_assessment_scores  (468 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_assessment_scores');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE lms_assessment_scores CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''lms_assessment_scores already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 25. candidate_onboarding_otp  (192 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_otp');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE candidate_onboarding_otp CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''candidate_onboarding_otp already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 26. candidate_onboarding_language  (116 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_language');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE candidate_onboarding_language CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''candidate_onboarding_language already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 27. company_posts  (39 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_posts');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE company_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''company_posts already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 28. funnel_stage_config  (19 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funnel_stage_config');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE funnel_stage_config CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''funnel_stage_config already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 29. business_policy_config  (13 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_policy_config');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE business_policy_config CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''business_policy_config already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 30. expense_policy  (7 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expense_policy');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE expense_policy CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''expense_policy already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 31. company_post_media  (6 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_post_media');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE company_post_media CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''company_post_media already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 32. business_policy_config_history  (4 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_policy_config_history');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE business_policy_config_history CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''business_policy_config_history already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 33. cosec_sync_watermark  (3 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cosec_sync_watermark');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE cosec_sync_watermark CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''cosec_sync_watermark already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 34. communication_provider_config  (2 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'communication_provider_config');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE communication_provider_config CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''communication_provider_config already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 35. company_post_creator_access  (2 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_post_creator_access');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE company_post_creator_access CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''company_post_creator_access already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 36. policy_master  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'policy_master');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE policy_master CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''policy_master already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 37. apr_manual_upload  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr_manual_upload');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE apr_manual_upload CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''apr_manual_upload already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 38. portal_data_approval_queue  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_data_approval_queue');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE portal_data_approval_queue CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''portal_data_approval_queue already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 39. portal_published_snapshot  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_published_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE portal_published_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''portal_published_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 40. user_hr_request  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_hr_request');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE user_hr_request CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''user_hr_request already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 41. source_sync_watermark  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'source_sync_watermark');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE source_sync_watermark CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''source_sync_watermark already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 42. rbac_matrix_applied_grants  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rbac_matrix_applied_grants');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE rbac_matrix_applied_grants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''rbac_matrix_applied_grants already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 43. location_master  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'location_master');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE location_master CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''location_master already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 44. funnel_org_performance  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funnel_org_performance');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE funnel_org_performance CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''funnel_org_performance already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 45. funnel_daily_snapshot  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'funnel_daily_snapshot');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE funnel_daily_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''funnel_daily_snapshot already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 46. billing_invoice  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_invoice');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE billing_invoice CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''billing_invoice already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 47. company_post_audit_log  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_post_audit_log');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE company_post_audit_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''company_post_audit_log already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 48. candidate_onboarding_autosave  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_autosave');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE candidate_onboarding_autosave CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''candidate_onboarding_autosave already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 49. billing_unit  (0 rows, 0 MB)
SET @col = (SELECT TABLE_COLLATION FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_unit');
SET @sql = IF(@col IS NOT NULL AND @col <> 'utf8mb4_unicode_ci',
  'ALTER TABLE billing_unit CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''billing_unit already utf8mb4_unicode_ci (or absent)'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 1627_drifted_table_collation_repair.sql complete' AS status;
