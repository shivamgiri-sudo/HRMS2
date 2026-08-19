# Client Billing Historical Cutover — Design Addendum-2 Results (credit-note invoice matching, cost_centre disambiguation)

Date: 2026-08-19
Author: Claude (addendum-2 implementer subagent)
Source: real run against live `mas_hrms` `client_invoice_migration_staging`
(10,797 rows) and `client_credit_note_migration_staging` (144 rows) — same
tables as `2026-08-19-client-billing-cutover-addendum-results.md` (A1-A4).
This file is a companion, not a replacement — it records only what changed by
extending A4's credit-note → invoice matching with a second join column.

## 0. What changed

`matchCreditNoteInvoice()` (`backend/scripts/client-billing-cutover/validate.transforms.ts`)
previously matched a credit note to an invoice on `src_proforma_bill_no =
inv.src_bill_no` alone. `bill_no` is not unique in the legacy data (design
§2), so 86 of the 144 credit notes came out "ambiguous" (multiple candidate
invoices sharing the same bill_no) even though the addendum-1 report's own
trust signal (cost-centre agreement, 0 disagreements among the 53 clean
matches) was sitting right there unused as a tie-breaker.

The join now also requires the candidate invoice's own `src_cost_center` to
agree with the credit note's. Verified live, independently, two ways before
touching any code:

```
bill_no-only unique-match count (should be 53): 53
bill_no + cost_center unique-match count (expect 139): 139
still-ambiguous count after cost_center filter (expect 0): 0
no proforma_bill_no at all (expect 5): 5
```

All 86 previously-ambiguous rows resolve to exactly one invoice each once the
cost_center filter is applied — none remain ambiguous.

The remaining 5 credit notes carry no `proforma_bill_no` at all and were
explicitly NOT force-matched. A last-resort `cost_center + finance_year +
total_amount` match was tried against them and still returned 2-5 candidate
invoices each for every one — not safely resolvable, so they stay
`validation_status = 'error'` with their existing
`invoice_id unresolvable - no proforma_bill_no recorded` message.

## 1. Hard constraint — unchanged throughout

`client_invoice`, `client_invoice_line`, `client_credit_note`, and
`client_credit_note_line` were 0 rows before this work and 0 rows after:

```
BEFORE: { client_invoice: 0, client_invoice_line: 0, client_credit_note: 0, client_credit_note_line: 0 }
AFTER:  { client_invoice: 0, client_invoice_line: 0, client_credit_note: 0, client_credit_note_line: 0 }
unchanged check: client_invoice MATCH, client_invoice_line MATCH, client_credit_note MATCH, client_credit_note_line MATCH
```

This script writes only to `client_credit_note_migration_staging`'s own
columns (`target_invoice_id`, `validation_status`, `validation_error`) —
never to `client_invoice`, `client_invoice_line`, `client_credit_note`, or
`client_credit_note_line`.

## 2. Before / after — credit-note validation_status

| | Total | Before (A1-A4, addendum-1) valid | Before error | After (addendum-2) valid | After error |
|---|---|---|---|---|---|
| **Credit notes** | 144 | 53 (36.8%) | 91 | **139 (96.5%)** | **5 (3.5%)** |
| **Invoices** (unchanged by this fix, restated for completeness) | 10,797 | 10,709 (99.2%) | 88 | **10,709 (99.2%)** | **88** |

Real numbers, exactly matching the expected 53→139 / 91→5:

```
[finish] credit notes re-validated: total=144 valid=139 error=5
[finish] match breakdown: resolved=139 ambiguous=0 unresolved=5
[finish] error message breakdown:
  [5] invoice_id unresolvable - no proforma_bill_no recorded
[finish] set-based cross-check: valid=139 error=5 MATCH
[finish] invoice staging (untouched by this fix, restated for completeness): valid=10709 error=88
```

The invoice side is untouched by this fix (only credit-note matching
changed) — its 10,709/88 split is identical to the addendum-1 report and is
restated here only for completeness, not re-derived.

## 3. The 5 unresolved rows — confirmed still correctly flagged, not force-matched

