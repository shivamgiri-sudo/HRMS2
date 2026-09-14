-- Migration 1602: Restore Loan Management RBAC to its intended approver set
--
-- Live role_page_access for page_code='PAYROLL_LOANS' as of 2026-08-25:
--   branch_payroll (active), payroll (active), super_admin (active),
--   payroll_head (REVOKED, active_status=0), hr (REVOKED, active_status=0),
--   admin / finance_head (no row at all).
--
-- The frontend's own canApproveLoans gate already lists
-- ['finance_head','payroll_head','admin','super_admin'] — so the live grant
-- table has drifted out of sync with the page's own intended access, leaving
-- Loan Management's approval queue reachable only by super_admin in practice.
-- This restores parity between the two, and keeps hr view-capable as it was
-- before revocation.
--
-- APPLIED against production 2026-08-25 with explicit user approval. Confirmed
-- after: payroll_head, hr, admin, finance_head, branch_payroll, payroll,
-- super_admin all active_status=1 for PAYROLL_LOANS. Idempotent (UPDATE matches
-- nothing once already 1; INSERT ... WHERE NOT EXISTS matches nothing once rows
-- exist) — kept here for the migration manifest/history.

UPDATE role_page_access SET active_status = 1
 WHERE page_code = 'PAYROLL_LOANS' AND role_key IN ('payroll_head', 'hr');

INSERT INTO role_page_access (page_code, role_key, active_status)
SELECT 'PAYROLL_LOANS', r.role_key, 1
  FROM (SELECT 'admin' AS role_key UNION ALL SELECT 'finance_head') r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access
    WHERE page_code = 'PAYROLL_LOANS' AND role_key = r.role_key
 );
