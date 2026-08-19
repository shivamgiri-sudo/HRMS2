# Client Billing Cutover — Design Addendum (post-validation-report findings)

Date: 2026-08-19. Supersedes design §5.2 (gst_type) and extends §5 with 3 new
decisions, all made with the user reviewing real data patterns from the
Task 3 validation report.

## A1. gst_type NOT NULL conflict (supersedes §5.2)

`client_invoice.gst_type`/`client_credit_note.gst_type` are `VARCHAR(20)
NOT NULL` with no DEFAULT — §5.2's "migrate as NULL" is not insertable.
Real pattern investigated (not assumed):

- **2,132 of 2,229 blank-GST invoices (95.6%) predate 2017-07-01** — India's
  GST regime start date. These are Service-Tax-era invoices; GST literally
  did not exist when they were created. Not a data-quality issue.
- **A further 15 post-GST rows have `apply_gst=0` explicitly** — deliberate,
  confirmed foreign/export clients (`cost_VendorGSTNo` blank/`'NA'`,
  `cost_statenamecost` naming a foreign country e.g. `'Australiya'`).
- **54 post-GST rows have `apply_gst=1` but blank GSTType** — mixed: some
  are the same foreign-client pattern where `apply_gst` itself looks like a
  data-entry slip; others (`Vodafone Idea Limited`, `Ecom Express Private
  Limited`, `RI Networks Pvt. Ltd.`) have a real, valid-looking Indian GSTIN
  on file (`cost_VendorGSTNo`) — the Integrated/Intrastate split was simply
  never selected in the legacy UI, and is mechanically derivable from the
  GSTIN's 2-digit state-code prefix vs. the branch's own state code, the
  same logic the live system already uses.
- **All 144 credit notes have blank GSTType** — a different pattern
  entirely (none predate GST; 124/144 have `apply_gst=1`). This reads as
  the legacy credit-note screen never having a GST-type field at all, not
  a vendor-specific reason. Same derivation approach applies where a real
  GSTIN is on file.

**Decision**: `computeGstType(row)`:
1. If `cost_VendorGSTNo` matches a real 15-char GSTIN pattern (`^\d{2}[A-Z0-9]{13}$`
   — reuse whatever validator this codebase already has if one exists,
   otherwise this exact regex): derive `Integrated`/`Intrastate` by
   comparing its 2-digit state prefix against the branch's own state code
   (same source `mintBillNumber`/`createProforma` already resolve) —
   `apply_gst = 1`.
2. Otherwise (blank/`NA`/malformed GSTIN, OR pre-GST-era `createdate`, OR
   legacy `apply_gst = 0`): `gst_type = 'Not Applicable'`, `apply_gst = 0`.
   This is a real, honest classification — not a stand-in for NULL — and
   the frontend's `GstBreakdown`/PDF's `drawTaxSummary` already guard on
   `apply_gst` before rendering any tax line, so nothing downstream needs
   to change to handle it correctly.

## A2. category NOT NULL conflict

`category VARCHAR(50) NOT NULL` — blank/NULL legacy category (510 invoice
rows, 1 credit-note row) is not insertable. **Decision**: default to
`'Others'` — already the dominant real category (70%+ of all rows), a
low-stakes reporting/filter field with no financial consequence, not worth
a more elaborate inference.

## A3. cost_centre_id NOT NULL FK — 87 unresolved invoice rows

Re-checked all 87 unresolved `src_cost_center` codes against
`cost_centre_master.cost_centre_code` (928 total rows) — zero exact
matches, zero case/whitespace-fuzzy matches on the sample checked. These
codes do not exist in the live cost-centre master at all (most read as
old/retired branch-cost-centre codes, e.g. `CS/OB/DEL/057` x17). **Decision**:
these 87 rows are **excluded from this cutover pass** and listed in a
separate "needs manual cost-centre reconciliation" appendix — not force-
mapped to an unrelated cost centre, not silently dropped from history
(the staging row stays, just never loads until someone identifies the
correct current cost centre for it).

## A4. credit_note.invoice_id NOT NULL FK — real match rate found

Matching `tbl_credit_note.proforma_bill_no` against staged invoices'
`bill_no`:
- **53 of 144 (36.8%) match exactly one invoice** — validated by checking
  the matched invoice's own `cost_center` against the credit note's own
  `cost_center`: **0 of 53 disagree**, a strong trust signal this matching
  is real, not coincidental.
- **86 (59.7%) match more than one invoice** — the `bill_no` collision bug
  (design §2) makes these genuinely ambiguous; auto-resolving would risk
  linking a credit note to the wrong invoice.
- **5 (3.5%) have no `proforma_bill_no` at all.**

**Decision**: load the 53 resolvable credit notes with their derived
`invoice_id`. The other 91 go into the same manual-reconciliation
appendix as A3's cost-centre gap — a real, disclosed gap for Finance to
close, not a silent drop and not a forced guess.