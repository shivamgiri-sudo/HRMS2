# Client Billing Historical Cutover — Design Addendum A1-A4 Results

Date: 2026-08-19
Author: Claude (addendum implementer subagent)
Source: real run of the updated `validate.ts` against live `mas_hrms`
`client_invoice_migration_staging` (10,797 rows) and
`client_credit_note_migration_staging` (144 rows) — the same tables Task 3's
original report (`2026-08-19-client-billing-cutover-validation-report.md`)
covers. This file is a companion, not a replacement — it records only what
changed by applying the design addendum
(`docs/superpowers/specs/2026-08-19-client-billing-cutover-addendum.md`)
A1-A4 on top of Task 3's baseline. A new file was used instead of editing the
2,275-line original because that file's own huge per-bill_no/credit_no
collision appendices are unaffected by this work and re-diffing them would
only add noise.

**Every number below came from the real `validate.ts` run's own stdout,
independently cross-checked a second way inside that same run (a per-row
Node validation pass vs. a set-based SQL `COUNT(*)` aggregate query against
`validation_status`/`target_cost_centre_id`/`target_invoice_id` — all four
cross-checks reported `MATCH`). Nothing here is estimated.**

---

## 0. Hard constraint — unchanged throughout

`client_invoice` and `client_credit_note` were 0 rows before this run and 0
rows after:

```
[validate] BEFORE: client_invoice=0 client_credit_note=0
[validate] AFTER:  client_invoice=0 client_credit_note=0
[validate] client_invoice unchanged: MATCH, client_credit_note unchanged: MATCH
```

This script writes only to `client_invoice_migration_staging` /
`client_credit_note_migration_staging`'s own columns
(`target_gst_type`, `target_apply_gst`, `target_cost_centre_id`,
`target_invoice_id`, `src_category`, `validation_status`,
`validation_error`) — never to `client_invoice`, `client_invoice_line`,
`client_credit_note`, or `client_credit_note_line`.

## 1. Before / after — validation_status

| | Total | Before (Task 3) valid | Before error | After (this run) valid | After error | Rows moved error → valid |
|---|---|---|---|---|---|---|
| **Invoices** | 10,797 | 8,050 (74.6%) | 2,747 | **10,709 (99.2%)** | **88** | **+2,659** |
| **Credit notes** | 144 | 0 (0%) | 144 | **53 (36.8%)** | **91** | **+53** |

Both the per-row loop and the set-based SQL `COUNT(*)` query landed on
identical numbers:

```
[validate] set-based cross-check: invoices valid=10709 error=88 (per-row said valid=10709 error=88) MATCH
[validate] set-based cross-check: credit notes valid=53 error=91 (per-row said valid=53 error=91) MATCH
[validate] set-based cross-check: A3 invoices with target_cost_centre_id set=10710 (per-row said resolved=10710) MATCH
[validate] set-based cross-check: A4 credit notes with target_invoice_id set=53 (per-row said resolved=53) MATCH
```

## 2. A1 — gst_type / apply_gst derivation

`computeGstType()` (`extract.transforms.ts`) ran against every row that
still held `target_gst_type IS NULL` after the original extraction
(2,229 invoice rows, all 144 credit-note rows). `branchStateCode` was
resolved live via `cost_centre_master.branch_id -> branch_master.gst_state_code`
— the same comparison `client-billing.service.ts`'s `createProforma()` already
relies on.

| | Rows re-derived | → Intrastate | → Integrated | → 'Not Applicable' |
|---|---|---|---|---|
| **Invoices** | 2,229 | **1,781** | **141** | **307** |
| **Credit notes** | 144 | **6** | **43** | **95** |

```
[validate] A1 (invoices): 2229 blank-GSTType rows resolved — Intrastate=1781 Integrated=141 'Not Applicable'=307
[validate] A1 (credit notes): 144 blank-GSTType rows resolved — Intrastate=6 Integrated=43 'Not Applicable'=95
[validate] invoices with target_gst_type NULL (post-A1, should be 0): 0
[validate] credit notes with target_gst_type NULL (post-A1, should be 0): 0
```

A credit note's own row never carried a vendor GSTIN (`tbl_credit_note` has
no `cost_VendorGSTNo`-equivalent column — confirmed by inspecting its live
`information_schema.COLUMNS`, 39 columns total, none of the ~70
`cost_*`/`eptp_*`/`InvoiceType*` columns `tbl_invoice` has). Its GSTIN, when
derivable, is taken from its A4-matched invoice's own `src_cost_vendorgstno`
— only 49 of the 53 A4-resolved credit notes actually had a valid-looking
GSTIN on that matched invoice (6 Intrastate + 43 Integrated = 49); the other
4 resolved-match credit notes' invoices had a blank/non-GSTIN vendor field
themselves, so they correctly fall to 'Not Applicable' alongside the 91
A4-unresolved rows (91 + 4 = 95).

