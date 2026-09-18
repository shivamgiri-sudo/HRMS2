-- Migration 1816: real default recipients for the META campaign brief, and separate the "to"
-- from the "cc" so the UI can let super_admin edit one without touching the other.
--
-- 1811 seeded a single flat array under 'marketing_team_emails' meant to be both the To and Cc
-- line combined, with no distinction and nothing in it. The owner has since given a concrete
-- specification:
--   To  : the person who actually builds the META campaign (currently brijesh.kumar@teammas.co.in)
--   Cc  : two fixed org contacts (rajesh.ramachandran@teammas.in, shivam.giri@teammas.in) PLUS the
--         branch head of the specific requisition's branch — which is not a static address and
--         must be resolved per-send via branch_head_assignments, not stored here at all.
--
-- Splitting into two settings keys, both under org_settings, rather than one JSON blob with a
-- {to,cc} shape: 'marketing_team_emails' already exists, has a documented meaning
-- (notifyMarketingTeam's recipient list) and existing consumers may read it as a flat array —
-- changing its shape silently under existing code is the kind of change that breaks a caller with
-- no compile error. New key instead; old key is repointed to hold only the To value in the same
-- flat-array shape it always had, so no consumer breaks.
--
--   marketing_team_emails      -> ["brijesh.kumar@teammas.co.in"]   (the "to" line; UI-editable)
--   marketing_team_cc_emails   -> ["rajesh.ramachandran@teammas.in","shivam.giri@teammas.in"]
--                                  (fixed cc; also UI-editable, separately, by super_admin)
--
-- ON DUPLICATE KEY UPDATE overwrites 1811's '[]' with the real address. This IS a behaviour
-- change on any environment that already ran 1811 — the feature stops being inert the moment this
-- applies. That is the point: the owner has now supplied a real recipient, and there is no reason
-- to keep shipping a brief email that goes nowhere.

USE mas_hrms;

INSERT INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'marketing_team_emails', '["brijesh.kumar@teammas.co.in"]', 'Marketing team recipient (To) for recruitment campaign briefs')
ON DUPLICATE KEY UPDATE
  setting_value = '["brijesh.kumar@teammas.co.in"]',
  label = 'Marketing team recipient (To) for recruitment campaign briefs';

INSERT INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'marketing_team_cc_emails', '["rajesh.ramachandran@teammas.in","shivam.giri@teammas.in"]', 'Fixed Cc recipients for recruitment campaign briefs (branch head is added automatically, not stored here)')
ON DUPLICATE KEY UPDATE
  setting_value = '["rajesh.ramachandran@teammas.in","shivam.giri@teammas.in"]',
  label = 'Fixed Cc recipients for recruitment campaign briefs (branch head is added automatically, not stored here)';

SELECT 'Migration 1816 applied: marketing brief To/Cc recipients set to real addresses' AS status;