```
[finish] rows with target_invoice_id IS NULL (expect 5): 5
  src_id=46 status=error target_invoice_id=null error=invoice_id unresolvable - no proforma_bill_no recorded
  src_id=47 status=error target_invoice_id=null error=invoice_id unresolvable - no proforma_bill_no recorded
  src_id=48 status=error target_invoice_id=null error=invoice_id unresolvable - no proforma_bill_no recorded
  src_id=53 status=error target_invoice_id=null error=invoice_id unresolvable - no proforma_bill_no recorded
  src_id=56 status=error target_invoice_id=null error=invoice_id unresolvable - no proforma_bill_no recorded
```

These 5 have no `proforma_bill_no` recorded at all in the legacy data —
there is nothing for either the bill_no-only or the bill_no+cost_center join
to key on, so they correctly stay `validation_status = 'error'` rather than
being guessed at.

## 4. Independent cross-check method

Two independent methods were used and made to agree, per this codebase's own
validation discipline:

1. **Per-row TypeScript**: `matchCreditNoteInvoice()` (updated join logic) →
   `validateCreditNoteRow()`, run once per staging row.
2. **Set-based SQL**: a standalone `SELECT ... JOIN ... GROUP BY cn.id HAVING
   COUNT(DISTINCT inv.target_id) = 1` query added to `validate.ts` right
   after the A4 per-row loop, independent of the TypeScript matching code
   path.

```
[validate] A4: credit notes -> invoice matching — resolved=139 ambiguous=0 unresolved=5
[validate] A4 SQL cross-check (independent, bill_no+cost_center join): resolved=139 ambiguous=0 unresolved(no proforma_bill_no)=5 MATCH
```

Both methods landed on identical numbers.

## 5. Test coverage

`validate.transforms.test.ts` was extended with fixture-based tests for the
two-column join condition:

- resolves cleanly when multiple invoices share the bill_no but only one has
  an agreeing cost centre (the addendum-2 fix's core scenario)
- still ambiguous when more than one invoice shares BOTH the bill_no and the
  cost centre (a genuine collision on both columns)
- ambiguous when the bill_no matches several invoices but none of their cost
  centres agree with the credit note's
- the pre-existing "ambiguous when >1 invoice shares the bill_no" test was
  updated in place — it used exactly the fixture addendum-2 disambiguates,
  so it now asserts the correct "resolved" outcome instead of the
  superseded "ambiguous" one.

```
Test Files  3 passed (3)
     Tests  97 passed (97)
```

(All 3 test files in `backend/scripts/client-billing-cutover/__tests__/` —
`extract.transforms.test.ts`, `validate.transforms.test.ts`,
`load.test.ts` — pure fixture-based, no live DB connection.)

## 6. Operational note — this run was completed in two passes

The full `validate.ts` script (which re-validates both staging tables
end-to-end, ~10,941 rows total via sequential per-row UPDATEs) was started
but killed mid-run by this shared machine's background-process starving
before it reached the credit-note per-row loop (which runs after the much
larger invoice loop). Its own stdout up to the point it was killed already
showed the committed, cross-checked A4 numbers (`resolved=139 ambiguous=0
unresolved=5`, SQL cross-check `MATCH`) — those come from `UPDATE`
statements that had already executed and committed, unaffected by the
process dying later during the invoice loop.

A second, narrowly-scoped script (re-using the exact same
`validate.transforms.ts` functions, no logic duplicated or reimplemented)
then finished only the one remaining step — writing
`validation_status`/`validation_error` onto the 144 credit-note rows — and
is what produced the final numbers in §2 above. The invoice side's
`validation_status` was never touched by this fix (invoice validation logic
is unchanged) and still holds the addendum-1 run's 10,709/88 split,
confirmed by direct query.

## 7. What is still open (unchanged by this addendum, by design)

- The 87 A3-unresolved invoice cost-centre codes remain excluded from this
  cutover pass, per the original addendum's decision — unaffected by this
  fix.
- The 5 credit notes with no recorded `proforma_bill_no` remain excluded —
  tested against a last-resort `cost_center + finance_year + total_amount`
  match and found not safely resolvable (2-5 candidates each); not
  force-matched.
- `load.ts` (the actual write into `client_invoice`/`client_credit_note`)
  remains out of scope for this task and every task in this plan so far —
  explicitly gated behind separate human sign-off (design §9).