`target_apply_gst` was set to 1 for every Intrastate/Integrated row and 0
for every 'Not Applicable' row, matching `computeGstType()`'s own contract
(see its fixture tests, `extract.transforms.test.ts`).

## 3. A2 — category default

```
[validate] A2: category defaulted to 'Others' — invoices affected=510, credit notes affected=1
```

Matches the addendum's own investigated figures exactly (510 invoice rows +
1 credit-note row). `normalizeCategory(null)` in `extract.transforms.ts` now
returns `'Others'` instead of `null`, so any future re-run of `extract.ts`
produces the same result at extraction time; this run additionally corrected
the rows already sitting in staging from the pre-addendum extraction.

## 4. A3 — cost_centre_id resolution

Re-checked live (not assumed unchanged from Task 3's report) via a fresh
`cost_centre_master` query (928 rows) joined against every staging row's
`src_cost_center` (trimmed):

```
[validate] A3: cost_centre_id resolved — invoices resolved=10710 unresolved=87, credit notes resolved=144 unresolved=0
```

**87 invoice rows remain genuinely unresolved — identical to Task 3's own
figure**, confirming no concurrent-session drift in `cost_centre_master`
since that report. All 144 credit-note rows resolve cleanly, also unchanged.
`target_cost_centre_id` (new column, migration 1306) now holds the resolved
`cost_centre_master.id` for every resolvable row on both staging tables, so
a later load task no longer has to redo this lookup.

The 87 unresolved invoice rows now carry the fixed, filterable message
`COST_CENTRE_UNRESOLVED_MESSAGE = "cost_centre_id unresolved - needs manual
reconciliation"` (a future manual-reconciliation task can `WHERE
validation_error LIKE '%cost_centre_id unresolved - needs manual
reconciliation%'`), by code:

```
[17] CS/OB/DEL/057   [9] CS/IB/KNL/0125   [8] CS/OB/DEL/0171   [8] CS/OB/DEL/053
 [7] CS/IB/DEL/0140   [7] CS/OB/KNL/034    [5] BSS/IB/NOIDA-DD/1038
 [4] CM/FLD/KNL/037   [3] CM/FLD/KNL/036   [2] SM/BLD/DEL/0189 ... (+ several x1-x2, 2 blank)
```

## 5. A4 — credit_note.invoice_id resolution

`matchCreditNoteInvoice()` (`validate.transforms.ts`) matched every credit
note's `src_proforma_bill_no` against the staged invoices' `src_bill_no`,
requiring an exact single match with agreeing `src_cost_center`:

```
[validate] A4: credit notes -> invoice matching — resolved=53 ambiguous=86 unresolved=5
```

Identical to the addendum's own investigated figures (53 resolved / 86
ambiguous / 5 missing `proforma_bill_no`), with **0 cost-centre
disagreements** among the 53 resolved matches (re-confirmed live, same as
the addendum's own trust signal). `target_invoice_id` (new column, migration
1306) now holds the matched invoice's own `target_id` — the pre-generated
UUID a later load task will actually insert as that invoice's real
`client_invoice.id` — for the 53 resolved rows.

Credit-note error breakdown, post-A4 (91 rows, both messages distinct and
filterable):

```
[86] invoice_id ambiguous - 2 candidate invoices share this bill_no
 [5] invoice_id unresolvable - no proforma_bill_no recorded
```

## 6. Remaining invoice errors (88, down from 2,747)

```
 [87 total across ~19 distinct codes + 2 blank] cost_centre_id unresolved - needs manual reconciliation (A3, see §4)
 [2] finance_year is NULL/blank
 [2] invoice_date is NULL/blank/unrecoverable — design §5.1
 [1] total does not parse as a decimal (raw="8800\r0")
 [1] month_label is NULL/blank
```

(Some rows carry more than one simultaneous issue, e.g. a cost-centre gap
alongside a blank finance_year, which is why the per-message counts above
sum to slightly more than 88 distinct rows — same accounting convention
Task 3's own report used.)

## 7. Test coverage

`extract.transforms.test.ts` (computeGstType, updated normalizeCategory) and
`validate.transforms.test.ts` (buildBranchStateCodeLookup,
resolveBranchStateCode, buildInvoiceBillNoIndex, matchCreditNoteInvoice,
updated validateInvoiceRow/validateCreditNoteRow) — **79 tests, all passing**:

```
 Test Files  2 passed (2)
      Tests  79 passed (79)
```

## 8. What is still open (unchanged by this addendum, by design)

- The 87 A3-unresolved invoice cost-centre codes and the 91 A4-unresolved
  credit notes are **excluded from this cutover pass**, per the addendum's
  own decision — not force-mapped, not silently dropped. They stay
  `validation_status = 'error'` with the distinct, filterable messages above
  for a future manual-reconciliation task.
- `load.ts` (the actual write into `client_invoice`/`client_credit_note`)
  remains out of scope for this task and every task in this plan so far —
  explicitly gated behind separate human sign-off (design §9).
