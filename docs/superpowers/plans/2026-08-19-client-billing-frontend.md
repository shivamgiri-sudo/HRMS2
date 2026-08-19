# Client Billing Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One workspace page (`/finance/client-billing`) letting Finance staff create/list/approve/reject proformas, view/download invoice PDFs, and manage credit notes through the already-live `/api/client-billing/*` backend.

**Architecture:** A single React page with 3 tabs (Proformas / Invoices / Credit Notes), following `VendorPaymentDispatchPage.tsx`'s established shape (React Query + `hrmsApi` + `Sheet`-based create forms + shadcn `Table`). Gated by a new `FINANCE_CLIENT_BILLING` pageCode, granted via a migration modeled on `1066_billability_page_access.sql`.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + shadcn/Radix, `@tanstack/react-query`, `hrmsApi` (`src/lib/hrmsApi.ts`), React Router (`src/config/routes/finance.routes.tsx`), vitest + React Testing Library.

## Global Constraints

- Read `docs/superpowers/specs/2026-08-19-client-billing-frontend-design.md` in full before starting — this plan implements it.
- Per CLAUDE.md's mandatory UI/UX workflow, before writing any new component/page, run:
  `"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "<what you're building>" --domain ux --stack shadcn`
  for the specific component you're about to write (table, form, tabs, status badge) and follow its Do/Don't guidance.
