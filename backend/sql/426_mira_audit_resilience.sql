-- 426_mira_audit_resilience.sql
-- Ensures Mira audit persistence exists without allowing audit outages to block user answers.

CREATE TABLE IF NOT EXISTS ai_provider_usage_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider_key VARCHAR(80) NOT NULL,
  model_name VARCHAR(180) NULL,
  user_id VARCHAR(100) NOT NULL,
  role_keys_json JSON NULL,
  request_source VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NULL,
  entity_id VARCHAR(100) NULL,
  input_token_count INT UNSIGNED NULL,
  output_token_count INT UNSIGNED NULL,
  latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
  success TINYINT(1) NOT NULL DEFAULT 1,
  fallback_used TINYINT(1) NOT NULL DEFAULT 0,
  safety_blocked TINYINT(1) NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_usage_provider_created (provider_key, created_at),
  KEY idx_ai_usage_user_created (user_id, created_at),
  KEY idx_ai_usage_source_created (request_source, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_prompt_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  provider_key VARCHAR(80) NOT NULL,
  model_name VARCHAR(180) NULL,
  request_source VARCHAR(100) NOT NULL,
  question_hash CHAR(64) NOT NULL,
  sanitized_context_hash CHAR(64) NOT NULL,
  pii_redaction_applied TINYINT(1) NOT NULL DEFAULT 0,
  sensitive_fields_removed_json JSON NULL,
  response_summary VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_prompt_user_created (user_id, created_at),
  KEY idx_ai_prompt_provider_created (provider_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  provider_key VARCHAR(80) NOT NULL,
  model_name VARCHAR(180) NULL,
  request_id BIGINT UNSIGNED NULL,
  rating ENUM('helpful', 'not_helpful', 'incorrect', 'unsafe') NOT NULL,
  feedback_text TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_feedback_provider_created (provider_key, created_at),
  KEY idx_ai_feedback_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
