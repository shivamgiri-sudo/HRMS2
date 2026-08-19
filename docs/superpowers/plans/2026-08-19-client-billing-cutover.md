# Client Billing Historical Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract and validate `db_bill`'s 11,335 `tbl_invoice` + 134
`tbl_credit_note` rows into a staging shape ready for the new
`client_invoice`/`client_credit_note` schema, and produce a real
validation report — **without writing a single row into
`client_invoice`/`client_credit_note` in this plan.** The load step is
written and unit-tested against fixtures only; it is explicitly forbidden
from being executed against the real database by any task in this plan.

**Architecture:** Read `docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md`
in full before starting — every field mapping and data-quality decision
below refers back to it by section number rather than repeating it.

**Tech Stack:** Node/TypeScript scripts under `backend/scripts/`, mysql2,
vitest, MySQL 8 (`mas_hrms`) + MySQL 5.5 (`db_bill`, read-only, via
`BILL_DB_HOST`/`BILL_DB_USER`/`BILL_DB_PASSWORD` in `backend/.env` — a
**different** credential from the `mas_hrms` one, confirmed this
session).

## Global Constraints — read this section twice

- **`db_bill` access is READ-ONLY, absolutely, in every task of this
  plan.** Never `INSERT`/`UPDATE`/`DELETE` against `db_bill` under any
  circumstance — it is the live legacy production system, still
  potentially in use.
- **The load step (writing into `client_invoice`/`client_invoice_line`/
  `client_credit_note`/`client_credit_note_line`) must NOT be executed
  against the real `mas_hrms` database by any task in this plan.** Write
  and unit-test the load function against an in-memory/mocked
  connection and fixture data only. If a task's own instructions seem to
  imply running it for real, they don't — flag it and stop rather than
  run it. This is a hard stop, not a judgment call.
- The staging table (`client_invoice_migration_staging`) IS safe to
  create and populate for real — it holds no financially-authoritative
  data, only a working copy for validation, and is explicitly designed
  to be dropped after cutover is confirmed stable.
- Every money value cast from legacy's `VARCHAR` columns (`total`, `tax`,
  `igst`, `sgst`, `cgst`, `grnd`) must be validated as a parseable
  decimal before being trusted — a non-numeric string is a real,
  expected failure mode (design §6.2), not a hypothetical.
- New migration registered in BOTH `runPendingMigrations.ts`'s
  `MIGRATION_MANIFEST` array AND the regenerated lock file. Same
  migration-number collision-check discipline as every prior phase:
  check `ls backend/sql/migrations/*.sql | grep -oE '[0-9]+' | sort -n |
  tail -3` immediately before picking a number.
- Never paste either `DB_PASSWORD` or `BILL_DB_PASSWORD`'s literal value
  into any committed file — reference the env var name only.
- `git push`/`git fetch` hang indefinitely — use the GitHub REST API
  blob/tree/commit/ref-update method via `gh api` against
  `shivamgiri-sudo/HRMS2` for every commit, exactly as every prior phase
  this session. Re-fetch `refs/heads/main` immediately before building
  each tree.
- This repo has many concurrent sessions. Back up every new/changed file
  to a scratch location right after writing it.

---

## File Structure

- `backend/sql/migrations/NNNN_client_billing_cutover_schema.sql` — new,
  `is_migrated`/`legacy_id` columns on `client_invoice`/`client_credit_note`,
  plus the `client_invoice_migration_staging` table.
- `backend/src/db/runPendingMigrations.ts`, lock file — modified.
- `backend/scripts/client-billing-cutover/extract.ts` — new, reads
  `db_bill`, writes staging rows.
- `backend/scripts/client-billing-cutover/validate.ts` — new, dry-run
  validation, produces the report. Zero writes to `client_invoice`/
  `client_credit_note`.
- `backend/scripts/client-billing-cutover/load.ts` — new, the actual
  load function — **written and fixture-tested only, never executed for
  real in this plan.**
- `backend/scripts/client-billing-cutover/__tests__/*.test.ts` — new.
- `backend/src/modules/client-billing/client-billing-approval.service.ts`,
  `client-billing-credit-note.service.ts` — modified, one guard clause
  each refusing to mutate an `is_migrated = 1` row (design §3).

