-- 1514_reimbursement_multilevel_approval.sql
-- Adds multi-level approval (manager → branch head) to employee reimbursement claims
-- and tracks conversion to imprest GRN.

USE mas_hrms;

-- Expand status enum for multi-level approval flow:
-- draft → submitted → manager_approved → branch_head_approved → processed/rejected
ALTER TABLE employee_reimbursement_claim
  MODIFY COLUMN status ENUM(
    'draft',
    'submitted',
    'manager_approved',
    'branch_head_approved',
    'approved',           -- legacy: kept for backward compatibility
    'rejected',
    'processed'
  ) NOT NULL DEFAULT 'draft';

-- Add branch_id for notification routing (FK to employee's branch)
ALTER TABLE employee_reimbursement_claim
  ADD COLUMN branch_id VARCHAR(36) NULL AFTER employee_id;

-- Manager (reporting_manager) review columns
ALTER TABLE employee_reimbursement_claim
  ADD COLUMN manager_reviewed_by VARCHAR(36) NULL AFTER rejection_reason,
  ADD COLUMN manager_reviewed_at DATETIME NULL AFTER manager_reviewed_by,
  ADD COLUMN manager_review_note TEXT NULL AFTER manager_reviewed_at;

-- Branch head review columns
ALTER TABLE employee_reimbursement_claim
  ADD COLUMN branch_head_reviewed_by VARCHAR(36) NULL AFTER manager_review_note,
  ADD COLUMN branch_head_reviewed_at DATETIME NULL AFTER branch_head_reviewed_by,
  ADD COLUMN branch_head_review_note TEXT NULL AFTER branch_head_reviewed_at;

-- GRN conversion tracking
ALTER TABLE employee_reimbursement_claim
  ADD COLUMN converted_to_grn_id CHAR(36) NULL AFTER payroll_run_id,
  ADD COLUMN converted_at DATETIME NULL AFTER converted_to_grn_id,
  ADD COLUMN converted_by VARCHAR(36) NULL AFTER converted_at;

-- Attachment columns (file stored via /api/files)
ALTER TABLE employee_reimbursement_claim
  ADD COLUMN attachment_file_path VARCHAR(500) NULL AFTER documents_url,
  ADD COLUMN attachment_original_name VARCHAR(255) NULL AFTER attachment_file_path,
  ADD COLUMN attachment_mime VARCHAR(100) NULL AFTER attachment_original_name;

-- Index for GRN lookup and branch filtering
CREATE INDEX idx_erc_grn ON employee_reimbursement_claim (converted_to_grn_id);
CREATE INDEX idx_erc_branch ON employee_reimbursement_claim (branch_id);

-- Add source_reimbursement_id to grn_request for traceability
-- (allows finding which reimbursement claim created a GRN)
ALTER TABLE grn_request
  ADD COLUMN source_reimbursement_id CHAR(36) NULL;

CREATE INDEX idx_grn_source_reimb ON grn_request (source_reimbursement_id);

SELECT 'Migration 1514 applied: reimbursement multi-level approval schema ready' AS status;
