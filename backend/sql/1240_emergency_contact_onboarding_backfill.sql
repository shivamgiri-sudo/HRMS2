-- 1240_emergency_contact_onboarding_backfill.sql
--
-- One-time catch-up for the emergency-contact sync gap fixed the same session in
-- employee-creation-orchestrator.service.ts (commit 6930066f): candidate->employee
-- conversion never copied candidate_onboarding_profile.emergency_contact_name/relation/
-- mobile into employee_emergency_contact, which is the table the ID card, HR's
-- emergency-contact editor and the employee self-service editor all read. Fixed going
-- forward in code; this is the backfill for employees already converted before that fix,
-- explicitly approved by the owner in the same session ("ok do it").
--
-- Read-only scope check run before this file was written (2026-08-18, mas_hrms,
-- 192.168.10.6): 32,787 candidate_onboarding_profile rows total, only 100 with a
-- non-empty emergency_contact_mobile. Of those 100, 98 have no matching employees row at
-- all (candidate never converted / candidate_id linkage absent) and are correctly left
-- alone. Exactly 2 already-converted employees are eligible — MAS63085 and MAS63086 (both
-- active_status=1) — and neither already has a contact_seq=1 row in
-- employee_emergency_contact, so this cannot overwrite anything anyone entered by hand.
--
-- name is upper-cased/trimmed the same way toStoredName()/toStoredNameRequired() do in
-- code, so a row written here reads the same as one the orchestrator's own code path
-- would have written. (Not collapsing internal whitespace via REGEXP_REPLACE here —
-- avoids depending on this MySQL build's regex flavor for a case that doesn't occur in
-- either of the 2 rows this actually matches; TRIM/UPPER alone is sufficient for them.)
--
-- Idempotent: NOT EXISTS guards re-runs, and employee_emergency_contact carries
-- UNIQUE KEY uq_emp_emergency_seq (employee_id, contact_seq), so a concurrent/duplicate
-- attempt collides rather than double-inserting. Additive only — no DROP, no DELETE,
-- no UPDATE of any existing row.

INSERT INTO employee_emergency_contact (id, employee_id, contact_seq, is_primary, name, relationship, mobile)
SELECT
  UUID(),
  e.id,
  1,
  1,
  UPPER(TRIM(p.emergency_contact_name)),
  NULLIF(TRIM(p.emergency_contact_relation), ''),
  TRIM(p.emergency_contact_mobile)
FROM employees e
JOIN candidate_onboarding_profile p ON p.candidate_id = e.candidate_id
WHERE TRIM(COALESCE(p.emergency_contact_name, '')) <> ''
  AND TRIM(COALESCE(p.emergency_contact_mobile, '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM employee_emergency_contact eec
     WHERE eec.employee_id = e.id AND eec.contact_seq = 1
  );
