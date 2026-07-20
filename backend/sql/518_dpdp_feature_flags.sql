-- Migration 518: DPDP Feature Flag Configuration Keys
-- Seeds default OFF/dry-run values for all DPDP enforcement feature flags.
-- Override at runtime via environment variables (env takes precedence over DB config).
-- Change these values through the admin DPDP config API — not by editing this file.

INSERT INTO dpdp_config (config_key, config_value, description) VALUES
  ('DPDP_POLICY_ENGINE_ENABLED',     'false',    'Enable the central privacy policy authorization engine'),
  ('DPDP_POLICY_SHADOW_MODE',        'true',     'Log policy decisions without enforcing (shadow mode)'),
  ('DPDP_DOCUMENT_AUTH_ENABLED',     'false',    'Enforce access_level policy on document vault downloads'),
  ('DPDP_FIELD_PROJECTION_ENABLED',  'false',    'Enforce role-field projection on sensitive employee endpoints'),
  ('DPDP_WITHDRAWAL_CANONICAL_ENABLED', 'true',  'Use canonical withdrawal workflow with all audit events'),
  ('DPDP_PROCESSING_HOLD_ENFORCEMENT','false',   'Block data access for principals with active processing holds'),
  ('DPDP_RETENTION_MODE',            'dry_run',  'Retention worker mode: dry_run or approved_actions'),
  ('DPDP_AI_PRIVACY_GATE_ENABLED',   'false',    'Block AI requests for data under processing hold or lacking consent')
ON DUPLICATE KEY UPDATE
  description = VALUES(description);
-- Note: ON DUPLICATE KEY only updates description — existing config_value changes are NOT overwritten.
-- This prevents a re-run of this migration from resetting manually configured values.
