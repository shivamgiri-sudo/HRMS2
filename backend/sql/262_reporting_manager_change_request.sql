-- Extend profile_update_approval to track branch for WFM scoping
ALTER TABLE profile_update_approval
  ADD COLUMN branch_id VARCHAR(36) NULL COMMENT 'Branch of employee — used for WFM scoping',
  ADD COLUMN pending_manager_id VARCHAR(36) NULL COMMENT 'Proposed reporting_manager_id (for reporting_manager_change type)',
  ADD KEY idx_branch_status (branch_id, status);