---

### Task 1: Schema migration — is_migrated/legacy_id + staging table

**Files:**
- Create: `backend/sql/migrations/NNNN_client_billing_cutover_schema.sql`
- Modify: `runPendingMigrations.ts`, lock file

**Interfaces:**
- Produces: `client_invoice.is_migrated TINYINT(1) NOT NULL DEFAULT 0`,
  `client_invoice.legacy_id INT NULL` with a unique index; same two
  columns on `client_credit_note`; table
  `client_invoice_migration_staging` (columns: every legacy `tbl_invoice`
  column verbatim, prefixed `src_`, plus computed target columns —
  `target_id CHAR(36)`, `target_gst_type`, `target_apply_gst`,
  `target_is_migrated` fixed `1`, `validation_error VARCHAR(500) NULL`,
  `validation_status ENUM('pending','valid','error') DEFAULT 'pending'`).

- [ ] **Step 1**: verify migration number free, write the migration
  (`IF NOT EXISTS`, `COLLATE=utf8mb4_unicode_ci` matching this module's
  existing tables, unique index on `legacy_id` — confirm MySQL 8's
  nullable-unique-column semantics actually behave as design §3 assumes
  by testing it directly: insert two rows with `legacy_id = NULL` into a
  throwaway test table locally and confirm both succeed, cite the real
  test output in your report, don't just assert MySQL's documented
  behavior applies here).
- [ ] **Step 2**: register in `MIGRATION_MANIFEST`, regenerate lock.
- [ ] **Step 3**: PREPARE-verify against real `mas_hrms` (read-only
  check, same as every prior phase).

**Definition of Done:** migration registered, nullable-unique-index
behavior independently proven (not assumed), PREPARE-verified live.

---

### Task 2: Extraction script

**Files:**
- Create: `backend/scripts/client-billing-cutover/extract.ts`
- Create: its test file

