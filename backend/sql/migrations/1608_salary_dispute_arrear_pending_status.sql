-- Migration 1608: Add 'arrear_pending' to salary_dispute.status
--
-- salary_dispute.status is a MySQL ENUM('draft','pending_wfm','pending_payroll_head',
-- 'approved','rejected','closed'). applyArrear() (salary-dispute.service.ts) previously wrote
-- 'closed' unconditionally once a dispute was approved, even when no open payroll run existed
-- yet to attach the arrear to — payroll runs in arrears, so this was the common case, not the
-- edge one. An approved dispute therefore always looked fully resolved in the UI whether or not
-- the differential amount had actually landed in a payslip.
--
-- This adds the missing outcome as its own status instead of overloading 'closed'. The service
-- fix (same commit) now writes 'arrear_pending' when no line was found to attach the arrear to,
-- 'closed' only when it genuinely was. Still no automatic catch-up once a run opens — this only
-- stops the dormant case from silently reading as resolved.
--
-- Additive, backward-compatible: existing rows and values are untouched, only a new enum value
-- is added.
--
-- APPLIED against production 2026-08-25 with explicit user approval. Confirmed after:
-- SHOW COLUMNS FROM salary_dispute LIKE 'status' includes 'arrear_pending'; 0 existing rows
-- (salary_dispute has never had a row written to it), so nothing else was affected. Idempotent
-- (MODIFY COLUMN with the same target definition is a no-op if re-run) — kept here for the
-- migration manifest/history.

ALTER TABLE salary_dispute
  MODIFY COLUMN status ENUM('draft','pending_wfm','pending_payroll_head','approved','rejected','closed','arrear_pending')
  NOT NULL DEFAULT 'pending_wfm';
