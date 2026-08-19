-- Migration: 1252_kpi_role_template_metrics.sql
-- Purpose: kpi_metric_master definitions for the 10-role-based-KPI-template load (source: HR/Ops
--          spreadsheet "ALl KPI.xlsx" / "KPI_HR Team.xlsx" / Bhavesh Dayal's Admin KPI email,
--          17 Jul 2026). Metric DEFINITIONS only — this file does NOT touch kpi_master_config
--          (the target/weight/org-unit assignment rows) or process_master. Those are pure data,
--          not schema, and are staged separately for owner review before any live write, per
--          the same discipline as the prior GST-code backfill this session.
--
-- NOT REGISTERED in runPendingMigrations.ts yet — do not register/apply until the owner has
-- reviewed the exact final values (see the accompanying review report).
--
-- Scope note: 10 of the ~70 source rows are deliberately excluded from this load:
--   - "Account Manager" and "HR Payroll" sheets: no matching live designation exists; skipped
--     entirely per owner decision, no rows created.
--   - "Team Leader (Paytm)" sheet: HELD. No process_master row exists for Paytm and every
--     Paytm-related cost_centre_master row is inactive with conflicting candidate branches
--     (Ahmedabad-Jaldarshan x2, Karnal x1) — owner confirmed no reliable branch attribution
--     right now. Not loaded into this file; revisit when a branch is confirmed.
--
-- Design notes:
--   1. family='custom', category='custom' for every row here, per owner instruction — this is a
--      standalone role-template metric set, kept separate from the existing generic operational
--      catalog (ATTENDANCE_PCT, SHRINKAGE, QUALITY_SCORE, etc.) even where the underlying concept
--      overlaps. Flagged for the owner's awareness, not silently merged.
--   2. Where the exact same KPI (identical name + semantics) appears verbatim in more than one
--      source sheet, ONE metric row is created and reused across multiple kpi_master_config rows
--      (the schema is explicitly designed for this — one metric, many org-unit configs):
--        SELF_ATTENDANCE_BOOLEAN      -> Program Manager, QA (GPI), Trainer (GPI), HR Recruiter
--        ACPT_AUDITS, ZTP_AUDITS      -> QA (GPI), Trainer (GPI)
--        GPI_SHRINKAGE                -> Team Leader (GPI) [configured], Assistant Manager (GPI) [metric-only, no target given]
--        GPI_ATTRITION_LT10           -> Assistant Manager (GPI), Team Leader (Finfort) [both configured]
--        GPI_CLIENT_SATISFACTION_ESCALATION, COST_CONTROL_ALL_ASPECTS
--                                      -> Assistant Manager (GPI), Team Leader (Finfort) [both metric-only, no target given]
--   3. scoring_type is set EXPLICITLY (not left NULL) for every lower-is-better metric.
--      calculateMetricScore() (backend/src/modules/kpi/kpi-score-engine.ts) treats a NULL/legacy
--      scoring_type as a plain higher-is-better ratio (actual/target*100) regardless of the
--      `direction` column — `direction` is descriptive metadata only, it does not itself flip the
--      formula. Leaving scoring_type NULL on a lower-is-better metric (e.g. Attrition, Shrinkage)
--      would silently invert its score (a WORSE actual would score HIGHER). Every lower_is_better
--      row below carries scoring_type='lower_is_better' for this reason.
--   4. scoring_type='boolean' is used for every KPI whose only given target is a bare `1`
--      (Self Attendance, Client Management - Co-ordination, Hourly Order Taken, all HR Recruiter
--      items). Confirmed calculateMetricScore() has a working boolean branch:
--        actual && actual > 0 ? 100 : 0
--      i.e. actual=1 -> 100, actual=0 -> 0. Verified correct, no fallback needed.
--   5. Where the source sheet gives NO numeric target at all (no Target column, and no target
--      embedded in the KPI name/text) a metric-definition row is still created here, but NO
--      kpi_master_config row will be proposed for it (nothing to assign) — Admin's 7 unweighted
--      items, Assistant Manager (GPI)'s "Shrinkage" / "Client Satisfaction & 0 Escalation" /
--      "Cost control on all aspects", Team Leader (Finfort)'s same two shared items plus
--      "Recruitment v/s Requirement", all 4 HR Executive/Sr Executive groups, all 3 HR
--      Operations groups.
--   6. Admin's 7 WEIGHTED items and Assistant Manager (GPI)'s 5 target-inferable items have no
--      explicit numeric target column in the source either — only a description ("On-time
--      attendance of admin staff", "Vendor services delivered as per agreement", etc.) and a
--      weight. Where that description reads unambiguously as a "% compliance / attainment
--      ratio, ceiling 100%" metric, target_value=100 (percent, higher_is_better) is used as an
--      inferred default — flagged clearly in the review report for owner confirmation, not
--      silently assumed. Metrics where no such unambiguous reading exists (Shrinkage, Client
--      Satisfaction & 0 Escalation, Cost control) are NOT force-defaulted; they fall under
--      point 5 instead.

-- ============================================================================
-- ADMIN — Admin KPI (7 weighted + 7 unweighted; source: Bhavesh Dayal email, 17 Jul 2026)
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'ADMIN_ATTENDANCE_PUNCTUALITY',   'Attendance & Punctuality',        'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_REQUEST_RESOLUTION_TAT',   'Request Resolution TAT',          'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_FACILITY_ISSUE_CLOSURE',   'Facility Issue Closure',          'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_VENDOR_MANAGEMENT',        'Vendor Management',               'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_HOUSEKEEPING_AUDIT_SCORE', 'Housekeeping Audit Score',        'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_ASSET_ACCURACY',           'Asset Accuracy',                  'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_PREVENTIVE_MAINTENANCE',   'Preventive Maintenance',          'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_COST_CONTROL',             'Cost Control',                    'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_INVOICE_PROCESSING',       'Invoice Processing',              'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_INVENTORY_AVAILABILITY',   'Inventory Availability',          'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_INVENTORY_VARIANCE',       'Inventory Variance',              'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'ADMIN_EMPLOYEE_SATISFACTION',    'Employee Satisfaction',           'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_SAFETY_COMPLIANCE',        'Safety Compliance',               'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ADMIN_SECURITY_COMPLIANCE',      'Security Compliance',             'custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- Shared boolean / cross-role metrics (created once, reused by several role configs)
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'SELF_ATTENDANCE_BOOLEAN', 'Self Attendance',              'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1),
  (UUID(), 'ACPT_AUDITS',             'ACPT Audits',                  'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'ZTP_AUDITS',              'ZTP Audits',                   'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'GPI_SHRINKAGE',           'Shrinkage (GPI)',              'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'GPI_ATTRITION_LT10',      'Attrition < 10% (GPI)',        'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'GPI_CLIENT_SATISFACTION_ESCALATION', 'Client Satisfaction & 0 Escalation', 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'COST_CONTROL_ALL_ASPECTS', 'Cost control on all aspects', 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- OPS - Program Manager (Self) KPI (source: Monika Sharma, "ALl KPI.xlsx")
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'PM_REVENUE_VALIDATION_MONITORING', 'Revenue Validations & Monitoring (Fix)', 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'PM_ATTRITION_AGENTS_LEADERSHIP',   'Attrition - Agents & Leadership Team',    'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'PM_SHRINKAGE_AGENTS_LEADERSHIP',   'Shrinkage - Agents & Leadership Team',    'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'PM_ACHIEVEMENT_GPI_TARGETS',       'Achievement - GPI Targets',               'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'PM_INTERNAL_EXTERNAL_QUALITY',     'Internal / External Quality',             'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'PM_PROCESS_RR_ACHIEVEMENT',        'Process R&R Achievement',                 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'PM_CLIENT_MGMT_COORDINATION',      'Client Management - Co ordination',       'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1),
  (UUID(), 'PM_NEW_PROCESS_ONBOARD_SMOOTH',    'New Process onboard go live smoothly',    'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- OPS - GPI Team Leader KPI (source: Monika Sharma, "ALl KPI.xlsx")
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'TL_GPI_HOURLY_ORDER_TAKEN',   'Hourly Order Taken',              'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1),
  (UUID(), 'TL_GPI_ATTRITION',            'Attrition (Team Leader GPI)',     'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'TL_GPI_QUALITY_SCORE',        'Quality Score (Team Leader GPI)', 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'TL_GPI_ORDER_VS_DELIVERY',    'Order vs Delivery',               'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'TL_GPI_EFFECTIVITY_ALL_TOWN', 'Effectivity including all Town',  'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'TL_GPI_PRODUCTIVITY_ALL_TOWN','Productivity including all Town', 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'TL_GPI_LC_ALL_TOWN',          'LC including all Town',           'custom', 'custom', 'count',   'higher_is_better', NULL, 1),
  (UUID(), 'TL_GPI_RR_ACHIEVEMENT',       'R&R Achievement (Team Leader GPI)','custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- OPS - GPI Assistant Manager KPI (source sheet "OPS - GPI AM"; role name corrected from
-- "Account Manager" to "Assistant Manager (GPI)" per owner decision — same sheet data)
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'AM_GPI_REVENUE_RR',           'Revenue GPI (Including R&R)',                          'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'AM_GPI_REVENUE_EX_INCENTIVE', 'Revenue (Excl. Client Incentives)',                     'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'AM_GPI_BILLING_BY_5TH',       'Billing done by 5th every month (all process)',         'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'AM_GPI_COLLECTION_30_DAYS',   'Collection within 30 days of bill',                     'custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- OPS - Finfort Team Leader KPI (source: Monika Sharma, "ALl KPI.xlsx")
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'FF_SEATS_BILLED_100PCT',        '100% Seats billed as approved by client (all process)', 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'FF_SHRINKAGE_LE7',              'Shrinkage Finfort <=7%',                                 'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'FF_RNR_ACHIEVEMENT_MIN65',      'RNR Achievement minimum 65%',                            'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'FF_ATTRITION_LT5',              'Attrition <5% Finfort',                                  'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'FF_RECRUITMENT_VS_REQUIREMENT', 'Recruitment v/s Requirement',                            'custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- QLTY - GPI Quality Analyst KPI (source: Monika Sharma, "ALl KPI.xlsx")
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'QA_GPI_OVERALL_QUALITY_SCORE',   'Overall Quality Score',        'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'QA_GPI_WRONG_PUNCHING',          'Wrong Punching',               'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'QA_GPI_BQ_IMPROVEMENT',          'BQ Improvement',               'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'QA_GPI_ORDER_DELIVERY_GAP_AUDIT','Order vs Delivery Gap Audit',  'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'QA_GPI_QUALITY_REFRESHER_SESSION','Quality Refresher Session',   'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'QA_GPI_LIVE_AUDIT',              'Live Audit',                   'custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- QLTY - GPI Trainer KPI (source: Monika Sharma, "ALl KPI.xlsx")
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'TRAINER_GPI_BATCH_OUTPUT',              'Batch Output',              'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'TRAINER_GPI_BATCH_DROPOUT',              'Batch Dropout',             'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'TRAINER_GPI_NHT_BATCH_QUALITY',          'NHT Batch Quality',         'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'TRAINER_GPI_REBUTTLE_GAP_AUDIT',         'Rebuttle Gap Audit',        'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1),
  (UUID(), 'TRAINER_GPI_TRAINING_REFRESHER_SESSION', 'Training Refresher Session','custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'TRAINER_GPI_CALL_CALIBRATION',           'Call Calibration',          'custom', 'custom', 'percent', 'lower_is_better',  'lower_is_better', 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- HR - Recruiter KPI (source: Monika Sharma, "ALl KPI.xlsx"). Target column is a bare `1` on
-- every row including "Batch attrition less than 5%..." (the <5% lives only in the KPI name,
-- the Target column itself is 1) -- boolean convention applied literally per the given data.
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'HR_RECRUITER_PLANNER_ACHIEVEMENT',    'Recruitment as per Planner & required count achieved', 'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1),
  (UUID(), 'HR_RECRUITER_WINBACK_ATTRITION_SKIP', 'Winback & Attrition control Through Skip Sessions',    'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1),
  (UUID(), 'HR_RECRUITER_ENGAGEMENT_ACTIVITIES',  'Employee Engagement Activities (Min 2)',                'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1),
  (UUID(), 'HR_RECRUITER_TRAINING_FEEDBACK_SURVEY','Training Feedback / Employee Survey',                  'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1),
  (UUID(), 'HR_RECRUITER_BATCH_ATTRITION_LT5',    'Batch attrition <5% after handover (first 3 days)',    'custom', 'custom', 'boolean', 'higher_is_better', 'boolean', 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- HR - Exe & Sr Exe KPI (source: Sheelu Verma, "KPI_HR Team.xlsx"). Definition rows only —
-- no kpi_master_config rows (no numeric target in the source for any of the 4 groups).
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'HR_EXESR_TALENT_ACQUISITION_SOURCING',   'Talent Acquisition & Sourcing',        'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'HR_EXESR_RECRUITMENT_INTERVIEW_PROCESS', 'Recruitment & Interview Process',      'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'HR_EXESR_ONBOARDING_ORIENTATION',        'Onboarding & Orientation',             'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'HR_EXESR_HR_INTERVENTIONS',              'HR Interventions',                     'custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

-- ============================================================================
-- HR - HR Operations KPI (source: Sheelu Verma, "KPI_HR Team.xlsx"). Definition rows only —
-- no kpi_master_config rows (no numeric target in the source for any of the 3 groups).
-- ============================================================================
INSERT INTO kpi_metric_master (id, metric_code, metric_name, family, category, unit, direction, scoring_type, active_status)
VALUES
  (UUID(), 'HR_OPS_ROLLOUT_BGV_PAPERWORK', 'HR Operations (Onboarding, BGV, Paperwork, Exit processing)', 'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'HR_OPS_ATTENDANCE_PAYROLL',    'Attendance & Payroll',                                          'custom', 'custom', 'percent', 'higher_is_better', NULL, 1),
  (UUID(), 'HR_OPS_EMPLOYEE_RELATIONS',    'Employee Relations',                                            'custom', 'custom', 'percent', 'higher_is_better', NULL, 1)
ON DUPLICATE KEY UPDATE
  metric_name = VALUES(metric_name), family = VALUES(family), category = VALUES(category),
  unit = VALUES(unit), direction = VALUES(direction), scoring_type = VALUES(scoring_type);

SELECT '✓ Migration 1252_kpi_role_template_metrics.sql complete (metric definitions only — kpi_master_config and process_master data rows staged separately, NOT executed)' AS status;
