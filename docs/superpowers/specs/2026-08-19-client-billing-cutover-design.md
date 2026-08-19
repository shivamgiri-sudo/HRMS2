# Client Billing — Historical Cutover Design

Status: Design only — no data migration executes without a separate, explicit go-ahead (see §9)
Date: 2026-08-19
Author: Claude (session with shivam.giri@teammas.in)

## 1. Purpose

Sixth and final phase of the client-billing replica. Migrates `db_bill`'s
historical `tbl_invoice` (11,335 rows) and `tbl_credit_note` (134 rows) into
`client_invoice`/`client_invoice_line` and `client_credit_note`/
`client_credit_note_line`, so the new system has full history rather than
starting empty, and seeds the new number sequences so nothing issued going
forward collides with anything historical.

This is a different risk class from every prior phase: it writes ~11,469
real financial records into production. Every prior phase touched empty
tables or read-only logic. **Design and a dry-run validation pass proceed
under this session's standing authorization; the actual production write
does not, and waits for explicit sign-off (§9).**

## 2. What the live legacy data actually looks like (not assumed — queried)

Connected via `BILL_DB_HOST`/`BILL_DB_USER`/`BILL_DB_PASSWORD` (public host,
a *different* credential from the `mas_hrms` one — `backend/.env`, never
pasted literally in this file). Findings:

- **11,335 rows** in `tbl_invoice`, date range 2015-10-14 to 2026-08-18
  (`createdate`; 2 rows have a zero/garbage date — see §5).
- **134 rows** in `tbl_credit_note`.
- `status`: 0 = active (10,707) / "under legal process" (89, via
  `InvoiceDeleteRemarks`) vs 1 = deleted/void (234). `proforma_approve`:
  1 = approved/billed (6,889) vs 0 = still proforma (4,142).
- `GSTType`: `Integrated` (5,341), `Intrastate` (3,453), **`NULL`/`''`
  (2,237, ~19.7%)** — no tax split recorded at all for nearly a fifth of
  rows.
- **`bill_no` collisions are severe and real, not a modeling artifact**:
  4,023 rows (35.5%) share a `bill_no` with at least one other row — 2,010
  distinct numbers reused. Verified on one example (`09-129/20-21`): three
  genuinely different invoices — different cost centres, different totals
  (₹4,000 / ₹0 / ₹64,61,838) — all carry the identical number. This is the
  same non-atomic-counter bug class already fixed in this session's new
  numbering service, except it hit `bill_no` itself historically, not only
  `credit_no`. **Legacy `bill_no` cannot be the new schema's unique key —
  it never was unique in the source data.**
- `credit_no` collisions are worse proportionally: one number
  (`17-06/22-23`) is reused by **25** different credit notes; nine more
  numbers are reused 3–10 times each. Confirms and quantifies what an
  earlier phase this session found on a 2-row sample — the real scope is
  far larger.
- 211 rows have no `bill_no` at all (never reached billed status). 3,344
  rows have no `proforma_bill_no`.
- `category` has real inconsistent values needing normalization:
  `Talk Time` (662) vs `Talktime` (144) are the same category typed two
  ways; `Others` dominates at 8,005/11,335 (70.6%).
- `invoiceType`: `Revenue` (10,875) vs `Non Revenue` (75) vs blank (81) —
  a dimension not currently modeled anywhere in the new schema.

## 3. Migrated-row identity — the central design decision

The new schema's `client_invoice.id` is a fresh `UUID()`, generated at
migration time — **never** derived from or equal to the legacy numeric
`id`. Legacy's `bill_no`/`proforma_no`/`credit_no` are preserved verbatim
in their existing columns as historical record (Tally reconciliation and
audit trail depend on the exact string staff already know), but with two
changes from how a newly-created row behaves:

- **No uniqueness is enforced on a migrated row's `bill_no`/`proforma_no`/
  `credit_no`** — the existing columns are plain `VARCHAR`, not unique
  keys (confirmed: `client_invoice`/`client_invoice_line` from migration
  1300 never added a unique constraint on these columns — this was already
  correct for exactly this reason, whether by foresight or luck).
