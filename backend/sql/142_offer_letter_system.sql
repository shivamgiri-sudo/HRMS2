-- ATS Offer Letter System
-- Migration 142: Complete offer letter generation and management

USE mas_hrms;

-- ── Offer Letter Templates ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_offer_letter_templates (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  template_name VARCHAR(255) NOT NULL,
  template_type ENUM('full_time', 'part_time', 'contract', 'internship') NOT NULL DEFAULT 'full_time',
  subject_line VARCHAR(500) NOT NULL,
  body_template TEXT NOT NULL,
  variables JSON COMMENT 'Array of variable names used in template',
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by VARCHAR(36),
  INDEX idx_template_type (template_type),
  INDEX idx_active_status (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Offer Letters ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_offer_letters (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  candidate_id VARCHAR(36) NOT NULL,
  offer_date DATE NOT NULL,
  joining_date DATE NOT NULL,
  position VARCHAR(255) NOT NULL,
  department VARCHAR(255),
  branch_name VARCHAR(255),
  salary_gross DECIMAL(10,2) NOT NULL,
  salary_ctc DECIMAL(10,2) NOT NULL COMMENT 'Cost to Company (annual)',
  salary_basic DECIMAL(10,2),
  salary_hra DECIMAL(10,2),
  salary_other_allowances DECIMAL(10,2),
  probation_period INT DEFAULT 3 COMMENT 'In months',
  notice_period INT DEFAULT 30 COMMENT 'In days',
  working_hours VARCHAR(255) DEFAULT '9 AM - 6 PM (Monday to Friday)',
  reporting_manager VARCHAR(255),
  template_id VARCHAR(36),
  pdf_path VARCHAR(500) COMMENT 'Path to generated PDF',
  sent_at TIMESTAMP NULL,
  accepted_at TIMESTAMP NULL,
  declined_at TIMESTAMP NULL,
  status ENUM('draft', 'sent', 'accepted', 'declined', 'expired') NOT NULL DEFAULT 'draft',
  expires_at TIMESTAMP NULL COMMENT 'Offer expiry date',
  decline_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id),
  FOREIGN KEY (template_id) REFERENCES ats_offer_letter_templates(id),
  INDEX idx_candidate_id (candidate_id),
  INDEX idx_status (status),
  INDEX idx_offer_date (offer_date),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Offer Letter Acknowledgements ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_offer_acknowledgements (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  offer_letter_id VARCHAR(36) NOT NULL,
  action_type ENUM('accepted', 'declined', 'negotiation_request') NOT NULL,
  action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT,
  signature_data TEXT COMMENT 'Digital signature or acceptance token',
  ip_address VARCHAR(45),
  user_agent TEXT,
  FOREIGN KEY (offer_letter_id) REFERENCES ats_offer_letters(id),
  INDEX idx_offer_letter_id (offer_letter_id),
  INDEX idx_action_type (action_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Default Template ───────────────────────────────────────────────────────────

INSERT INTO ats_offer_letter_templates (
  template_name,
  template_type,
  subject_line,
  body_template,
  variables
) VALUES (
  'Standard Full-Time Offer',
  'full_time',
  'Offer of Employment - {{position}} at Mas Callnet India',
  'Dear {{candidate_name}},\n\nWe are pleased to offer you the position of {{position}} at Mas Callnet India Pvt. Ltd.\n\nPosition: {{position}}\nDepartment: {{department}}\nBranch: {{branch}}\nJoining Date: {{joining_date}}\nGross Salary: {{salary_gross}} per month\nCTC: {{salary_ctc}} per annum\n\nProbation Period: {{probation_period}} months\nNotice Period: {{notice_period}} days\n\nPlease confirm your acceptance by {{expiry_date}}.',
  JSON_ARRAY('candidate_name', 'position', 'department', 'branch', 'joining_date', 'salary_gross', 'salary_ctc', 'probation_period', 'notice_period', 'expiry_date')
) ON DUPLICATE KEY UPDATE template_name = template_name;

-- ── Performance Indexes ─────────────────────────────────────────────────────────

-- Composite index for pending offers query
SET @idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_offer_letters'
    AND INDEX_NAME = 'idx_offer_status_expiry'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_offer_status_expiry ON ats_offer_letters(status, expires_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index for candidate offer history
SET @idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_offer_letters'
    AND INDEX_NAME = 'idx_candidate_offer_date'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_candidate_offer_date ON ats_offer_letters(candidate_id, offer_date DESC)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── Verification ────────────────────────────────────────────────────────────────

SELECT 'Offer letter tables created successfully' AS status;
