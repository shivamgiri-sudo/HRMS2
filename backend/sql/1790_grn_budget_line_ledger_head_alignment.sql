-- 1790_grn_budget_line_ledger_head_alignment.sql
--
-- WHY
-- verify-head-subhead-ledger-coverage.ts (Journal Task 2's own pre-flight check) found 4
-- active budget lines whose head/sub_head text does not resolve to any row in
-- finance_expense_sub_head_master — grn-journal-posting.service.ts's resolveExpenseSubHeadAccountId()
-- would hard-refuse a Finance Head approval against any of these the moment GRN journal-posting
-- goes live (migration 1789). Live-checked 2026-09-17, cross-verified against db_bill (the
-- legacy accounting system these categories originated in) via its own
-- tbl_bgt_expenseheadingmaster/tbl_bgt_expensesubheadingmaster — see each UPDATE below for the
-- specific evidence. The CEO's own standing requirement is a fully governed, Tally-style
-- ledger with no manual reconciliation, so these are corrected to their real category rather
-- than papered over with a new, duplicate ledger head.
--
-- All 4 are TEXT CORRECTIONS on finance_budget_line — no amounts, approvals, or GRNs are
-- touched. Every WHERE clause matches the exact current (head, sub_head, budget_id) so a
-- second run finds nothing left to update (idempotent).

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1) "Hiring Charges" / "Generator  Hire" (stray double space) -> "Generator Hire"
-- 4 budget lines, all NOIDA-2 (BUD/42/202604..202607), Rs.121,636 total. The active ledger
-- head is "Generator Hire" (single space) under the same "Hiring Charges" head — this is a
-- plain typo from data entry, not a different category. db_bill's own history shows a
-- "Generator  Hire" sub-head existed too (HeadType B, Status1=0 — explicitly disabled there),
-- confirming it was already recognised as the same typo'd duplicate in the legacy system.
-- ---------------------------------------------------------------------------
UPDATE finance_budget_line
   SET sub_head = 'Generator Hire'
 WHERE head = 'Hiring Charges' AND sub_head = 'Generator  Hire';

-- ---------------------------------------------------------------------------
-- 2) "Repairs & Maintenance" / "Computer Software Cost 2025 - 26" -> "Computer software cost 26-27"
-- 1 budget line, HEAD OFFICE, budget_number BUD/32/202604/701EC36B (accounting period 2026-04,
-- i.e. FY2026-27), Rs.381,966. db_bill mints one Computer-Software-Cost sub-head per fiscal
-- year under "Repairs & Maintenance" (2023-24, 2024-25, 2025-26, 2026-27 all exist there,
-- each active) — mas_hrms only carried the current year's variant into
-- finance_expense_sub_head_master, so this line's "2025 - 26" text is last year's vintage
-- surviving into a current-year budget line (a stale copy-paste at creation, not a genuinely
-- different or still-open category — FY2025-26 has closed).
-- ---------------------------------------------------------------------------
UPDATE finance_budget_line
   SET sub_head = 'Computer software cost 26-27'
 WHERE head = 'Repairs & Maintenance' AND sub_head = 'Computer Software Cost 2025 - 26';

-- ---------------------------------------------------------------------------
-- 3) "Repairs & Maintenance" / "FURNITURE & FIXTURE - COST" -> head "Repairs & Maintenance - Capex",
--    sub_head "Furniture & Fixture - Cost"
-- 1 budget line, NOIDA, budget_number BUD/19/202606/1216D5C0, Rs.114,010. This is a capex
-- purchase (new furniture), not a repair — db_bill confirms: "FURNITURE & FIXTURE - COST"
-- exists there under BOTH "Repair and Maintanance" (HeadType B, Status1=0 — explicitly
-- disabled) and "Repairs & Maintenance Capex" (HeadType A, Status1=1 — active). The business
-- already moved this exact category to the Capex head in the legacy system; this budget line
-- was raised under the wrong (opex) head in mas_hrms.
-- ---------------------------------------------------------------------------
UPDATE finance_budget_line
   SET head = 'Repairs & Maintenance - Capex',
       sub_head = 'Furniture & Fixture - Cost'
 WHERE head = 'Repairs & Maintenance' AND sub_head = 'FURNITURE & FIXTURE - COST';

-- ---------------------------------------------------------------------------
-- 4) "Repairs & Maintenance" / "ELECTRICAL INSTALLATIONS - COST" -> head "Repairs & Maintenance - Capex",
--    sub_head "Electrical Installations - Cost"
-- 2 budget lines, NOIDA + NOIDA-DIALDESK, Rs.77,000 total. Same evidence and reasoning as (3):
-- db_bill carries "ELECTRICAL INSTALLATIONS - COST" under both the opex head (disabled,
-- Status1=0) and "Repairs & Maintenance Capex" (active) — a capex installation, not a repair.
-- ---------------------------------------------------------------------------
UPDATE finance_budget_line
   SET head = 'Repairs & Maintenance - Capex',
       sub_head = 'Electrical Installations - Cost'
 WHERE head = 'Repairs & Maintenance' AND sub_head = 'ELECTRICAL INSTALLATIONS - COST';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Re-run backend/scripts/verify-head-subhead-ledger-coverage.ts — expect "No gaps".
