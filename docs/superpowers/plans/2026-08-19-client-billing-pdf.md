# Client Billing PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a printable GST invoice PDF for any `client_invoice` (proforma or approved), replacing legacy's `view_proforma_pdf()`/`view_pdf()`, via a real auth-gated endpoint instead of legacy's obfuscated-ID public access.

**Architecture:** One shared render function, two thin GET routes. No new tables — the invoice's own frozen tax columns plus a live join to `cost_centre_master`/`branch_master` (already the established pattern for presentational fields, deferred to this exact plan by the foundation design) supply everything the document needs.

**Tech Stack:** Express + TypeScript, mysql2, vitest, MySQL 8 (`mas_hrms`), `pdfkit` (already a dependency — see `backend/src/modules/letters/appointmentLetterPdf.service.ts` for the established usage convention).

## Global Constraints

- Reuse `ALLOWED_ROLES` already exported/used in `client-billing.routes.ts` (`admin`, `finance`, `finance_head`, `accounts_head`) — every route: `requireAuth` + `requireRole(...ALLOWED_ROLES)`.
- GET routes only — this plan is pure read + render, no state change, no new migration.
- Errors: `throw Object.assign(new Error("message"), { statusCode: 400 })` for a missing/invalid invoice id — matches every other service in this module.
- DB access: a plain pool-level `db.execute`/`db.query` is correct here (no transaction needed — this is read-only). Do not use `db.getConnection()` for a read-only render.
- Never recompute tax — read `total_amount`/`igst_amount`/`cgst_amount`/`sgst_amount`/`grand_total`/`gst_type` directly off the `client_invoice` row exactly as `approveInvoice`/`createProforma` wrote them.
- **Verify the new join query against a real MySQL 8 connection before considering a task done** — not only the mocked test suite. Connection: host `192.168.10.6` (fallback `122.184.128.90`), port `3306`, user `shivam_user`, password **read from `backend/.env`'s `DB_PASSWORD` — never paste the literal value into any file that will be committed**. Database `mas_hrms`. Never write to any real (non-throwaway, non-`x_`-prefixed) table — this plan is read-only by design so this should be trivially satisfied, but the constraint still applies to any diagnostic scratch queries.
- `pdfkit` usage must follow `appointmentLetterPdf.service.ts`'s established shape: build the document into an in-memory buffer via a `PDFDocument` + collecting `data` chunks on `end`, no filesystem write, no `pdf-lib` (not needed — no signature/post-processing step for an invoice).
- This repo has many concurrent sessions editing the same files. Before editing `client-billing.routes.ts`, `git fetch`/re-read the live file content rather than trusting a stale local copy (this exact file has been touched by 3 prior tasks this session).

---

## File Structure

- `backend/src/modules/client-billing/client-billing-pdf.service.ts` — new, `generateInvoicePdf(invoiceId)`.
- `backend/src/modules/client-billing/__tests__/client-billing-pdf.service.test.ts` — new.
- `backend/src/modules/client-billing/client-billing.routes.ts` — modified, 2 new GET routes.
- `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts` — modified.

---

### Task 1: PDF render service

**Files:**
- Create: `backend/src/modules/client-billing/client-billing-pdf.service.ts`
- Create: `backend/src/modules/client-billing/__tests__/client-billing-pdf.service.test.ts`

**Interfaces:**
- Produces: `generateInvoicePdf(invoiceId: string): Promise<Buffer>` — Task 2 imports this directly and streams its return value as the HTTP response body.

- [ ] **Step 1: Confirm the live join shape**

