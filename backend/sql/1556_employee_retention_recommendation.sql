-- Migration 1556: Create employee_retention_recommendation.
-- intervention-recommendation.service.ts generates and stores rule-based retention
-- recommendations per employee with risk tier, prediction score, action tracking and outcome.
-- Additive: CREATE TABLE IF NOT EXISTS, InnoDB utf8mb4.

CREATE TABLE IF NOT EXISTS employee_retention_recommendation (
  id                CHAR(36)          NOT NULL PRIMARY KEY,
  employee_id       CHAR(36)          NOT NULL,
  generated_at      DATETIME          NOT NULL DEFAULT NOW(),
  risk_tier         ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL,
  prediction_score  TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  recommendations   JSON              NOT NULL,
  action_taken      TINYINT(1)        NOT NULL DEFAULT 0,
  action_taken_at   DATETIME          NULL,
  action_taken_by   CHAR(36)          NULL,
  outcome           ENUM('retained','exited','pending') NOT NULL DEFAULT 'pending',
  outcome_date      DATE              NULL,
  created_at        DATETIME          NOT NULL DEFAULT NOW(),
  updated_at        DATETIME          NOT NULL DEFAULT NOW() ON UPDATE NOW(),

  INDEX idx_err_employee   (employee_id),
  INDEX idx_err_risk_tier  (risk_tier),
  INDEX idx_err_outcome    (outcome),
  INDEX idx_err_generated  (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
