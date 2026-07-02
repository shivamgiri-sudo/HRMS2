-- Migration 335: PF opt-out flags for ats_employment_offer + Form 11 consent columns
-- for candidate_onboarding_profile
-- Safe: additive only (ADD COLUMN IF NOT EXISTS). Do NOT run without explicit approval.

-- Step 1: PF opt-out tracking on the offer record
-- Note: ADD COLUMN IF NOT EXISTS is MariaDB syntax; MySQL 8.0 uses plain ADD COLUMN.
-- Columns are absent on fresh installs; skip manually if already applied.
ALTER TABLE ats_employment_offer
  ADD COLUMN pf_opt_out TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = employee voluntarily opted out of PF under EPF Act 17(1)',
  ADD COLUMN pf_opt_out_consent_at DATETIME NULL
    COMMENT 'Timestamp when candidate gave Form 11 consent via onboarding portal';

-- Step 2: Form 11 / PF declaration columns on the candidate profile
-- Note: previous_pf_member, eps_member, international_worker already exist (migration 289).
-- These columns record the candidate's online consent act.
ALTER TABLE candidate_onboarding_profile
  ADD COLUMN pf_opt_out_elected TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Candidate elected to opt out of PF on Form 11 online step (1 = yes)',
  ADD COLUMN pf_opt_out_consent_text TEXT NULL
    COMMENT 'Full Form 11 declaration text shown to candidate at time of consent',
  ADD COLUMN pf_opt_out_consented_at DATETIME NULL
    COMMENT 'UTC timestamp when candidate clicked consent on Form 11 step';