- No new HTTP client — use `hrmsApi.get/post/getBlob` (`src/lib/hrmsApi.ts`) exclusively.
- No new download helper — `hrmsApi.getBlob(path)` + `URL.createObjectURL`/`link.click()`/`URL.revokeObjectURL` (see `Payroll.tsx`'s CSV export for the exact 3-line pattern).
- Role grant for the new pageCode must exactly match the backend's `ALLOWED_ROLES` in `backend/src/modules/client-billing/client-billing.routes.ts` (`admin`, `finance`, `finance_head`, `accounts_head`) — re-read that file to confirm the current list before writing the migration, don't trust this plan's paraphrase if the file has since changed.
- Every money value comes from the API response verbatim — the frontend formats, never computes, GST or totals.
- **This repo has many concurrent sessions.** Before editing `src/config/routes/finance.routes.tsx` (a shared, frequently-touched file), re-fetch its current content from `origin/main` via `gh api repos/shivamgiri-sudo/HRMS2/contents/src/config/routes/finance.routes.tsx?ref=main --jq .content | base64 -d` and diff against your local copy before editing.
- `git push`/`git fetch` hang indefinitely in this environment — never use them. Use the GitHub REST API blob/tree/commit/ref-update method via `gh api` against `shivamgiri-sudo/HRMS2` for every commit (re-fetch `refs/heads/main` immediately before building each tree, PATCH without `force`, retry-on-409 by refetching).
- Never paste the literal `DB_PASSWORD` value into any committed file.
- After writing each new/changed file to its real repo path, keep a backup copy in a scratch location in case this repo's shared working tree drops it before you build your git blob (a real, confirmed occurrence this session) — read from whichever copy is intact when building the blob.
- Migration file numbered `NNN_description.sql` under `backend/sql/migrations/` — check both `ls backend/sql/migrations/*.sql | grep -oE '[0-9]+' | sort -n | tail -3` and `ls backend/sql/*.sql | grep -oE '^[0-9]+' | sort -n | tail -3` immediately before picking a number (this repo's migration numbers have collided before).
- Migration registered in BOTH `backend/src/db/runPendingMigrations.ts`'s `MIGRATION_MANIFEST` array AND the regenerated lock file (`node backend/scripts/update-migration-lock.mjs --write`).

---

## File Structure

- `backend/sql/migrations/NNNN_client_billing_page_access.sql` — new, grants `FINANCE_CLIENT_BILLING` pageCode.
- `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json` — modified.
- `src/lib/clientBillingApi.ts` — new, thin `hrmsApi` wrapper functions.
- `src/config/routes/finance.routes.tsx` — modified, 1 new lazy import + 1 new route.
- `src/pages/finance/ClientBillingWorkspacePage.tsx` — new, the main page.
- `src/components/finance/client-billing/` — new directory for any sub-components the page needs (create-proforma sheet, create-credit-note sheet, reject-reason dialog) if the page grows past what's comfortable in one file — implementer's judgment, matching how `PaymentDispatchSheet.tsx` was split out of `VendorPaymentDispatchPage.tsx`.
- `src/pages/finance/__tests__/ClientBillingWorkspacePage.test.tsx` — new.

---

### Task 1: RBAC grant + API client + route wiring

**Files:**
- Create: `backend/sql/migrations/NNNN_client_billing_page_access.sql` (verify number free first)
- Modify: `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json`
- Create: `src/lib/clientBillingApi.ts`
- Modify: `src/config/routes/finance.routes.tsx`

**Interfaces:**
- Produces: `role_page_access` rows for `FINANCE_CLIENT_BILLING` (view/create/edit, no delete — matches the billability template's `can_delete` reservation), route `/finance/client-billing`, and the exported functions from `clientBillingApi.ts` that Task 2 imports directly: `listProformas(status?)`, `getProforma(id)`, `createProforma(payload)`, `approveInvoice(id)`, `rejectInvoice(id, reason)`, `getAuditLog(id)`, `listCreditNotes()`, `getCreditNote(id)`, `createCreditNote(payload)`, `approveCreditNote(id)`, `downloadInvoicePdf(kind: "proforma" | "invoice", id, filename)` (the last one performs the `getBlob` + object-URL download side effect directly, matching this codebase's convention of a self-contained download function rather than returning a blob for the caller to handle).

- [ ] **Step 1: Verify the migration number is free**, then write the migration modeled exactly on `backend/sql/1066_billability_page_access.sql`'s structure (`page_catalog` INSERT...ON DUPLICATE KEY UPDATE, `role_page_access` INSERT...ON DUPLICATE KEY UPDATE, wrapped in `START TRANSACTION`/`COMMIT`, a rollback comment at the bottom). `page_code = 'FINANCE_CLIENT_BILLING'`, `page_path = '/finance/client-billing'`, `module = 'finance'`. Grant rows: re-read `client-billing.routes.ts`'s current `ALLOWED_ROLES` first, then one row per role with `can_view=1, can_create=1, can_edit=1, can_delete=0, can_export=1, active_status=1`.

- [ ] **Step 2: Register the migration** in `runPendingMigrations.ts`'s `MIGRATION_MANIFEST` array and regenerate the lock file.

- [ ] **Step 3: Verify the migration live** — PREPARE-check the two INSERT statements' target tables/columns exist as expected (`page_catalog`, `role_page_access`) against the real MySQL connection (see the credit-notes/PDF plans for the exact connection details — host `192.168.10.6`, user `shivam_user`, password from `backend/.env`'s `DB_PASSWORD`, database `mas_hrms`, read-only unless explicitly registering the migration as approved). Do not apply the migration to production yourself — registration only, matching this session's standing rule; flag it as ready-to-apply in your report.

- [ ] **Step 4: Write `src/lib/clientBillingApi.ts`** — thin functions wrapping `hrmsApi.get/post/getBlob`, one per Task 1's Interfaces list above. TypeScript interfaces for the response shapes (proforma/invoice row, credit note row, line item) — check the backend service files (`client-billing.service.ts`, `client-billing-credit-note.service.ts`) for the actual field names returned rather than guessing.

- [ ] **Step 5: Wire the route** — re-fetch `finance.routes.tsx` from `origin/main` first (Global Constraints), add `const ClientBillingWorkspacePage = lazy(() => import("@/pages/finance/ClientBillingWorkspacePage"));` and `<Route path="/finance/client-billing" element={<ProtectedRoute roles={[...]}><Gate pageCode="FINANCE_CLIENT_BILLING"><ClientBillingWorkspacePage /></Gate></ProtectedRoute>} />` using the same role list as the migration's grants, in the `{/* Finance */}` section alongside the other finance routes.

**Definition of Done:** migration registered (not applied) and PREPARE-verified live, `clientBillingApi.ts` exports all listed functions with real backend-matching TypeScript shapes, route added and building cleanly (`npm run build` or the frontend's typecheck — check which one is actually reliable per this repo's own noted `npm run typecheck` gap, and use `tsc --noEmit` scoped to the changed files if the root command is known-broken).

---

### Task 2: Workspace page UI

**Files:**
- Create: `src/pages/finance/ClientBillingWorkspacePage.tsx` (+ any split-out sub-components under `src/components/finance/client-billing/` at implementer's judgment)

**Interfaces:**
- Consumes: everything from Task 1's `clientBillingApi.ts`.
- Produces: the page component Task 1's route imports (already wired — this task fills in what was a stub or, if done in dependency order, the actual first version).

- [ ] **Step 1: Run the UI/UX Pro Max search** for "tabs data table financial document status badge" and "sheet form create record" per Global Constraints, before writing markup.

- [ ] **Step 2: Page shell** — `DashboardLayout` wrapper, page title, 3-tab layout (`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from shadcn) for Proformas / Invoices / Credit Notes, matching `VendorPaymentDispatchPage.tsx`'s overall structure (header, filters, table, action sheet).

- [ ] **Step 3: Proformas tab** — `useQuery` list (status filter dropdown), shadcn `Table` with columns (proforma no, cost centre/client name, category, month, gst_type, grand_total, status badge, actions), a "New Proforma" button opening a `Sheet` create form (cost centre picker — reuse whatever existing cost-centre-select component this codebase already has, check `CostCentreManagementPage.tsx` or similar for a reusable picker before building a new one — finance year, month label, category, GST toggle, line items add/remove rows), row actions: View PDF (calls `downloadInvoicePdf`), Approve (`useMutation` → `approveInvoice`, confirm dialog), Reject (opens a reason dialog, `useMutation` → `rejectInvoice`).

- [ ] **Step 4: Invoices tab** — list of `invoice_status='approved'` rows (bill_no, same money columns), View PDF, "Audit Log" action opening a dialog/sheet listing `getAuditLog(id)` entries.

- [ ] **Step 5: Credit Notes tab** — list, "New Credit Note" Sheet (pick an approved invoice — a searchable select over the Invoices tab's own data, line items), row action Approve.

- [ ] **Step 6: Status badges + GST display** — a small shared badge-color mapping (draft/pending=amber, approved=green, rejected=red — match whatever color convention `VendorPaymentDispatchPage.tsx` or similar already uses for status badges, don't invent a new palette) and the IGST-vs-CGST/SGST conditional display described in the design's §5.

**Definition of Done:** all 3 tabs render real data from the live API shape (verified against Task 1's TypeScript interfaces, not assumed), create/approve/reject/PDF-download actions all wired to real mutations with toast feedback on success/failure, loading and empty states handled (matches this codebase's existing convention — check any sibling finance page for the loading-skeleton/empty-state pattern already in use).

---

### Task 3: Tests + live verification

**Files:**
- Create: `src/pages/finance/__tests__/ClientBillingWorkspacePage.test.tsx`

- [ ] **Step 1: Component tests** — mock `clientBillingApi.ts` at the module boundary (matching this codebase's existing RTL+vitest convention for a similar finance page — check `src/pages/finance/__tests__/` for a sibling test file to mirror). Cases: renders the 3 tabs; Proformas tab renders a list from a mocked response; create-proforma Sheet submits and calls `createProforma` with the expected payload shape; approve/reject call their respective mutations; PDF download button calls `downloadInvoicePdf`.

- [ ] **Step 2: Run the full frontend test suite** for the changed area (not a project-wide run if this repo's full suite is known slow/unstable — scope to the new test file plus anything else touching `client-billing`), paste real output.

- [ ] **Step 3: Manual/live check** — if a local dev frontend+backend are both reachable, navigate to `/finance/client-billing` as a demo `super_admin` (bypasses the pageCode grant, so this works even before the migration is applied to production) and confirm the page actually renders without a runtime error, the tabs switch, and at least one create-form Sheet opens. Screenshot or describe what was seen — don't just assert "it should work" from the code alone, per this session's standing verification discipline. If no live frontend dev server is reachable, say so plainly instead of fabricating a result.

**Definition of Done:** component tests passing with real output, and either a genuine live-render confirmation or an honest statement that one wasn't possible.

---

## Final Review Checklist (for the reviewer subagent)

- Confirm the migration's role grants exactly match `client-billing.routes.ts`'s live `ALLOWED_ROLES` at review time (not just at plan-writing time — routes files in this module have moved before).
- Confirm no money/GST value is computed client-side — every figure traces to an API response field.
- Confirm `hrmsApi.getBlob` + object-URL is the actual download mechanism used, not a new fetch-with-manual-headers reimplementation.
- Confirm the route addition didn't clobber any other route in `finance.routes.tsx` (diff against origin, same discipline as the PDF plan's route-file check).
- Confirm the page doesn't silently swallow an API error — every mutation needs a visible failure path (toast), not just a console.error.
- Confirm the migration was registered but genuinely NOT applied to production without separate explicit approval (re-check `schema_migrations` live, matching this session's standing incident-avoidance discipline from the foundation phase).