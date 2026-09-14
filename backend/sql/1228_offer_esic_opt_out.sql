-- 1228 — ESIC opt-out on the employment offer, alongside the existing PF opt-out.
--
-- Migration 335 added ats_employment_offer.pf_opt_out ("PF opt-out tracking on the offer
-- record") but no ESIC counterpart. Investigated 2026-08-17: neither pf_opt_out nor any
-- ESIC-equivalent is actually written by any code path today — the offer-creation functions
-- in payroll-hr.service.ts and ats.onboarding.service.ts never reference pf_opt_out in their
-- INSERT/UPDATE column lists, so the column has sat unused since it was added. The real PF/ESIC
-- opt-out decision, per the business, is made by Payroll HR at offer creation, not by the
-- candidate during onboarding (the candidate_onboarding_profile.pf_opt_out_elected path exists
-- but is separately broken — saveStatutory() never persists it either — and is explicitly not
-- the intended decision-maker).
--
-- This migration only adds the missing ESIC column; the code wiring (offer creation, employee
-- creation transfer to employee_statutory_override, and the Payroll HR UI) is a separate change
-- landing alongside it.
--
-- Guarded with information_schema + PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS: that
-- is MariaDB syntax which this MySQL 8 server rejects while the runner still records the
-- migration as applied (the 2026-08-13 outage pattern). Re-runnable; no DROP, no DELETE.

SET @c_esic_opt_out := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_employment_offer'
    AND COLUMN_NAME = 'esic_opt_out');

SET @add_esic_opt_out := IF(@c_esic_opt_out = 0,
  'ALTER TABLE ats_employment_offer ADD COLUMN esic_opt_out TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 = employee opted out of ESIC, elected by Payroll HR at offer creation'' AFTER pf_opt_out',
  'SELECT "esic_opt_out already exists" AS info');

PREPARE stmt FROM @add_esic_opt_out;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
