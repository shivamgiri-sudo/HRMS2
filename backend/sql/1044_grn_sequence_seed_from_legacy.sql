-- 1044_grn_sequence_seed_from_legacy.sql
--
-- Stops the GRN page minting a number that already identifies a different bill.
--
-- THE PROBLEM
-- GRN numbers exist in TWO unconnected places:
--   grn_request   — written by the GRN page (/api/finance/grns), 3 rows, all Mas/42/...
--   expense_claim — legacy/ERP expenses, 5,534 rows carrying a grn_number, Mas/1..12/...
-- Zero of the 5,534 link to grn_request. Same Mas/<branch_seq>/<yy>/<seq> convention, two
-- independent sequences.
--
-- allocateGrnNumber() (modules/finance/grn-number.service.ts) mints from
-- finance_grn_sequence, keyed on (branch_id, financial_year), and starts a branch at 1 the
-- first time it is used. That table held exactly ONE row — branch febd8777 (branch_seq 42),
-- FY 2026-27. Every other branch was therefore going to start at 1, while expense_claim
-- already holds sequences up to 531 for those same branches and years.
--
-- So the first GRN raised for, say, Bangalore Office (branch_seq 5, legacy max 342 in
-- 2025-26) would have been Mas/5/25/1 — a number that already identifies a different bill.
--
-- Nothing would have objected. grn_request.uq_grn_number is unique, but it cannot see
-- expense_claim, and expense_claim has NO unique index on grn_number at all. Two different
-- bills, same GRN number, two tables, no error. It is masked today only because the sole
-- branch used so far (Mas/42) has no legacy rows.
--
-- THE FIX
-- Seed finance_grn_sequence so every branch/year that has legacy numbers starts ABOVE the
-- highest one already used. Derived from the data, not typed by hand:
--   branch  = branch_master.branch_seq matched to the number's 2nd segment
--   year    = '20' + the 3rd segment, e.g. 26 -> 2026-27
--   next    = MAX(4th segment) + 1
--
-- Only the REGEXP-matching numbers are considered, so a malformed legacy value cannot skew
-- a sequence upward.
--
-- SAFETY — GREATEST is the important part
-- ON DUPLICATE KEY UPDATE uses GREATEST(next_sequence, VALUES(next_sequence)), so this can
-- only ever move a sequence FORWARD. It cannot rewind the live branch (febd8777, next=4)
-- or undo a number allocated between writing and running this. Re-running is therefore
-- safe and converges. Verified: PRIMARY KEY is (branch_id, financial_year), so the
-- ON DUPLICATE clause genuinely fires — unlike the several places in this codebase where
-- the same clause was dead code for want of a matching key.
--
-- This does NOT reconcile the two systems. It removes the collision risk while the real
-- decision — whether grn_request becomes the single GRN record with expense_claim.grn_number
-- as a foreign key, or GRN stays a text field and grn_request is retired — is taken
-- separately. Seeding is cheap and reversible; that decision is neither.
--
-- Dry run against production: 16 rows across 12 branches and 2 financial years
-- (2025-26 and 2026-27), highest legacy sequence 531.

SET NAMES utf8mb4;

INSERT INTO finance_grn_sequence (branch_id, financial_year, next_sequence)
SELECT b.id,
       CONCAT('20', x.yy, '-', LPAD(CAST(x.yy AS UNSIGNED) + 1, 2, '0')) AS financial_year,
       x.max_seq + 1 AS next_sequence
  FROM (
    SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(grn_number, '/', 2), '/', -1) AS seg,
           SUBSTRING_INDEX(SUBSTRING_INDEX(grn_number, '/', 3), '/', -1) AS yy,
           MAX(CAST(SUBSTRING_INDEX(grn_number, '/', -1) AS UNSIGNED))   AS max_seq
      FROM expense_claim
     WHERE grn_number REGEXP '^Mas/[0-9]+/[0-9]{2}/[0-9]+$'
     GROUP BY seg, yy
  ) x
  JOIN branch_master b ON b.branch_seq = CAST(x.seg AS UNSIGNED)
ON DUPLICATE KEY UPDATE
  next_sequence = GREATEST(finance_grn_sequence.next_sequence, VALUES(next_sequence));

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Every branch/year with legacy numbers now starts above its highest existing one.
-- This must return ZERO rows:
--   SELECT b.branch_seq, s.financial_year, s.next_sequence, x.max_seq
--     FROM finance_grn_sequence s
--     JOIN branch_master b ON b.id = s.branch_id
--     JOIN (SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(grn_number,'/',2),'/',-1) seg,
--                  SUBSTRING_INDEX(SUBSTRING_INDEX(grn_number,'/',3),'/',-1) yy,
--                  MAX(CAST(SUBSTRING_INDEX(grn_number,'/',-1) AS UNSIGNED)) max_seq
--             FROM expense_claim
--            WHERE grn_number REGEXP '^Mas/[0-9]+/[0-9]{2}/[0-9]+$'
--            GROUP BY seg, yy) x
--       ON x.seg = b.branch_seq
--      AND s.financial_year = CONCAT('20', x.yy, '-', LPAD(CAST(x.yy AS UNSIGNED)+1, 2, '0'))
--    WHERE s.next_sequence <= x.max_seq;
--
-- The live branch was not rewound:
--   SELECT next_sequence FROM finance_grn_sequence
--    WHERE branch_id = 'febd8777-6583-11f1-adb1-00155d0ab410' AND financial_year = '2026-27';
--   -- expect >= 4
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- There is no safe automatic rollback: lowering a sequence would re-create the collision
-- this migration removes, and any GRN allocated in the meantime would be reissued. If these
-- rows must go, delete only those never used, and only after checking grn_request:
--   DELETE s FROM finance_grn_sequence s
--     JOIN branch_master b ON b.id = s.branch_id
--    WHERE b.branch_seq <> 42
--      AND NOT EXISTS (SELECT 1 FROM grn_request g WHERE g.branch_id = s.branch_id);
