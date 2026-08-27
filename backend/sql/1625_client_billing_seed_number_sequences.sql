-- 1625_client_billing_seed_number_sequences.sql
--
-- CRITICAL data-integrity fix for the client-billing module.
--
-- The 2026-08-19 historical cutover loaded 10,794 legacy invoices into
-- `client_invoice` carrying their VERBATIM legacy numbers (proformas up to
-- `PI/09/7971`, bills up to `09-274/26-27`), but nothing anywhere seeded
-- `client_invoice_number_sequence` — the atomic counter that
-- client-billing-numbering.service.ts mints every NEW number from. Verified live
-- 2026-08-27: the table is EMPTY (0 rows) while 10,794 numbered invoices exist.
--
-- Consequence without this migration: the first live `createProforma` mints
-- `PI/<state>/1` and the first live `approveInvoice` mints `<state>-01/<FY>` —
-- both of which ALREADY EXIST in the book. `client_invoice` has no UNIQUE index on
-- either column (1,999 duplicate bill_no groups are already inherited from legacy),
-- so the collision does not error: it silently issues a second invoice under a
-- number already given to a client. For FY 2026-27 alone, state 09 is already at
-- sequence 274 and state 24 at 26, so the very first approval of the year would
-- duplicate a live invoice number. Under GST Rule 46(b) an invoice number must be a
-- unique consecutive serial within the financial year.
--
-- What this seeds, and why each value is derivable rather than guessed:
--
--   kind='proforma', scope_key='GLOBAL'
--     mintProformaNumber uses ONE global counter (matches legacy bill_no_master
--     id=1). Verified live: 7,508 rows carry a proforma_no and 100% of them match
--     `^PI/<digits>/<digits>$` (0 exceptions), so MAX() of the trailing segment is
--     the true high-water mark. Live value: 7971.
--
--   kind='bill', scope_key='<gst_state_code>|<company_name>|<finance_year>'
--     mintBillNumber scopes per (state_code, company_name, finance_year). Only
--     bill numbers in the modern `NN-NNN/YY-YY` shape can collide with it; the
--     3,052 legacy rows in the older `NNN/BRANCH/YYYY-YYYY` shape cannot and are
--     excluded by the REGEXP. The state code is taken from `branch_master.gst_state_code`
--     — the exact value the mint itself will use — not parsed from the bill number;
--     verified live that the two agree on 7,740 of 7,740 rows, so the grouping is
--     identical either way. Live: 73 scopes.
--
--   kind='credit_note' — deliberately NOT seeded. Migrated credit notes all carry
--     the legacy `DD-MM/FY` date-stamp format (verified live: 0 of 144 use the new
--     `CN-<state>-<NN>/<FY>` shape), so a fresh counter starting at 1 cannot collide
--     with any existing credit note number.
--
-- Idempotent and re-run safe: ON DUPLICATE KEY UPDATE takes GREATEST(), so
-- re-running never rewinds a counter that has legitimately advanced past the seed
-- because live invoices were issued in the meantime.
--
-- Additive only. Writes to `client_invoice_number_sequence` exclusively; reads
-- `client_invoice`, `cost_centre_master`, `branch_master` and modifies none of them.
-- No invoice, amount, tax figure or existing number is altered by this migration.
--
-- Rollback (only safe while no live invoice has been issued since):
--   DELETE FROM client_invoice_number_sequence WHERE kind IN ('proforma','bill');
--
-- RENUMBERED BEFORE RELEASE. This first landed on disk as
-- `migrations/1622_client_billing_seed_number_sequences.sql` and was applied to production
-- under that filename on 2026-08-27 (schema_migrations records it, executor "Work:33340") —
-- a local `tsx watch` backend picked up the manifest edit and ran it, since backend/.env
-- points DB_HOST at the live mas_hrms. It was renumbered afterwards because 1622, 1623 and
-- 1624 were all claimed by concurrent sessions, and moved from sql/migrations/ to sql/
-- because that is where the manifest guard looks for new files (the sql/migrations/ entries
-- are grandfathered in the lock's knownDangling list).
--
-- So production carries a schema_migrations row under the OLD name and will apply this file
-- again under the new one. That is harmless and deliberate: every statement here is
-- ON DUPLICATE KEY UPDATE ... GREATEST(), so the second run cannot rewind a counter or
-- change a value — it is a no-op unless a scope is genuinely behind.

INSERT INTO client_invoice_number_sequence (kind, scope_key, `last_value`, updated_at)
SELECT 'proforma', 'GLOBAL',
       MAX(CAST(SUBSTRING_INDEX(ci.proforma_no, '/', -1) AS UNSIGNED)),
       NOW()
  FROM client_invoice ci
 WHERE ci.proforma_no REGEXP '^PI/[0-9]+/[0-9]+$'
HAVING MAX(CAST(SUBSTRING_INDEX(ci.proforma_no, '/', -1) AS UNSIGNED)) IS NOT NULL
ON DUPLICATE KEY UPDATE
  `last_value` = GREATEST(`last_value`, VALUES(`last_value`)),
  updated_at   = NOW();

INSERT INTO client_invoice_number_sequence (kind, scope_key, `last_value`, updated_at)
SELECT 'bill',
       CONCAT(b.gst_state_code, '|', cc.company_name, '|', ci.finance_year),
       MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(ci.bill_no, '/', 1), '-', -1) AS UNSIGNED)),
       NOW()
  FROM client_invoice ci
  JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
  JOIN branch_master b       ON b.id  = cc.branch_id
 WHERE ci.bill_no REGEXP '^[0-9]{2}-[0-9]+/[0-9]{2}-[0-9]{2}$'
   AND b.gst_state_code IS NOT NULL AND b.gst_state_code <> ''
   AND cc.company_name IS NOT NULL AND cc.company_name <> ''
 GROUP BY b.gst_state_code, cc.company_name, ci.finance_year
ON DUPLICATE KEY UPDATE
  `last_value` = GREATEST(`last_value`, VALUES(`last_value`)),
  updated_at   = NOW();
