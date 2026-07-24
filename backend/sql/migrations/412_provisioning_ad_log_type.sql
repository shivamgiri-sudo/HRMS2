-- Migration 412: Add structured AD Security Event Log fields to it_provisioning_request
-- Purpose: When IT uploads a Windows Event Log .txt file as evidence, the backend
-- parses EventID 4720 (account creation) / 4726 (account deletion) and stores
-- structured fields for compliance reporting without re-reading the file each time.

ALTER TABLE it_provisioning_request
  ADD COLUMN ad_log_type       ENUM('creation','deletion','none') NULL AFTER evidence_file_url,
  ADD COLUMN ad_account_name   VARCHAR(120) NULL AFTER ad_log_type,
  ADD COLUMN ad_event_id       VARCHAR(10)  NULL AFTER ad_account_name,
  ADD COLUMN ad_actioned_by_it VARCHAR(120) NULL AFTER ad_event_id,
  ADD COLUMN ad_event_time     DATETIME     NULL AFTER ad_actioned_by_it;
