-- backend/sql/140_candidate_portal_tables.sql
-- Candidate Portal Tables
USE mas_hrms;

-- ── 1. Candidate Portal Access ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_candidate_portal_access (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 2. Onboarding Tasks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_onboarding_tasks (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  task_name VARCHAR(255) NOT NULL,
  task_description TEXT NULL,
  task_order INT DEFAULT 0,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at DATETIME NULL,
  document_url VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_status (is_completed),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 3. Candidate Documents ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_candidate_documents (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(512) NOT NULL,
  verification_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
  verified_by CHAR(36) NULL,
  verified_at DATETIME NULL,
  rejection_reason TEXT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id),
  INDEX idx_status (verification_status),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 4. Insert default onboarding tasks template ───────────────────────────────
-- These will be copied to each selected candidate
CREATE TABLE IF NOT EXISTS ats_onboarding_task_templates (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  task_name VARCHAR(255) NOT NULL,
  task_description TEXT NULL,
  task_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order (task_order)
);

-- Insert default tasks
INSERT INTO ats_onboarding_task_templates (task_name, task_description, task_order) VALUES
('Complete Personal Information', 'Fill in all mandatory personal details in the portal', 1),
('Upload Identity Proof', 'Upload Aadhar Card or PAN Card', 2),
('Upload Address Proof', 'Upload utility bill or bank statement', 3),
('Upload Education Certificates', 'Upload highest qualification certificate', 4),
('Upload Experience Letters', 'Upload previous employment letters (if applicable)', 5),
('Complete Bank Details', 'Provide bank account details for salary credit', 6),
('Sign Offer Letter', 'Review and digitally sign the offer letter', 7),
('Acknowledge Policies', 'Read and acknowledge company policies', 8)
ON DUPLICATE KEY UPDATE task_name=task_name;

SELECT '✅ Migration 140 complete: Candidate Portal tables created' AS result;
