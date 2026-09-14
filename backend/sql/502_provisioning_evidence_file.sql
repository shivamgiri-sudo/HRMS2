-- Migration 502: Add evidence_file_url to it_provisioning_request
-- Purpose: Allow IT operators to upload AD Security Event Log files (Event ID 4720/4726)
-- as verifiable proof of domain account creation/deletion actions.
ALTER TABLE it_provisioning_request
  ADD COLUMN evidence_file_url VARCHAR(500) NULL AFTER evidence_note;
