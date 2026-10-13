-- 2154: bot calling is billed at Rs 2.10 per minute (owner, 2026-10-12). Seeds the rate the cost report reads; never overwrites a value
-- the owner already set. Additive and re-runnable.
INSERT INTO he_model_param (param_key, value, sample) VALUES ('cost.call_per_minute', 2.1000, 0)
  ON DUPLICATE KEY UPDATE param_key = param_key;
