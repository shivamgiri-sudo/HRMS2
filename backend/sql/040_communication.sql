USE mas_hrms;

-- =====================================================
-- Communication Template Management Schema
-- File: 040_communication.sql
-- Description: 3 tables for templates, notification
--              preferences, and dispatch logging
-- =====================================================

-- =====================================================
-- 1. COMMUNICATION TEMPLATE
-- =====================================================
CREATE TABLE IF NOT EXISTS communication_template (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  subject VARCHAR(200),
  body_html TEXT NOT NULL,
  body_text TEXT,
  category ENUM('onboarding', 'payroll', 'attendance', 'leave', 'performance', 'alerts', 'announcements', 'custom') NOT NULL,
  channel ENUM('email', 'sms', 'whatsapp', 'multi') NOT NULL,
  variables_schema JSON,
  is_active TINYINT(1) DEFAULT 1,
  is_critical TINYINT(1) DEFAULT 0,
  created_by VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category_active (category, is_active),
  INDEX idx_created_by (created_by),
  FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. NOTIFICATION PREFERENCES
-- =====================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  category ENUM('onboarding', 'payroll', 'attendance', 'leave', 'performance', 'alerts', 'announcements') NOT NULL,
  preferred_channel ENUM('email', 'sms', 'whatsapp') DEFAULT 'email',
  enabled TINYINT(1) DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uk_employee_category (employee_id, category),
  INDEX idx_employee_enabled (employee_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. DISPATCH LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS dispatch_log (
  id VARCHAR(36) PRIMARY KEY,
  template_id VARCHAR(36),
  template_name VARCHAR(100) NOT NULL,
  recipient_employee_id VARCHAR(36),
  recipient_contact VARCHAR(100) NOT NULL,
  channel ENUM('email', 'sms', 'whatsapp') NOT NULL,
  status ENUM('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed') NOT NULL DEFAULT 'queued',
  subject VARCHAR(200),
  body_preview VARCHAR(500),
  sent_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  opened_at TIMESTAMP NULL,
  clicked_at TIMESTAMP NULL,
  error_message TEXT,
  is_critical TINYINT(1) DEFAULT 0,
  retention_category ENUM('critical', 'standard', 'routine') NOT NULL DEFAULT 'standard',
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES communication_template(id) ON DELETE SET NULL,
  FOREIGN KEY (recipient_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  INDEX idx_recipient_channel (recipient_employee_id, channel, sent_at DESC),
  INDEX idx_status_retry (status, retry_count),
  INDEX idx_retention_cleanup (is_critical, retention_category, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- END OF SCHEMA
-- =====================================================
