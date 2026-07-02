-- Notification preferences for system-only auth accounts that intentionally
-- do not have an employees row (for example dedicated super administrators).
USE mas_hrms;

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  category ENUM('onboarding', 'payroll', 'attendance', 'leave', 'performance', 'alerts', 'announcements') NOT NULL,
  preferred_channel ENUM('email', 'sms', 'whatsapp') NOT NULL DEFAULT 'email',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_notification_preferences_user
    FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_notification_category (user_id, category),
  INDEX idx_user_notification_enabled (user_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
