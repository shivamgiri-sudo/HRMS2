-- Migration 1811: recipient list for the META campaign brief email.
--
-- Stored in org_settings, the codebase's key/value settings table (067_org_settings.sql). The
-- plan for this feature specified a `system_config` table with config_key/config_value columns;
-- no such table exists in this schema, nor does `branch_config`. Existing org_settings rows keep
-- JSON inside the TEXT column (`domain_whitelist` is seeded as '[]'), so a JSON array of
-- addresses matches house style and needs no new column type.
--
-- Seeded EMPTY on purpose. getMarketingEmails() returns [] for '[]', and notifyMarketingTeam()
-- returns early on an empty recipient list, so approving a requisition on a freshly-migrated
-- environment sends nothing at all until an administrator fills the list in. This mirrors the
-- documented intent of the neighbouring notifier in job-requisition.service.ts ("Nothing
-- configured for a branch means nothing sends, on purpose") and avoids the failure mode recorded
-- in communication/providers/provider.interface.ts, where notifications fanned out to channels
-- that had never been credentialed and minted ~1,800 guaranteed-failed dispatch_log rows.

USE mas_hrms;

INSERT IGNORE INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'marketing_team_emails', '[]', 'Marketing team recipients for recruitment campaign briefs');

SELECT 'Migration 1811 applied: org_settings.marketing_team_emails seeded (empty = feature inert)' AS status;