- A new `is_migrated BOOLEAN NOT NULL DEFAULT 0` column (migration, both
  invoice and credit-note tables) marks every cutover row explicitly,
  plus `legacy_id INT NULL` carrying the source `tbl_invoice.id`/
  `tbl_credit_note.id` for a permanent, queryable link back to `db_bill`
  during the overlap period and any future audit. A unique index on
  `legacy_id WHERE is_migrated = 1` (partial-index equivalent: since
  MySQL 8 lacks partial indexes, enforced instead as a plain unique index
  on `legacy_id` with new rows always inserting `NULL`, which MySQL
  treats as distinct per occurrence — the standard "nullable unique
  column" pattern already used elsewhere in this schema) makes the
  migration itself idempotent — re-running it updates instead of
  duplicating.

`is_migrated` also answers the open question every prior phase's design
deferred: **going forward, only `is_migrated = 0` rows are eligible for
`approveInvoice`/`rejectInvoice`/`createCreditNote`'s mutations** — a
historical row is a read-only record, never re-approved or re-rejected
through the live workflow. Enforced with one guard clause at the top of
each mutation service function.

## 4. Number-sequence seeding

`client_invoice_number_sequence`'s `last_value` per `(kind, scope_key)`
must seed high enough that the next real `mintProformaNumber`/
`mintBillNumber`/`mintCreditNoteNumber` call never collides with a
migrated historical number. Given §2's collision finding, "seed from
`MAX()` of the legacy numeric suffix per scope" is **not safe as a single
global MAX per finance year** — different colliding rows can have
different scopes recorded inconsistently. The seeding query instead:

```sql
-- illustrative shape, exact scope_key format matches mintBillNumber's own
-- <stateCode>-<NN>/<FYshort> construction, parsed back out of legacy
-- bill_no via the same regex the numbering service itself would produce
SELECT scope_key, MAX(sequence_number) AS seed_value
FROM (
  -- parse each historical bill_no into (scope_key, sequence_number),
  -- discarding rows where the number doesn't match the expected shape
  -- at all (a handful of very old/manually-entered numbers, per §2)
) parsed
GROUP BY scope_key;
```

Every `(kind, scope_key)` combination present in the historical data gets
one `INSERT ... ON DUPLICATE KEY UPDATE last_value = GREATEST(last_value,
VALUES(last_value))` row — never a plain overwrite, so seeding twice (or
seeding after some real invoices have already been created in the new
system with an early `scope_key`) can't move a counter backward.
Proforma numbers (`PI/<state>/<n>`) are seeded the same way from
`proforma_bill_no` where parseable.

## 5. Data-quality handling (explicit decisions, not silent defaults)

Per this session's standing rule of proposing a clear recommendation
rather than leaving ambiguity, here is the call for each issue §2 found —
all reviewable/reversible before the real write, none silently assumed:

1. **2 rows with a zero/garbage `createdate`**: excluded from migration
   (logged to a report, not silently dropped) — too few to be worth
   building special-case handling for, and a financial record with an
   unrecoverable date is not safely representable.
2. **2,237 rows with no `GSTType`**: migrated with `gst_type = NULL` and
   `apply_gst = 0` (not defaulted to a real value we don't have evidence
   for) — the frontend's `GstBreakdown` already renders correctly when
   `apply_gst` is falsy (skips the tax lines entirely, shows only taxable
   value and grand total), so this displays honestly as "no GST recorded"
   rather than fabricating a split.
3. **`bill_no`/`credit_no` collisions (4,023 + colliding credit notes)**:
   every row still migrates — collisions are a legacy data-quality fact
   to preserve accurately, not a reason to drop real financial history.
   `legacy_id` (§3) is what actually disambiguates them in the new
   system; the human-readable number stays exactly as legacy recorded it,
   collisions and all, with a migration-report line listing every
   colliding group for Finance's awareness (not for me to resolve
   unilaterally — a human call on whether any of these need real-world
   reconciliation).
4. **211 rows with no `bill_no`**: migrated as `invoice_status =
   'proforma'` with `bill_no = NULL` (matches their real never-finalized
   state — not fabricating a number).
5. **`category` casing** (`Talk Time` / `Talktime`, similar variants):
   normalized to a single canonical value per group during migration
   (mapping table in the migration script, e.g. `Talktime` → `Talk Time`)
   — display-only cleanup, the original legacy string is not itself a
   business key anywhere.
6. **`status = 0` + `InvoiceDeleteRemarks = 'Under legal process'` (89
   rows)**: migrated as a normal historical row (not excluded — a
   legal-hold invoice is still a real invoice), but `description` gets
   the remark appended in a bracketed note so it's visible in the UI
   without inventing a new status enum value for 89 rows.
