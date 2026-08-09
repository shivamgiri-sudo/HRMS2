-- =====================================================
-- Fix engagement schema column mismatches
-- File: 1000_fix_engagement_schema_columns.sql
-- Description: Fixes pulse_id and question_order column issues
-- =====================================================

-- Fix survey_question: Add question_order if missing, rename display_order if it exists
SET @has_display_order = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'survey_question'
    AND COLUMN_NAME = 'display_order'
);

SET @has_question_order = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'survey_question'
    AND COLUMN_NAME = 'question_order'
);

-- If display_order exists but question_order doesn't, rename it
SET @sql_rename_order = IF(
  @has_display_order > 0 AND @has_question_order = 0,
  'ALTER TABLE survey_question CHANGE COLUMN display_order question_order INT NOT NULL',
  'SELECT "survey_question.question_order already exists or no rename needed" AS status'
);
PREPARE stmt FROM @sql_rename_order;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- If neither exists, add question_order
SET @has_question_order_after = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'survey_question'
    AND COLUMN_NAME = 'question_order'
);

SET @sql_add_order = IF(
  @has_question_order_after = 0,
  'ALTER TABLE survey_question ADD COLUMN question_order INT NOT NULL DEFAULT 0',
  'SELECT "survey_question.question_order exists" AS status'
);
PREPARE stmt FROM @sql_add_order;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Fix survey_question: Remove 'id' column if it exists (should be question_id only)
SET @has_id_col = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'survey_question'
    AND COLUMN_NAME = 'id'
);

SET @sql_drop_id = IF(
  @has_id_col > 0,
  'ALTER TABLE survey_question DROP COLUMN id',
  'SELECT "survey_question.id does not exist" AS status'
);
PREPARE stmt FROM @sql_drop_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ensure survey_question has the correct unique constraint
-- Drop old constraint if exists
SET @has_old_uk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'survey_question'
    AND CONSTRAINT_NAME = 'uq_survey_question_order'
);

SET @sql_drop_uk = IF(
  @has_old_uk > 0,
  'ALTER TABLE survey_question DROP INDEX uq_survey_question_order',
  'SELECT "Old unique key does not exist" AS status'
);
PREPARE stmt FROM @sql_drop_uk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add the correct unique constraint
SET @has_new_uk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'survey_question'
    AND INDEX_NAME = 'uq_survey_question_order'
    AND COLUMN_NAME = 'question_order'
);

SET @sql_add_uk = IF(
  @has_new_uk = 0,
  'ALTER TABLE survey_question ADD UNIQUE KEY uq_survey_question_order (survey_id, question_order)',
  'SELECT "survey_question unique constraint already exists" AS status'
);
PREPARE stmt FROM @sql_add_uk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Fix pulse_check: Ensure pulse_id exists as primary key
SET @pulse_has_pulse_id = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'pulse_id'
);

-- If pulse_id doesn't exist, we need to add it
-- First check if there's an 'id' column we should rename
SET @pulse_has_id = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'id'
);

-- Rename id to pulse_id if it exists
SET @sql_rename_pulse_id = IF(
  @pulse_has_id > 0 AND @pulse_has_pulse_id = 0,
  'ALTER TABLE pulse_check CHANGE COLUMN id pulse_id CHAR(36) NOT NULL',
  'SELECT "pulse_check.pulse_id already exists or no rename needed" AS status'
);
PREPARE stmt FROM @sql_rename_pulse_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify pulse_check has all required columns
-- Add mood_rating if missing
SET @has_mood = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'mood_rating'
);

SET @sql_add_mood = IF(
  @has_mood = 0,
  'ALTER TABLE pulse_check ADD COLUMN mood_rating INT NOT NULL COMMENT "1-5 scale"',
  'SELECT "pulse_check.mood_rating exists" AS status'
);
PREPARE stmt FROM @sql_add_mood;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add energy_level if missing
SET @has_energy = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'energy_level'
);

SET @sql_add_energy = IF(
  @has_energy = 0,
  'ALTER TABLE pulse_check ADD COLUMN energy_level INT COMMENT "1-5 scale"',
  'SELECT "pulse_check.energy_level exists" AS status'
);
PREPARE stmt FROM @sql_add_energy;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add stress_level if missing
SET @has_stress = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'stress_level'
);

SET @sql_add_stress = IF(
  @has_stress = 0,
  'ALTER TABLE pulse_check ADD COLUMN stress_level INT COMMENT "1-5 scale"',
  'SELECT "pulse_check.stress_level exists" AS status'
);
PREPARE stmt FROM @sql_add_stress;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add workload_perception if missing
SET @has_workload = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'workload_perception'
);

SET @sql_add_workload = IF(
  @has_workload = 0,
  'ALTER TABLE pulse_check ADD COLUMN workload_perception ENUM("too_light", "manageable", "heavy", "overwhelming")',
  'SELECT "pulse_check.workload_perception exists" AS status'
);
PREPARE stmt FROM @sql_add_workload;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add week_start_date if missing
SET @has_week = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'week_start_date'
);

SET @sql_add_week = IF(
  @has_week = 0,
  'ALTER TABLE pulse_check ADD COLUMN week_start_date DATE NOT NULL',
  'SELECT "pulse_check.week_start_date exists" AS status'
);
PREPARE stmt FROM @sql_add_week;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add feedback_text if missing
SET @has_feedback = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'feedback_text'
);

SET @sql_add_feedback = IF(
  @has_feedback = 0,
  'ALTER TABLE pulse_check ADD COLUMN feedback_text TEXT',
  'SELECT "pulse_check.feedback_text exists" AS status'
);
PREPARE stmt FROM @sql_add_feedback;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add submitted_at if missing
SET @has_submitted = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND COLUMN_NAME = 'submitted_at'
);

SET @sql_add_submitted = IF(
  @has_submitted = 0,
  'ALTER TABLE pulse_check ADD COLUMN submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
  'SELECT "pulse_check.submitted_at exists" AS status'
);
PREPARE stmt FROM @sql_add_submitted;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ensure unique constraint on pulse_check (employee_id, week_start_date)
SET @has_pulse_uk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pulse_check'
    AND CONSTRAINT_NAME = 'unique_employee_week'
);

SET @sql_add_pulse_uk = IF(
  @has_pulse_uk = 0,
  'ALTER TABLE pulse_check ADD UNIQUE KEY unique_employee_week (employee_id, week_start_date)',
  'SELECT "pulse_check unique constraint already exists" AS status'
);
PREPARE stmt FROM @sql_add_pulse_uk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Engagement schema column fixes completed' AS result;
