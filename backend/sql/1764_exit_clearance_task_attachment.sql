-- Migration 1764: add attachment_url to exit_clearance_task.
-- Supports the WFM "Client ID deactivation" clearance task where the WFM team
-- attaches the confirmation screenshot/email from Operations showing the agent's
-- client-system ID has been deactivated. Field is nullable (non-mandatory) so
-- all existing tasks and the other seven default tasks are unaffected.
ALTER TABLE exit_clearance_task
  ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(700) DEFAULT NULL AFTER remarks;
