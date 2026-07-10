-- Migration 500: AI Provider Foundation
-- Purpose: Add AI provider configuration, usage tracking, audit logging, and feedback tables
-- Date: 2026-07-10
-- Phase: PeopleOS AI Enhancement Phase 1

-- Table 1: AI Provider Configuration
CREATE TABLE IF NOT EXISTS ai_provider_config (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  provider_key VARCHAR(50) NOT NULL UNIQUE,
  provider_name VARCHAR(100) NOT NULL,
  active_status ENUM('active', 'inactive') DEFAULT 'inactive',
  is_default BOOLEAN DEFAULT FALSE,
  model_name VARCHAR(100),
  base_url VARCHAR(500),
  api_key_secret_ref VARCHAR(100),
  encrypted_api_key TEXT,
  config_json JSON,
  safety_config_json JSON,
  daily_request_limit INT UNSIGNED,
  monthly_request_limit INT UNSIGNED,
  daily_token_limit INT UNSIGNED,
  monthly_token_limit INT UNSIGNED,
  timeout_ms INT UNSIGNED DEFAULT 30000,
  fallback_provider_key VARCHAR(50),
  created_by VARCHAR(36),
  updated_by VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active_default (active_status, is_default),
  INDEX idx_provider_key (provider_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed rule-based provider (always active, default fallback)
INSERT INTO ai_provider_config (
  provider_key, provider_name, active_status, is_default,
  model_name, config_json, created_by
) VALUES (
  'rule-based',
  'Rule-Based Provider (No External AI)',
  'active',
  TRUE,
  'internal-rules-v1',
  JSON_OBJECT('description', 'Deterministic insights from PeopleOS context only'),
  'system'
) ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Table 2: AI Provider Usage Log
CREATE TABLE IF NOT EXISTS ai_provider_usage_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_key VARCHAR(50) NOT NULL,
  model_name VARCHAR(100),
  user_id VARCHAR(36) NOT NULL,
  role_keys_json JSON,
  request_source VARCHAR(100),
  entity_type VARCHAR(50),
  entity_id VARCHAR(36),
  input_token_count INT UNSIGNED,
  output_token_count INT UNSIGNED,
  latency_ms INT UNSIGNED,
  success BOOLEAN DEFAULT TRUE,
  fallback_used BOOLEAN DEFAULT FALSE,
  safety_blocked BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_provider_user (provider_key, user_id),
  INDEX idx_created_at (created_at),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_success (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table 3: AI Prompt Audit Log
CREATE TABLE IF NOT EXISTS ai_prompt_audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  provider_key VARCHAR(50) NOT NULL,
  model_name VARCHAR(100),
  request_source VARCHAR(100),
  question_hash CHAR(64) NOT NULL,
  sanitized_context_hash CHAR(64) NOT NULL,
  pii_redaction_applied BOOLEAN DEFAULT FALSE,
  sensitive_fields_removed_json JSON,
  response_summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_provider_created (provider_key, created_at),
  INDEX idx_question_hash (question_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table 4: AI Feedback
CREATE TABLE IF NOT EXISTS ai_feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  provider_key VARCHAR(50),
  model_name VARCHAR(100),
  request_id BIGINT UNSIGNED,
  rating ENUM('helpful', 'not_helpful', 'incorrect', 'unsafe') NOT NULL,
  feedback_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_provider_rating (provider_key, rating),
  FOREIGN KEY (request_id) REFERENCES ai_provider_usage_log(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration complete
SELECT 'Migration 500: AI Provider Foundation - Complete' AS status;