Read `client-billing.service.ts`'s `createProforma` to find its exact
`cost_centre_master`/`branch_master` join (columns and join keys already
proven correct there — reuse verbatim, don't re-derive). Confirm live
against MySQL that `cost_centre_master.bill_to_address1..5`,
`ship_to_address1..5`, `hsn_code`, `sac_code`, `service_tax_no`,
`vendor_gst_no`, `vendor_gst_state`, `client_tally_name`, `company_name`
and `branch_master.gst_state_code` are the real column names (PREPARE
the SELECT against the live connection — do not trust the design doc's
column list without checking, schema drift has bitten this exact area
before, see the `hrms2-phantom-column-sweep` discipline).

- [ ] **Step 2: Write `generateInvoicePdf`**

```typescript
import PDFDocument from "pdfkit";
import { db } from "../../db"; // match this module's existing import path/shape
import type { RowDataPacket } from "mysql2";

export async function generateInvoicePdf(invoiceId: string): Promise<Buffer> {
  const [invoiceRows] = await db.execute<RowDataPacket[]>(
    `SELECT ci.*, cc.bill_to_address1, cc.bill_to_address2, cc.bill_to_address3,
            cc.bill_to_address4, cc.bill_to_address5, cc.ship_to_address1,
            cc.ship_to_address2, cc.ship_to_address3, cc.ship_to_address4,
            cc.ship_to_address5, cc.hsn_code, cc.sac_code, cc.service_tax_no,
            cc.vendor_gst_no, cc.vendor_gst_state, cc.client_tally_name,
            cc.company_name, b.gst_state_code AS our_state_code
     FROM client_invoice ci
     JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     LEFT JOIN branch_master b ON b.id = cc.branch_id
     WHERE ci.id = ?`,
    [invoiceId]
  );
  if (!invoiceRows.length) {
    throw Object.assign(new Error("Invoice not found"), { statusCode: 400 });
  }
  const invoice = invoiceRows[0];

  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT particulars, qty, rate, amount FROM client_invoice_line WHERE invoice_id = ? ORDER BY id`,
    [invoiceId]
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const title =
      invoice.invoice_status === "proforma"
        ? "PROFORMA INVOICE"
        : invoice.invoice_status === "rejected"
        ? "TAX INVOICE — REJECTED"
        : "TAX INVOICE";
    const number = invoice.invoice_status === "proforma" ? invoice.proforma_no : invoice.bill_no;

    doc.fontSize(16).text("MAS Callnet", { align: "left" });
    doc.fontSize(10).text(`GSTIN: ${invoice.service_tax_no || "-"}`);
    doc.moveDown();
    doc.fontSize(14).text(title, { align: "center" });
    doc.fontSize(10).text(`Invoice No: ${number || "-"}`);
    doc.text(`Date: ${invoice.credit_date || invoice.created_at || "-"}`);
    doc.moveDown();

    const billName = invoice.client_tally_name || invoice.company_name || "-";
    doc.fontSize(11).text("Bill To:");
    doc.fontSize(10).text(billName);
    [1, 2, 3, 4, 5].forEach((n) => {
      const line = invoice[`bill_to_address${n}`];
      if (line) doc.text(line);
    });
    if (invoice.vendor_gst_no) doc.text(`GSTIN: ${invoice.vendor_gst_no}`);
    doc.moveDown();

    doc.fontSize(11).text("Particulars", 40, doc.y, { continued: true });
    doc.text("Qty", 280, doc.y, { continued: true });
    doc.text("Rate", 340, doc.y, { continued: true });
    doc.text("Amount", 420, doc.y);
    doc.moveDown(0.5);
    for (const line of lineRows) {
      doc.fontSize(10).text(String(line.particulars ?? ""), 40, doc.y, { continued: true });
      doc.text(String(line.qty ?? ""), 280, doc.y, { continued: true });
      doc.text(String(line.rate ?? ""), 340, doc.y, { continued: true });
      doc.text(String(line.amount ?? ""), 420, doc.y);
    }
    doc.moveDown();

    doc.text(`Taxable Value: ${invoice.total_amount}`);
    if (invoice.gst_type === "integrated") {
      doc.text(`IGST: ${invoice.igst_amount}`);
    } else {
      doc.text(`CGST: ${invoice.cgst_amount}`);
      doc.text(`SGST: ${invoice.sgst_amount}`);
    }
    doc.fontSize(12).text(`Grand Total: ${invoice.grand_total}`);
    doc.moveDown();
    doc.fontSize(8).text("This is a system-generated invoice.", { align: "center" });

    doc.end();
  });
}
```

Adjust column/field names to whatever Step 1 confirms live (the sketch
above is a starting shape, not gospel — schema drift is common in this
repo). Confirm the actual date column used for "Date:" — likely
`invoice.created_at` for a proforma and `invoice.approved_at` for a
billed invoice; check `client_invoice`'s real columns rather than
guessing (`credit_date` above is almost certainly wrong — it's a
credit-note column, not an invoice column; this is a placeholder to be
corrected against the live schema, not a literal instruction).

- [ ] **Step 3: Unit tests**

Mock `db.execute` (matching this module's existing test mocking
convention — check `client-billing.service.test.ts` for the exact
mock shape). Cases: (a) unknown invoice id → rejects with
`statusCode: 400`; (b) known proforma invoice → resolves to a
`Buffer` whose first 5 bytes are the ASCII string `%PDF-` (pdfkit's
real output starts with `%PDF-1.x`); (c) known approved invoice with
`gst_type = 'intrastate'` → same buffer-shape assertion (don't try to
parse PDF internals in a unit test — assert the magic bytes and that
it's non-trivially sized, e.g. `> 500` bytes).

- [ ] **Step 4: Live verification**

PREPARE the Step 1 SELECT against the real MySQL connection (see
Global Constraints) to confirm every referenced column actually
exists and the join doesn't throw `ER_CANT_AGGREGATE_2COLLATIONS` or
similar. Record the exact command and output in the task report —
"looks structurally correct" is not sufficient, per this session's
standing verification discipline.

**Definition of Done:** `generateInvoicePdf` returns a real PDF buffer
for both a proforma-status and an approved-status invoice row (test
fixtures), throws a clean 400 for an unknown id, and the live SELECT
has been PREPARE-verified against real MySQL with the output pasted
into the task report.

---

### Task 2: Routes + wiring

**Files:**
- Modify: `backend/src/modules/client-billing/client-billing.routes.ts`
- Modify: `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts`

**Interfaces:**
- Consumes: `generateInvoicePdf` from Task 1.
- Produces: `GET /api/client-billing/proformas/:id/pdf`, `GET /api/client-billing/invoices/:id/pdf`.

- [ ] **Step 1: Re-read the live file first**

`git fetch` and diff `client-billing.routes.ts` against
`origin/main` before editing — this file has been touched by every
prior task in this module; do not start from a stale local copy.

- [ ] **Step 2: Add the two routes**

```typescript
router.get(
  "/proformas/:id/pdf",
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  h(async (req, res) => {
    const pdf = await generateInvoicePdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);

router.get(
  "/invoices/:id/pdf",
  requireAuth,
  requireRole(...ALLOWED_ROLES),
  h(async (req, res) => {
    const pdf = await generateInvoicePdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);
```

Match this file's actual existing `h()`/route-registration idiom
exactly (check how the existing `GET /proformas/:id` route is written
immediately above and mirror it precisely — including whatever param
validation, if any, it already does for `:id`).

- [ ] **Step 3: Route tests**

Cases: (a) no auth → 401; (b) wrong role → 403; (c) valid role +
unknown id → 400 with the service's error message; (d) valid role +
known id → 200, `Content-Type: application/pdf`, body starts with
`%PDF-`. Mock `generateInvoicePdf` at the module boundary (matching
how this test file already mocks the other service functions it
imports from sibling services) rather than re-mocking `db.execute`
here — that's already covered by Task 1's own test file.

- [ ] **Step 4: Full suite + live smoke**

Run the full existing test suite for this module (not a narrow
tsconfig subset — see the standing note about this backend's
typecheck orphans) and confirm nothing else broke. If a demo-token
dev server is reachable, `curl` both new endpoints with a demo token
against a real (even if empty-result) invoice id and confirm the
auth/role gates actually fire as expected — don't rely solely on the
mocked test suite for the auth-boundary claim.

**Definition of Done:** Both routes exist, return a real
`application/pdf` body for a valid id, 400 for an unknown id, 401/403
for missing/insufficient auth, full test suite green, live curl smoke
confirms the auth gate.

---

## Final Review Checklist (for the reviewer subagent)

- No new migration was needed for this plan — confirm neither task
  introduced one (this plan is deliberately read-only).
- Confirm Task 1's SELECT was actually PREPARE-verified against live
  MySQL, not just asserted as "structurally correct" (this exact gap
  was caught in the credit-notes phase's Task 2 review — don't let it
  recur here).
- Confirm no tax figure is recomputed anywhere in the PDF service —
  every dollar figure must trace directly to a `client_invoice` column
  already written by `createProforma`/`approveInvoice`.
- Confirm the two routes use the existing `ALLOWED_ROLES` constant,
  not a newly-declared duplicate list.
- Confirm `git fetch`+diff was actually done before editing
  `client-billing.routes.ts` (a shared, frequently-touched file) and
  that the final pushed version doesn't clobber anything another
  concurrent session added to that file since this plan started.