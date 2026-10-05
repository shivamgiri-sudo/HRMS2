-- 2110: learned model parameters (show-up base rates and multipliers today; more models later). One row per key,
-- rewritten by the nightly learning job from real drive outcomes. Additive and re-runnable.
CREATE TABLE IF NOT EXISTS he_model_param (
  param_key  VARCHAR(80)   NOT NULL PRIMARY KEY,
  value      DECIMAL(8,4)  NOT NULL,
  sample     INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
