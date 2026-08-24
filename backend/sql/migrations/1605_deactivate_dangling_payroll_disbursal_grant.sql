-- Migration 1605: Deactivate the dangling PAYROLL_DISBURSAL role_page_access grants
--
-- src/pages/payroll/DisbursalManagement.tsx (the page this page_code once gated) was
-- deleted as confirmed dead code — no route has rendered it since PaymentDisbursalCenter.tsx
-- absorbed its functionality on 2026-08-23; /payroll/disbursal has redirected to
-- /payroll/payment-center?tab=disbursal ever since, which is gated on PAYROLL_BANK_READINESS
-- instead. Live role_page_access for page_code='PAYROLL_DISBURSAL' before this migration:
--   finance (0, already inactive), payroll_head (0, already inactive),
--   finance_head (1), super_admin (1)
--
-- Soft-deactivate rather than delete, matching this repo's existing convention for this
-- exact table (2 of the 4 rows here were already inactive, not removed). Idempotent.
--
-- Batch 3 Phase 4 of the payroll audit fix plan. Applied against production 2026-08-25
-- with explicit user approval.

UPDATE role_page_access SET active_status = 0
 WHERE page_code = 'PAYROLL_DISBURSAL' AND active_status = 1;