**Interfaces:**
- Consumes: `db_bill.tbl_invoice`/`tbl_credit_note` (read-only).
- Produces: rows in `client_invoice_migration_staging` (Task 1's schema).

- [ ] **Step 1**: connect to `db_bill` via `BILL_DB_*` env vars, read
  `tbl_invoice` excluding `status = 1` rows (design §5.7), map every
  column per design §2–§5: `is_migrated=1`, `legacy_id = tbl_invoice.id`,
  `gst_type`/`apply_gst` per §5.2, `category` normalized per §5.5's
  mapping table (`Talktime`→`Talk Time` and any other casing variants
  you find — re-verify the live distinct `category` values yourself
  rather than trusting the design doc's sample, more variants may exist
  beyond what a `LIMIT 10` query surfaced), `description` gets the
  `InvoiceDeleteRemarks` bracketed note per §5.6 where present, amount
  columns cast from `VARCHAR` with a try/catch recording a
  `validation_error` on parse failure rather than crashing the whole
  extraction run.
- [ ] **Step 2**: same for `tbl_credit_note` into an analogous staging
  shape (extend Task 1's staging table with a `kind` discriminator
  column, or add a second staging table — implementer's judgment, note
  which you chose and why).
- [ ] **Step 3**: run the real extraction against `db_bill` (this is
  fine — it only writes to the throwaway staging table, never to
  `client_invoice`/`client_credit_note`). Report real row counts written
  vs. skipped vs. errored.

**Definition of Done:** staging table populated from real `db_bill` data,
real counts reported, `db_bill` itself confirmed untouched (re-run the
same `SELECT COUNT(*)` against `tbl_invoice`/`tbl_credit_note` before and
after, prove they're identical).

---

### Task 3: Validation dry-run + report

**Files:**
- Create: `backend/scripts/client-billing-cutover/validate.ts`
- Create: its test file

**Interfaces:**
- Consumes: `client_invoice_migration_staging` (Task 2's output).
- Produces: `validation_status`/`validation_error` updated per staging
  row (writes ONLY to the staging table — never to `client_invoice`/
  `client_credit_note`); a human-readable report (markdown file under
  `docs/superpowers/plans/` or similar) summarizing: total rows,
  valid/error counts, every distinct `validation_error` message with its
  count, the full list of `bill_no`/`credit_no` collision groups (design
  §5.3) with their `legacy_id`s, every `category` normalization applied
  and its count, GST-type-null row count.

- [ ] **Step 1**: for every staging row, re-validate: does every
  required target column have a value; does every amount parse as a
  decimal; is the target row's shape actually insertable against
  `client_invoice`'s real current schema (PREPARE a real `INSERT`
  statement with the row's values as parameters — don't `EXECUTE`, just
  confirm it PREPAREs cleanly, catching any column/type mismatch this
  design might not have anticipated).
- [ ] **Step 2**: write the report exactly as the Interfaces section
  describes, with real numbers from the real run — this file is what
  the human sign-off in design §9 is based on, so it must be accurate,
  not optimistic.
- [ ] **Step 3**: push the report itself (a markdown file, no secrets) so
  it's reviewable without needing DB access.

**Definition of Done:** every staging row has a real `validation_status`,
the report contains real counts from an actual run against real `db_bill`
data (not estimated), zero rows exist in `client_invoice`/
`client_credit_note` beyond whatever existed before this task ran
(prove this with a `COUNT(*)` before/after).

---

### Task 4: Load function (write + fixture-test only — DO NOT EXECUTE FOR REAL)

**Files:**
- Create: `backend/scripts/client-billing-cutover/load.ts`
- Create: its test file
- Modify: `client-billing-approval.service.ts`,
  `client-billing-credit-note.service.ts` (the `is_migrated` mutation
  guard, design §3)

**Interfaces:**
- Consumes: `client_invoice_migration_staging` rows where
  `validation_status = 'valid'`.
- Produces: (when eventually run, NOT in this task) rows in
  `client_invoice`/`client_invoice_line`/`client_credit_note`/
  `client_credit_note_line`.

- [ ] **Step 1**: write `loadValidatedRows(conn, staging Rows)` —
  one transaction per legacy row (design §6.4), idempotent via the
  `legacy_id` unique index (an `INSERT ... ON DUPLICATE KEY UPDATE` or
  an existence check first — implementer's judgment, note which and
  why). **Test this exclusively against a mocked `db.execute`/fixture
  staging rows. Do not point it at the real `mas_hrms` connection, do
  not call it from any script that runs automatically, and do not add
  it to any migration or startup path.** It should not be reachable by
  anything except a manual, human-invoked follow-up script outside this
  plan's scope.
- [ ] **Step 2**: add the `is_migrated` guard clause to `approveInvoice`,
  `rejectInvoice`, `createCreditNote`'s underlying invoice-lookup (refuse
  with a clear `statusCode: 400` message if the target invoice/credit
  note has `is_migrated = 1`) — this part IS safe to ship for real, since
  it only tightens an existing guard and has no effect while
  `is_migrated` is 0 on every current row.
- [ ] **Step 3**: full test suite for the module, confirm no regression.

**Definition of Done:** `load.ts` exists, is fully unit-tested against
fixtures, and — explicitly confirmed in the task report — has never been
invoked against the real database. The `is_migrated` guard is live and
tested. Report states in plain words: "the load step was written and
tested but NOT executed against production; execution requires a
separate, explicit go-ahead per the design's §9."

---

## Final Review Checklist (for the reviewer subagent)

- **Above all else**: confirm zero rows were written into
  `client_invoice`/`client_invoice_line`/`client_credit_note`/
  `client_credit_note_line` by any task in this plan, beyond whatever
  existed before the plan started. Run `SELECT COUNT(*) FROM
  client_invoice` (etc.) yourself and compare against the pre-plan
  baseline (0, per this session's own prior verification) — this is the
  single most important thing to check in this entire review.
- Confirm `db_bill` was never written to (re-run the row-count comparison
  from Task 2's own Definition of Done).
- Confirm the validation report's numbers are real (spot-check a handful
  of `validation_error` rows and a few `bill_no` collision groups against
  a fresh, independent query of the staging table).
- Confirm `load.ts` is not wired into anything that runs automatically
  (grep for its import/invocation across the whole backend — it should
  appear only in its own test file).
- Confirm the `is_migrated` guard clauses are correctly placed and
  tested (an approve/reject/credit-note-create call against a migrated
  row must 400, and must NOT 400 for a normal `is_migrated=0` row —
  both directions need a real test).