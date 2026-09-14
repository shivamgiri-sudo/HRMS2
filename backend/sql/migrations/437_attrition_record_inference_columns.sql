-- backend/sql/migrations/437_attrition_record_inference_columns.sql
-- Adds AI-inference columns to attrition_record so the attrition-risk engine
-- can record its inferred exit reason, confidence level, and the signal codes
-- that triggered the inference without touching existing columns.
-- Additive / backward-compatible — safe to apply against existing schema.

ALTER TABLE attrition_record
  ADD COLUMN IF NOT EXISTS inferred_reason VARCHAR(50) NULL
    COMMENT 'BETTER_OFFER|BURNOUT|PERFORMANCE_EXIT|EARLY_ATTRITION|MANAGER_DRIVEN|TRAINING_DIFFICULTY|SALARY_DISSATISFACTION|WORK_LIFE|UNKNOWN',
  ADD COLUMN IF NOT EXISTS inference_confidence ENUM('HIGH','MEDIUM','LOW') NULL,
  ADD COLUMN IF NOT EXISTS inference_signals JSON NULL
    COMMENT 'Array of signal codes that triggered inference';

ALTER TABLE attrition_record
  ADD INDEX IF NOT EXISTS idx_attrition_inferred_reason (inferred_reason);
