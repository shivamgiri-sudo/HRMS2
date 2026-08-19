-- 1309_client_billing_unmapped_legacy_cost_centre.sql
--
-- Client Billing Historical Cutover — creates ONE explicitly-flagged placeholder
-- cost_centre_master row so the 67 remaining unresolvable invoices (2015-16/
-- 2016-17, predating the current cost-centre numbering scheme — the other 20 of
-- the original 87 were resolved for real in migration 1307) can load and become
-- visible, instead of sitting invisible in a staging table indefinitely.
--
-- This is NOT a guess at which specific historical cost centre each row
-- belonged to. That was tried and explicitly rejected: matching by
-- client+branch+process family looked promising (7 of 10 legacy codes resolved
-- to exactly one candidate) but a date-continuity check disproved it — the
-- candidate for CM/FLD/KNL/036/037 (cost_centre_code CM/FLD/KNL/0112) turned out
-- to have its OWN invoices dated the same week in November 2015 as the rows
-- being matched to it, proving they were concurrently-active, DIFFERENT cost
-- centres for the same client/branch/process (multiple parallel teams), not one
-- renamed into the other. Forcing that match would have silently misattributed
-- real revenue to the wrong internal team's books.
--
-- What IS known with certainty and preserved honestly: all 67 rows are the same
-- client, Vodafone Mobile Services Ltd. (confirmed live:
-- SELECT DISTINCT src_cost_client — exactly one value across all 67).
-- Which specific sub-team/process cost centre is NOT known and is stated as such
-- in this row's own billing_client_name, rather than picking one of the ~7-19
-- real candidates at each branch and presenting a guess as fact.
--
-- Each invoice's own tally_head/client_tally_name (migration 1308) was already
-- backfilled from legacy's own frozen per-invoice snapshot, independent of
-- cost_centre_id — so the accounting reference data these 67 rows carry is
-- already fully correct regardless of which placeholder they point to here.
--
-- active_status=0: this placeholder is never a valid target for a NEW invoice
-- going forward (createProforma's cost-centre picker only lists active rows
-- per its own existing convention) — it exists solely so 67 already-existing
-- historical rows have somewhere honest to point.
--
-- Idempotent: explicit existence check (cost_centre_code has no unique
-- constraint in this schema, same as 1307's own idiom).
--
-- Rollback:
--   DELETE FROM cost_centre_master WHERE cost_centre_code = 'LEGACY-UNMAPPED-VODAFONE-2015-17';

INSERT INTO cost_centre_master (
  id, cost_centre_code, company_name, cost_centre_name,
  active_status, status, billing_client_name, revenue_flag, billing_flag
)
SELECT
  UUID(), 'LEGACY-UNMAPPED-VODAFONE-2015-17', 'Mas Callnet India Pvt Ltd',
  'Legacy Unmapped — Vodafone (2015-17)',
  0, 'closed',
  'Vodafone Mobile Services Ltd. — client confirmed, specific sub-team UNKNOWN (2015-17 legacy code, no reliable mapping found, see migration 1309). Needs manual reconciliation.',
  1, 0
WHERE NOT EXISTS (SELECT 1 FROM cost_centre_master WHERE cost_centre_code = 'LEGACY-UNMAPPED-VODAFONE-2015-17');
