-- 1791_historical_grn_ledger_head_alignment.sql
--
-- WHY
-- Phase 6's backfill (backend/scripts/backfill-journal-entries.ts --grn) re-derives a journal
-- entry for every historically-approved GRN via postGrnApprovalJournalEntry() — the same
-- resolveExpenseSubHeadAccountId() lookup Journal Task 2 uses live. A dry run against the full
-- 82,486-row backfill candidate set found 1,010 vendor GRNs (26 distinct head/sub_head text
-- combinations) whose text does not resolve to any active row in
-- finance_expense_sub_head_master, live-checked 2026-09-17. 1789's own live pre-flight
-- (1790_grn_budget_line_ledger_head_alignment.sql) only covered ACTIVE budget lines' text —
-- these are on the GRN rows themselves (grn_request.head/sub_head is its own free-text copy,
-- not always sourced from a budget line for legacy-migrated rows), a materially larger set.
--
-- This migration corrects the 13 of 26 combinations (889 of 1,010 gap rows, ~88%) where the
-- evidence is unambiguous: the sub_head text (or, for two rows, the head text) matches exactly
-- one active ledger row once paired with the right head, the same "wrong head, right subhead"
-- pattern 1790 already found and fixed for the Capex reclassification. Method: for each gap
-- combo, matched its sub_head text case/whitespace-insensitively against every active
-- (head, sub_head) pair in finance_expense_sub_head_master/finance_expense_head_master; applied
-- only where exactly one match existed. Never guessed a mapping with more than one candidate.
--
-- The remaining 13 combinations (121 rows, ~₹9.7L) are genuinely ambiguous self-referential
-- text (e.g. head="Communication & Connectivity" sub_head="Communication & Connectivity", head="Staff
-- Welfare" sub_head="Staff Welfare") with no single matching active sub-head to place them
-- under — left untouched. Deliberately not guessed: a wrong Head/Subhead here misattributes real
-- historical spend. These will fail cleanly in the backfill with EXPENSE_LEDGER_NOT_FOUND,
-- reported by name, for a human to resolve. Same treatment for the 167 vendor GRNs
-- (₹23,25,563.29 total) with no vendor_id AND no vendor_name recorded at all — nothing here to
-- infer a vendor from; they will fail with GRN_VENDOR_MISSING.
--
-- Scope: every UPDATE is restricted to grn_type='vendor' AND status IN the same
-- "consumed/paid" set backfill-journal-entries.ts itself selects on — this migration only
-- touches the exact rows verified above, not cancelled/rejected/draft GRNs carrying the same
-- text that were not part of this analysis. TEXT ONLY — no amounts, vendors, or approval state
-- are touched. Idempotent: every WHERE clause matches the exact current text, so a re-run finds
-- nothing left to change.

SET NAMES utf8mb4;

-- Shared status scope for every UPDATE below.
-- ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')

-- 1) Computers - Cost, wrongly under the opex head -> Repairs & Maintenance - Capex (335 rows, Rs.1,31,48,719.26)
UPDATE grn_request
   SET head = 'Repairs & Maintenance - Capex'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'Computers - Cost';

-- 2) Furniture & Fixture - Cost, same Capex reclassification as 1790 (199 rows, Rs.72,33,625.62)
UPDATE grn_request
   SET head = 'Repairs & Maintenance - Capex', sub_head = 'Furniture & Fixture - Cost'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'FURNITURE & FIXTURE - COST';

-- 3) Electrical Installations - Cost, same Capex reclassification as 1790 (168 rows, Rs.68,31,459.94)
UPDATE grn_request
   SET head = 'Repairs & Maintenance - Capex', sub_head = 'Electrical Installations - Cost'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'ELECTRICAL INSTALLATIONS - COST';

-- 4) "Tour Expenses" is its own distinct active head (head_name = sub_head_name there) -
-- these rows carry the sibling head "Tours, Travelling & Conveyance" instead (127 rows, Rs.9,07,943.00)
UPDATE grn_request
   SET head = 'Tour Expenses'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Tours, Travelling & Conveyance' AND sub_head = 'Tour Expenses';

-- 5) Computers - Software Cost, same Capex reclassification as 1790 (33 rows, Rs.27,92,112.82)
UPDATE grn_request
   SET head = 'Repairs & Maintenance - Capex'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'Computers - Software Cost';

-- 6) Local Conveyance A/c belongs under "Tours, Travelling & Conveyance", not the sibling head
-- "Tour Expenses" (11 rows, Rs.41,910.00) - mirror image of fix 4.
UPDATE grn_request
   SET head = 'Tours, Travelling & Conveyance'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Tour Expenses' AND sub_head = 'Local Conveyance A/c';

-- 7) R&M - Air Conditioner is a Repairs & Maintenance sub-head, not Hiring Charges (6 rows, Rs.85,500.00)
UPDATE grn_request
   SET head = 'Repairs & Maintenance'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Hiring Charges' AND sub_head = 'R&M - Air Conditioner';

-- 8) Company Owned Voice is a Communication & Connectivity sub-head, not "Others" (4 rows, Rs.22,600.00)
UPDATE grn_request
   SET head = 'Communication & Connectivity'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Others' AND sub_head = 'Company Owned Voice';

-- 9) "Fee & Subscription" is its own active head (head_name = sub_head_name there) -
-- these rows carry "Finance Expenses" instead (2 rows, Rs.23,397.00)
UPDATE grn_request
   SET head = 'Fee & Subscription'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Finance Expenses' AND sub_head = 'Fee & Subscription';

-- 10) Churn Payment belongs under "Contract Fees Facilities", not "Others"; casing corrected (1 row, Rs.0.00)
UPDATE grn_request
   SET head = 'Contract Fees Facilities', sub_head = 'Churn Payment'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Others' AND sub_head = 'CHURN PAYMENT';

-- 11) Same "Fee & Subscription" self-headed fix as (9), this row carries "Freight & Cargo Charges" (1 row, Rs.23,397.00)
UPDATE grn_request
   SET head = 'Fee & Subscription'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Freight & Cargo Charges' AND sub_head = 'Fee & Subscription';

-- 12) "Freight & Cargo Charges" is its own active head (head_name = sub_head_name there) -
-- this row carries "Others" instead (1 row, Rs.small)
UPDATE grn_request
   SET head = 'Freight & Cargo Charges'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Others' AND sub_head = 'Freight & Cargo Charges';

-- 13) Same stale-fiscal-year-label pattern as 1790's Computer Software Cost fix, one year later
-- (1 row) - "2026 - 27" text doesn't match the active "26-27" short form.
UPDATE grn_request
   SET sub_head = 'Computer software cost 26-27'
 WHERE grn_type = 'vendor'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'Computer Software Cost 2026 - 27';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Re-run backend/scripts/backfill-journal-entries.ts --grn (dry run) — the 13 combinations
-- above should no longer appear among the failures once --apply is used; the remaining
-- unresolved 13 combinations (121 rows) and 167 vendor-missing rows are expected and reported
-- by the script itself, not silently dropped.
