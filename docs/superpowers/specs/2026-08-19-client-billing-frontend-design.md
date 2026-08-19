# Client Billing — Frontend Workspace Design

Status: Approved for planning (user unavailable intermittently, standing authorization to continue the roadmap)
Date: 2026-08-19
Author: Claude (session with shivam.giri@teammas.in)

## 1. Purpose

Fifth phase of the client-billing replica, and the first frontend one — every
prior phase (foundation, approval-workflow, credit-notes, PDF) is backend-only.
This adds one workspace page that lets Finance staff create, list, approve/
reject, and download invoices and credit notes through the already-live
`/api/client-billing/*` routes, replacing legacy's PHP-rendered
`InitialInvoicesController` screens.

## 2. What already exists (reuse, don't rebuild)

- **API surface**: every endpoint this page needs already exists and is
  tested — `POST/GET /api/client-billing/proformas[/:id]`,
  `POST /api/client-billing/invoices/:id/{approve,reject}`,
  `GET /api/client-billing/invoices/:id/audit-log`,
  `POST /api/client-billing/credit-notes`,
  `POST /api/client-billing/credit-notes/:id/approve`,
  `GET /api/client-billing/credit-notes[/:id]`,
  `GET /api/client-billing/{proformas,invoices}/:id/pdf`.
- **Route + gate convention**: `src/config/routes/finance.routes.tsx` — every
  finance route is `<ProtectedRoute roles={...}><Gate pageCode="..."><Page />
  </Gate></ProtectedRoute>`, page lazy-loaded via `lazy()`. `roles={...}` on
  `ProtectedRoute` is a first pass; the real per-role gate is
  `WorkforcePageGate`'s `canViewPage(pageCode)`, which reads
  `role_page_access` (joined to `page_catalog`) through `useWorkforceAccess`
  — **a page is invisible to every role except `super_admin` until a
  `role_page_access` row exists for it** (confirmed live precedent:
  `FINANCE_COST_CENTRES` shipped with a route/pageCode and zero grant rows,
  and was "silently invisible" — migration `1066_billability_page_access.sql`
  is both the cautionary tale and the fix template this plan follows).
- **Page pattern**: `VendorPaymentDispatchPage.tsx` (823 lines) is the
  closest precedent — single cohesive page, tabs/filters, React Query
  (`useQuery`/`useMutation`/`useQueryClient`), `hrmsApi` client,
  `DashboardLayout` wrapper, a `Sheet`-based create/action panel
  (`PaymentDispatchSheet.tsx`), shadcn `Table`/`Badge`/`Select`/`Button`,
  `useToast`. This page follows the same shape rather than inventing a new
  one.
- **`hrmsApi`**: `hrmsApi.get<T>(path)` / `hrmsApi.post<T>(path, body)` —
  already handles auth headers and the response envelope; no new HTTP client.

## 3. Scope

One page, one route: `/finance/client-billing`, gated by a new pageCode
`FINANCE_CLIENT_BILLING`. Three tabs on one page (not three routes — matches
the single-cohesive-page precedent, avoids tripling the route/gate
boilerplate for what is really one workflow with three views):

1. **Proformas** — list (status filter: draft/pending), create (Sheet form:
   cost centre picker, finance year, month label, category, line items,
   apply-GST toggle), view PDF, approve/reject (reject requires a reason,
   matching the backend's `rejectInvoice` contract).
2. **Invoices** — approved invoices (post-approval `bill_no` assigned), list,
   view PDF, audit log viewer (reads `GET .../audit-log`).
3. **Credit Notes** — list, create (Sheet form: pick an approved invoice by
   its `bill_no`/id, line items), approve.

Role scope for the page grant mirrors the backend's `ALLOWED_ROLES` exactly
— `admin`, `finance`, `finance_head`, `accounts_head` — so the frontend
gate never shows a page the API would 403 on, and never hides one the API
would allow (parity was flagged as a real defect class in the billability
migration's own comment; not repeating it here).

## 4. Data layer

`src/lib/clientBillingApi.ts` — thin wrapper functions over `hrmsApi`
(`listProformas`, `getProforma`, `createProforma`, `approveInvoice`,
`rejectInvoice`, `getAuditLog`, `listCreditNotes`, `createCreditNote`,
`approveCreditNote`) plus a `pdfUrl(kind, id)` helper building the download
URL — matching this codebase's existing "thin API module + React Query
hooks in the page" convention (no separate hooks file needed at this scope,
per `VendorPaymentDispatchPage.tsx`'s own precedent of calling
`useQuery`/`useMutation` directly in the page body).

PDF download: since these routes require an `Authorization` header (not a
plain public link), a bare `<a href>` cannot hit them directly. `hrmsApi`
already has exactly this helper — `hrmsApi.getBlob(path): Promise<Blob>`
(`src/lib/hrmsApi.ts`, auth headers included, already used elsewhere in
this codebase for authenticated file downloads). Call it, then trigger a
browser download via `URL.createObjectURL`/`link.click()`/
`URL.revokeObjectURL`, the same three-line pattern already used for CSV
export elsewhere in this codebase (e.g. `Payroll.tsx`'s CSV export) — no
new download helper needed.

## 5. Money/GST display

Every amount already exists as a plain `DECIMAL` from the API — the
frontend only formats (`Rs. `/`₹` prefix, 2 decimals), never computes GST
or totals itself. `gst_type` (`Integrated`/`Intrastate`) drives whether the
UI shows one IGST line or a CGST+SGST pair, mirroring the PDF's own
`drawTaxSummary` logic exactly (same source data, same branching, just
rendered as HTML instead of a PDF stream).

## 6. Out of scope

- Historical cutover UI (a separate, later plan — this page only shows
  whatever's created going forward).
- Editing an already-created proforma line-by-line (legacy doesn't have
  this either — a wrong proforma is rejected and recreated, not edited).
- Bulk actions (bulk-approve, bulk-export) — no such capability exists on
  the backend yet; not inventing a frontend affordance for it.

## Self-review

**Placeholder scan**: none. **Internal consistency**: §3's role list is
stated once and cross-checked against §2's backend `ALLOWED_ROLES`
precedent. **Scope check**: one page, one route, one migration — sized
like the prior phases. **Ambiguity check**: explicitly named the
`FINANCE_COST_CENTRES` invisible-page precedent so the grant migration
isn't skipped as "optional polish."