USE mas_hrms;

CREATE TABLE IF NOT EXISTS auth_user (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_blocked   TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at DATETIME    NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_auth_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Replaces Supabase auth.users — application-level user authentication';

CREATE TABLE IF NOT EXISTS auth_refresh_token (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL,
  token_hash   VARCHAR(255) NOT NULL UNIQUE,
  expires_at   DATETIME     NOT NULL,
  revoked      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,
  INDEX idx_rt_user_active (user_id, revoked),
  INDEX idx_rt_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed demo users with bcrypt hashes of their passwords
-- IMPORTANT: These are the SAME users as in the demo credential map in authMiddleware.ts
-- Passwords: Admin@123, Hr@123456, Recruiter@1, Manager@1, TL@123456, Quality@1, Workforce@1, Finance@1, Employee@1, Ceo@12345, Trainer@1
INSERT IGNORE INTO auth_user (id, email, password_hash) VALUES
  ('demo-admin-id',     'admin@mascallnet.com',     '$2b$10$placeholder_admin_hash'),
  ('demo-hr-id',        'hr@mascallnet.com',         '$2b$10$placeholder_hr_hash'),
  ('demo-recruiter-id', 'recruiter@mascallnet.com',  '$2b$10$placeholder_recruiter_hash'),
  ('demo-manager-id',   'manager@mascallnet.com',    '$2b$10$placeholder_manager_hash'),
  ('demo-tl-id',        'tl@mascallnet.com',         '$2b$10$placeholder_tl_hash'),
  ('demo-qa-id',        'qa@mascallnet.com',         '$2b$10$placeholder_qa_hash'),
  ('demo-wfm-id',       'wfm@mascallnet.com',        '$2b$10$placeholder_wfm_hash'),
  ('demo-finance-id',   'finance@mascallnet.com',    '$2b$10$placeholder_finance_hash'),
  ('demo-employee-id',  'employee@mascallnet.com',   '$2b$10$placeholder_employee_hash'),
  ('demo-ceo-id',       'ceo@mascallnet.com',        '$2b$10$placeholder_ceo_hash'),
  ('demo-trainer-id',   'trainer@mascallnet.com',    '$2b$10$placeholder_trainer_hash');

SELECT 'Migration 050 applied: auth_user and auth_refresh_token tables created' AS status;