7. **`status = 1` (234 rows, legacy's own "deleted")**: **excluded from
   migration** — legacy itself no longer considers these live records;
   migrating a deleted row as if it were active history would be wrong,
   not merely imperfect.
8. **`invoiceType` (Revenue/Non Revenue)**: not currently modeled in
   `client_invoice` — out of scope for this migration to add a new
   column for a dimension nothing in the new system reads yet; the raw
   value is preserved in the migration's staging table (§6) so it isn't
   lost, in case a future phase needs it.

## 6. Migration mechanics

A **staging table** (`client_invoice_migration_staging`, throwaway,
`x_`-prefixed-equivalent for this purpose — dropped after cutover is
confirmed stable) holds the raw legacy row plus computed target fields
and a `validation_error` column. Process:

1. **Extract**: read `tbl_invoice`/`tbl_credit_note` (excluding §5.7's
   deleted rows) into the staging table via a script, applying §5's
   normalization and §3's `legacy_id` assignment. Read-only against
   `db_bill` throughout — never writes back to the legacy system.
2. **Validate**: a dry-run pass computes every target row's shape and
   flags anything that would fail a constraint (missing required field,
   an amount that doesn't parse as a decimal — several `total`/`tax`/
   `igst` columns are `VARCHAR`, not `DECIMAL`, in legacy, so a non-
   numeric string is a real possible failure mode to check for, not
   assume away) — **zero rows write to `client_invoice` during this
   step.** Produces a report: row counts, every validation failure with
   its legacy `id`, every `category` normalization applied, every
   `bill_no`/`credit_no` collision group.
3. **This report is what gets reviewed before §9's sign-off** — real
   numbers, not estimates.
4. **Load** (only after sign-off): a single transaction per legacy row
   (not one giant transaction for all 11,469 — a mid-migration failure
   should only need to resume from where it stopped, not roll back
   everything), idempotent via the `legacy_id` unique index (§3), so a
   partial run can safely re-run to completion.
5. **Seed sequences** (§4) — run once, after the load, from the now-
   migrated `client_invoice`/`client_credit_note` data itself (simpler
   and more auditable than parsing legacy strings directly a second
   time).

## 7. Out of scope

- `tbl_tally_row_invoice_data` (35 rows) and `tm_tbl_invoice` (2 rows) —
  small auxiliary/legacy-internal tables with no clear equivalent in the
  new schema; not migrating without a specific, separate reason to.
- Re-running GST computation on any historical row — every migrated
  row's tax figures come from legacy's own `tax`/`igst`/`sgst`/`cgst`/
  `grnd` columns verbatim (cast to `DECIMAL`), never recalculated by the
  new `computeGst` logic, which must never touch history it didn't
  originate.
- PO/provision backfill — legacy's `tbl_invoice.po_no`/`po_createdate`
  exist, but `client_po_number`/`client_provision` have no historical
  counterpart designed yet and nothing currently reads them for a
  migrated row; a future decision, not blocking this cutover.
- Any change to `db_bill` itself — extraction is strictly read-only.

## 8. Testing discipline

Same standard as every prior phase, raised for the stakes here: the
staging/validation script gets full test coverage against fixture data
reproducing every quirk in §2 (a colliding `bill_no` pair, a `NULL`
`GSTType` row, a non-numeric `total` string, a zero-date row, a `status=1`
row) before it ever runs against the real `db_bill` connection. The
validation dry-run (§6.2) itself IS the live-verification step for this
phase — it must run against real `db_bill` data and produce a real report
before anyone signs off on the load step.

## 9. Explicit approval gate

Per CLAUDE.md's non-negotiable rule ("never run migrations, destructive
SQL, seed/reset operations... against production without explicit user
approval") and the master build sequence's own Phase 10 gating for data
migration/UAT — **this design and the validation dry-run (§6.1–6.3)
proceed under this session's existing standing authorization to continue
the roadmap. The load step (§6.4, the actual write of ~11,469 rows into
production `client_invoice`/`client_credit_note`) does not, and stops for
a real human decision once the validation report exists** — specifically
because, unlike every prior phase, this step writes financially
consequential historical data at scale into a live system, not schema or
empty-table scaffolding.

## Self-review

**Placeholder scan**: none — every number in §2 came from a live query
this session, not a guess. **Internal consistency**: §3's `is_migrated`
flag is introduced once and its consequence (read-only historical rows)
is stated in the same section, then referenced not re-derived in §5.6.
**Scope check**: extraction + validation + (gated) load, sized like a
real but bounded final phase — not expanded to also fix `invoiceType`
modeling or PO backfill, both explicitly deferred in §7 with a reason.
**Ambiguity check**: §5's eight numbered decisions each state the
concrete row count they affect and the reasoning, specifically so a
reader can independently agree or disagree per-item rather than having
to accept or reject the whole migration as a package.