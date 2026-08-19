# Client Billing — Invoice PDF Design

Status: Approved for planning (user unavailable intermittently, standing authorization to continue the roadmap)
Date: 2026-08-19
Author: Claude (session with shivam.giri@teammas.in)

## 1. Purpose

Fourth phase of the client-billing replica. Legacy's `view_proforma_pdf()` /
`view_pdf()` render a printable proforma/tax-invoice document. This plan
adds the equivalent for the new system: a server-rendered PDF for a
`client_invoice` (either stage — proforma or approved/billed).

No access to the legacy PHP frontend was available this session (only DB
access) to pull a literal reference PDF, so this design is built from two
sources instead: (a) the exact GST/address/HSN fields already confirmed
present on `cost_centre_master` (deep-audited earlier this session), and
(b) the standard mandatory fields for a GST tax invoice under Indian tax
law (invoice number, date, supplier + buyer GSTIN/address, HSN/SAC, taxable
value, CGST/SGST or IGST breakdown, grand total) — the same shape legacy's
own schema already encodes.

## 2. What already exists (reuse, don't rebuild)

- **`pdfkit`** — the established PDF-generation library in this codebase
  (`appointmentLetterPdf.service.ts`, `joiningDocumentPdf.service.ts`,
  others). No new dependency.
- **`client_invoice`/`client_invoice_line`** — already carries every
  financially-binding figure (`total_amount`, `igst_amount`, `cgst_amount`,
  `sgst_amount`, `grand_total`, `gst_type`) frozen at proforma-creation
  time. The PDF reads these directly — never recomputes tax.
- **`cost_centre_master`** — joined live at render time (the foundation
  phase's own explicit deferral: "Presentational fields... can be joined
  live via `cost_centre_id` whenever needed... by the future PDF plan").
  Confirmed columns already present: `bill_to_address1-5`,
  `ship_to_address1-5`, `hsn_code`, `sac_code`, `service_tax_no` (our own
  GST-adjacent registration), `vendor_gst_no`/`vendor_gst_state` (legacy's
  naming for the **client's** GST — confirmed from a live legacy sample:
  `cost_ServiceTaxNo` was MAS Callnet's own GSTIN, `cost_VendorGSTNo` was
  the billed client's), `client_tally_name`, `tally_head`.
- **`branch_master.gst_state_code`** — already used by the numbering
  service; same source for the PDF's supplier-state line.

## 3. Scope decision

One shared renderer, two thin wrappers — matching legacy's two-endpoint
split (`view_proforma_pdf` vs `view_pdf`) without duplicating layout code.
The renderer takes the invoice's actual `invoice_status` and prints
"PROFORMA INVOICE" + `proforma_no` when status is `proforma`, or "TAX
INVOICE" + `bill_no` when `approved`. A `rejected` invoice can still
render (for record-keeping), watermarked "REJECTED" — legacy allowed
viewing a rejected proforma's PDF too (no state-gating on `view_pdf`
beyond auth).

**Credit notes are out of scope for this plan** — same shared renderer
pattern can extend to them later, but keeping this plan sized like the
prior three (one cohesive unit, not a grab-bag).

## 4. Layout (GST tax invoice, single page for typical line counts)

1. **Header**: MAS Callnet company name + our GSTIN (`cost_centre_master.service_tax_no`)
   + our state (`branch_master.gst_state_code` resolved via the invoice's
   `cost_centre_id` → `branch_id`), document title ("PROFORMA INVOICE" /
   "TAX INVOICE" / "TAX INVOICE — REJECTED"), invoice number + date.
2. **Bill To / Ship To**: two columns from `cost_centre_master`'s
   `bill_to_address1-5` / `ship_to_address1-5`, client's GSTIN
   (`vendor_gst_no`)/state (`vendor_gst_state`), client name
   (`client_tally_name` falling back to `cost_centre_master.company_name`
   if blank — matches the `hasAddress`-style graceful-omission pattern
   already used in `branchAddress.service.ts` for exactly this kind of
   missing-data case).
3. **Line items table**: `client_invoice_line` rows — particulars, HSN/SAC
   (`cost_centre_master.hsn_code`/`sac_code`, constant per invoice, not
   per line — legacy has no per-line HSN either), qty, rate, amount.
4. **Tax summary**: taxable total, then either IGST (one line) or
   CGST+SGST (two lines) depending on `client_invoice.gst_type`, then
   grand total — all read directly from the frozen invoice columns, no
   recomputation.
5. **Footer**: "This is a system-generated invoice" note, generation
   timestamp.

## 5. Service

`generateInvoicePdf(invoiceId: string): Promise<Buffer>` — loads the
invoice + lines + a live `cost_centre_master`/`branch_master` join
(reusing the exact join shape already proven in `createProforma`),
renders via `pdfkit` to an in-memory buffer (no filesystem write — this
is a generated-on-request document, not a stored asset, matching
`appointmentLetterPdf.service.ts`'s in-memory pattern), returns the
buffer. Throws `statusCode: 400` if the invoice doesn't exist (matching
every other service in this module).

## 6. Routes

`GET /api/client-billing/proformas/:id/pdf`, `GET
/api/client-billing/invoices/:id/pdf` — both call the same
`generateInvoicePdf`, differ only in which existing list they're
discoverable alongside (proformas vs. approved invoices — the underlying
`client_invoice` row is the same table either way, so both paths resolve
identically; this mirrors legacy's `view_proforma_pdf`/`view_pdf` being
two named entry points to conceptually one document). Sets
`Content-Type: application/pdf` and streams the buffer. Same
`requireAuth`+`requireRole(...ALLOWED_ROLES)` as every other route in
this module — **not** legacy's public/base64-obfuscated-ID access, which
this design deliberately does not replicate (a real auth gate, not
security-by-obscurity).

## 7. Testing discipline

Same standard as the prior three phases: any new SQL (the join query)
gets a live-MySQL verification pass. PDF *rendering* itself is tested by
asserting the returned buffer is non-empty and starts with the PDF magic
bytes (`%PDF-`) — pdfkit's actual layout engine isn't something a unit
test should try to pixel-check; that's what a manual/visual spot-check
is for once real data exists (currently blocked by the same
`branch_master.gst_state_code` gap as every other write path).

## 8. Out of scope

- Credit-note PDFs (separate future extension of the same renderer).
- Digital signature / e-sign on the invoice PDF (legacy has none; the
  appointment-letter DSC/Aadhaar-eSign machinery in this codebase is a
  different, unrelated document class).
- Emailing the PDF to the client — a delivery mechanism, not the
  document itself; not scoped here.

## Self-review

**Placeholder scan**: none. **Internal consistency**: §4's address
fallback matches §2's cited precedent exactly. **Scope check**: one
cohesive renderer + 2 thin routes, sized like the prior phases.
**Ambiguity check**: "HSN/SAC is per-invoice not per-line" stated
explicitly so it can't be misread as an oversight when the line-item
table doesn't have its own HSN column.