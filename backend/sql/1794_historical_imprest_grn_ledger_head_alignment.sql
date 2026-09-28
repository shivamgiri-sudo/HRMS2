-- 1794_historical_imprest_grn_ledger_head_alignment.sql
--
-- WHY
-- After the Phase 6 backfill (backend/scripts/backfill-journal-entries.ts --grn) finished its
-- full run (42,782 journal entries posted), a fresh live query of the remaining un-journaled,
-- non-salary GRNs (2026-09-17) found 604 rows across 66 distinct head/sub_head/grn_type combos.
--
-- 1791_historical_grn_ledger_head_alignment.sql already fixed the same class of "wrong head,
-- right subhead" text gap, but was scoped to grn_type='vendor' only (that's what its own
-- analysis covered). This migration is the grn_type='imprest' counterpart 1791 never touched:
-- of the 604 remaining rows, exactly 12 combos (271 rows) are IMPREST GRNs whose sub_head text
-- matches exactly one active row in finance_expense_sub_head_master once paired with the
-- correct head — several of them the literal same combo 1791 already fixed for vendor-type
-- rows (e.g. "Repairs & Maintenance"/"Computers - Cost" -> "Repairs & Maintenance - Capex").
-- Same method as 1790/1791: matched sub_head text case/whitespace-insensitively against every
-- active (head, sub_head) pair; applied only where exactly one candidate existed.
--
-- NOT touched by this migration, deliberately:
--   - ~333 of the 604 rows where head/sub_head text ALREADY matches an active ledger row exactly
--     (e.g. "Office Rent"/"Office Rent" x36, "Fee & Subscription"/"Fee & Subscription" x8) —
--     live-diagnosed 2026-09-17 as two DIFFERENT, unrelated data gaps, not a ledger-head
--     mismatch: most are vendor-type GRNs with vendor_id NULL (GRN_VENDOR_MISSING; 167 rows
--     total, non-salary), and the rest have amount_with_tax AND amount both NULL/zero (86 rows
--     total, non-salary) — journalService.post() correctly refuses these with "Line 1 has no
--     amount on either side." Neither is a text-mapping question this migration can answer;
--     both need a business/data-entry decision, not a guess.
--   - ~20 remaining genuinely-ambiguous head/sub_head combos with NO matching active ledger row
--     at all (e.g. "Communication & Connectivity"/"Communication & Connectivity",
--     "Staff Welfare"/"Staff Welfare", "Repairs & Maintenance"/"Repairs & Maintenance") — same
--     as 1791's own leftover 121 rows, left untouched for the same reason: no single candidate
--     to place them under.
--
-- Scope: every UPDATE restricted to grn_type='imprest' AND status IN the same "consumed/paid"
-- set backfill-journal-entries.ts selects on. TEXT ONLY — no amounts, vendors, or approval
-- state touched. Idempotent: each WHERE clause matches exact current text, so a re-run finds
-- nothing left to change.

SET NAMES utf8mb4;

-- Shared status scope for every UPDATE below.
-- ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')

-- 1) Electrical Installations - Cost, same Capex reclassification 1791 gave the vendor-type rows (73 rows)
UPDATE grn_request
   SET head = 'Repairs & Maintenance - Capex'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'Electrical Installations - Cost';

-- 2) CHURN PAYMENT filed under generic "Others" -> its real head (48 rows)
UPDATE grn_request
   SET head = 'Contract Fees Facilities', sub_head = 'Churn Payment'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Others' AND sub_head = 'CHURN PAYMENT';

-- 3) Business Promotion Expenses filed under "Staff Welfare" -> its real head (43 rows)
UPDATE grn_request
   SET head = 'Business Promotion Expenses'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Staff Welfare' AND sub_head = 'Business Promotion Expenses';

-- 4) Tour Expenses filed under the umbrella head -> its own head (31 rows)
UPDATE grn_request
   SET head = 'Tour Expenses'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Tours, Travelling & Conveyance' AND sub_head = 'Tour Expenses';

-- 5) "CONTRACT FEES" (all-caps legacy variant) -> "Contract Fees Facilities" (21 rows)
UPDATE grn_request
   SET head = 'Contract Fees Facilities'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'CONTRACT FEES' AND sub_head = 'Churn Payment';

-- 6) Furniture & Fixture - Cost, same Capex reclassification 1791 gave the vendor-type rows (17 rows)
UPDATE grn_request
   SET head = 'Repairs & Maintenance - Capex', sub_head = 'Furniture & Fixture - Cost'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'FURNITURE & FIXTURE - COST';

-- 7) Fee & Subscription filed under "Finance Expenses" -> its own head (16 rows)
UPDATE grn_request
   SET head = 'Fee & Subscription'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Finance Expenses' AND sub_head = 'Fee & Subscription';

-- 8) Computers - Cost, same Capex reclassification 1791 gave the vendor-type rows (8 rows)
UPDATE grn_request
   SET head = 'Repairs & Maintenance - Capex'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Repairs & Maintenance' AND sub_head = 'Computers - Cost';

-- 9) Business Promotion Expenses filed under "Spot/Floor/Field Incentive" -> its real head (6 rows)
UPDATE grn_request
   SET head = 'Business Promotion Expenses'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Spot/Floor/Field Incentive' AND sub_head = 'Business Promotion Expenses';

-- 10) Freight & Cargo Charges filed under generic "Others" -> its own head (4 rows)
UPDATE grn_request
   SET head = 'Freight & Cargo Charges'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Others' AND sub_head = 'Freight & Cargo Charges';

-- 11) Company Owned Voice filed under generic "Others" -> its real head (3 rows)
UPDATE grn_request
   SET head = 'Communication & Connectivity'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'Others' AND sub_head = 'Company Owned Voice';

-- 12) "CONTRACT FEES"/"Donation" -> Donation's real head is "Others" (1 row)
UPDATE grn_request
   SET head = 'Others'
 WHERE grn_type = 'imprest'
   AND status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
   AND head = 'CONTRACT FEES' AND sub_head = 'Donation';
