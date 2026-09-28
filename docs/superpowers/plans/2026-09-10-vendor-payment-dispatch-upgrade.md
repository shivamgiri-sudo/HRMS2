# Vendor Payment Dispatch Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the real logic defects on `VendorPaymentDispatchPage.tsx` (misleading empty state, misleading branch-scope badge, dead `financialYear` filter capability) and bring its visual language in line with sibling Finance pages (`Metric` tile KPI strip), while surfacing the GRN approval backlog that currently explains most of the page's emptiness.

**Architecture:** Almost entirely frontend. One backend change (capabilities route gains `scopeBranchNames`), reusing an already-live GRN summary endpoint for the backlog data, and a set of frontend-only additions/edits to `VendorPaymentDispatchPage.tsx`. No schema changes, no changes to `PaymentDispatchSheet` or the GRN approval workflow.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query, shadcn/Radix (`Select`, `Badge`, `Button`), Tailwind, Express + TypeScript backend, MySQL via `mysql2`, Vitest for tests.

## Global Constraints

- Never touch files outside this plan's scope; this repo has many concurrent agents (`git status --porcelain` before staging, stage explicit paths only, never `git add -A`).
- Push directly to `main` (no branches/PRs) per this project's established workflow — but only after each task's own verification passes.
- Closed-set form fields must be `Select` dropdowns, never free-text `Input` (repo-wide rule; applies to the new `financialYear` filter).
- Every commit ends with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
- This page (like its siblings `PnlMasterControlCenterPage.tsx`, `BranchBudgetManagementWorkspace.tsx`) has no React-Testing-Library render harness set up. Following the established convention in this codebase (see `src/pages/finance/__tests__/PnlMasterControlCenterPage.branch-filter.test.ts`), frontend tests in this plan are **source-text contract tests**: `readFileSync` the page source and assert on exact code patterns with `expect(SRC).toMatch(/.../)`. This is not a workaround — it is the pattern this codebase already uses for large, unmounted pages.
- Backend tests mock `db.execute` via `vi.mock("../../../db/mysql.js", () => ({ db: { execute } }))`, matching `finance-branch-bound-scope.test.ts`.
- `npm run build` and `cd backend && npx tsc --noEmit` must be clean before any task is considered done.

---

### Task 1: Backend — `scopeBranchNames` on the capabilities route

**Files:**
- Modify: `backend/src/modules/finance/vendor-payment.service.ts` (add `getScopeBranchNames`)
- Modify: `backend/src/modules/finance/vendor-payment.routes.ts:110-144` (capabilities handler)
- Test: `backend/src/modules/finance/__tests__/vendor-payment-scope-branch-names.test.ts`

**Interfaces:**
- Produces: `vendorPaymentService.getScopeBranchNames(scope: FinanceBranchScope): Promise<string[]>` — returns `[]` when `scope.mode === "all"`, otherwise the `branch_name` values for `scope.branchIds` (branches missing from `branch_master` are silently skipped, not nulled).
- Consumes (existing, unchanged): `resolveFinanceBranchScopeSet`, `FinanceBranchScope` from `./finance-access-scope.js`; `actor(req)`, `allRoles(req)`, `hasGlobalFinanceScope`, `h()` from `vendor-payment.routes.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/finance/__tests__/vendor-payment-scope-branch-names.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getScopeBranchNames resolves the branch_master names for a branch-bound
 * FinanceBranchScope, and returns [] for organisation-wide scope — the data
 * the capabilities route needs to show "Karnal only" instead of a generic
 * "branch scope" pill.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

beforeEach(() => {
  execute.mockReset();
});

describe("vendorPaymentService.getScopeBranchNames", () => {
  it("returns [] for organisation-wide scope without querying the database", async () => {
    const { vendorPaymentService } = await import("../vendor-payment.service.js");
    const result = await vendorPaymentService.getScopeBranchNames({ mode: "all" });
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns resolved branch_name values for a branch-bound scope", async () => {
    execute.mockResolvedValue([
      [{ branch_name: "Karnal" }, { branch_name: "Noida-2" }],
      [],
    ]);
    const { vendorPaymentService } = await import("../vendor-payment.service.js");
    const result = await vendorPaymentService.getScopeBranchNames({
      mode: "branches",
      branchIds: ["branch-karnal", "branch-noida2"],
    });
    expect(result).toEqual(["Karnal", "Noida-2"]);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/FROM branch_master/);
    expect(params).toEqual(["branch-karnal", "branch-noida2"]);
  });

  it("returns [] for a branch-bound scope with an empty branchIds array, without querying", async () => {
    const { vendorPaymentService } = await import("../vendor-payment.service.js");
    const result = await vendorPaymentService.getScopeBranchNames({
      mode: "branches",
      branchIds: [],
    });
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/vendor-payment-scope-branch-names.test.ts`
Expected: FAIL — `getScopeBranchNames` is not exported from `vendor-payment.service.ts`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/modules/finance/vendor-payment.service.ts`, add this method to the exported `vendorPaymentService` object (near the other read helpers — same file already imports `FinanceBranchScope` from `./finance-access-scope.js` and `db` from `../../db/mysql.js`):

```typescript
  async getScopeBranchNames(scope: FinanceBranchScope): Promise<string[]> {
    if (scope.mode === "all" || scope.branchIds.length === 0) return [];
    const placeholders = scope.branchIds.map(() => "?").join(", ");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_name FROM branch_master WHERE id IN (${placeholders})`,
      scope.branchIds
    );
    return rows.map((row) => String(row.branch_name)).filter(Boolean);
  },
```

In `backend/src/modules/finance/vendor-payment.routes.ts`, replace the capabilities handler (lines 110-144) to resolve and include `scopeBranchNames`:

```typescript
router.get(
  "/vendor-payments/capabilities",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req: AuthenticatedRequest, res) => {
    const roles = allRoles(req);
    const canWrite = roles.has("accounts_head") || roles.has("super_admin");
    const user = actor(req);
    const hasGlobalRead = hasGlobalFinanceScope(user.role, user.roles);
    const scope = await resolveFinanceBranchScopeSet({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: undefined,
    });
    const scopeBranchNames = await vendorPaymentService.getScopeBranchNames(scope);
    res.json({
      success: true,
      data: {
        canRead: true,
        canWrite,
        readScope: hasGlobalRead ? "organisation" : "branch",
        scopeBranchNames,
        writeRole: canWrite ? paymentWriteRole(req) : null,
        paymentModel: "installment_ledger",
      },
    });
  })
);
```

Note: this changes the handler from a plain sync function to `h(async (req, res) => {...})` — `h` is already defined at the top of this file (line 50-51) and used by every other route in it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/vendor-payment-scope-branch-names.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Full backend typecheck and full finance test suite**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

Run: `cd backend && npx vitest run src/modules/finance/__tests__/`
Expected: all pass (confirms the capabilities handler edit didn't break any existing route/RBAC contract test in this directory).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/finance/vendor-payment.service.ts backend/src/modules/finance/vendor-payment.routes.ts backend/src/modules/finance/__tests__/vendor-payment-scope-branch-names.test.ts
git commit -m "$(cat <<'EOF'
feat(finance): resolve scopeBranchNames on vendor-payments capabilities

Branch-scoped roles (branch_admin/branch_head) saw a generic "branch
scope" badge on Vendor Payment Dispatch with no indication of which
branch, while "All branches" stayed selectable and silently
overridden server-side. Capabilities now resolves and returns the
actual branch name(s) so the frontend can show them honestly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Frontend — `financialYear` filter + `Filters` interface

**Files:**
- Modify: `src/pages/finance/VendorPaymentDispatchPage.tsx`
- Test: `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts` (created here, extended by later tasks)

**Interfaces:**
- Consumes (existing, unchanged in this task): backend already accepts `financialYear` query param on `GET /vendor-payments` and `/vendor-payments/export` (`vendor-payment.routes.ts:169-171`, confirmed live — no backend change needed).
- Produces: `financialYearOptions(): string[]` — a plain function in the page file, descending list of `YYYY-YY` strings from the current financial year back through `2017-18` (the earliest year real `vendor_payment_tracking` data exists, per the design-doc audit), so later tasks/reviewers know the exact name and shape.

- [ ] **Step 1: Write the failing test**

Create `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Source-text contract tests for VendorPaymentDispatchPage.tsx's 2026-09-10 upgrade.
 * No rendering harness exists for this page (DashboardLayout + multiple useQuery hooks with
 * no test-time QueryClient/router setup) — same convention as
 * PnlMasterControlCenterPage.branch-filter.test.ts. Extended by later tasks in this plan.
 */

const SRC = readFileSync(
  new URL("../VendorPaymentDispatchPage.tsx", import.meta.url),
  "utf8",
);

describe("VendorPaymentDispatchPage — financialYear filter (Task 2)", () => {
  it("Filters interface declares financialYear", () => {
    expect(SRC).toMatch(/interface Filters \{[\s\S]*?financialYear: string;[\s\S]*?\}/);
  });

  it("initialFilters() sets financialYear to empty string", () => {
    expect(SRC).toMatch(/function initialFilters\(\): Filters \{[\s\S]*?financialYear: "",[\s\S]*?\}/);
  });

  it("defines financialYearOptions() generating YYYY-YY strings back to real-data floor 2017", () => {
    expect(SRC).toMatch(/function financialYearOptions\(\)/);
    expect(SRC).toMatch(/year >= 2017/);
    expect(SRC).toMatch(/\$\{year\}-\$\{String\(\(year \+ 1\) % 100\)\.padStart\(2, "0"\)\}/);
  });

  it("renders a financialYear Select (not a free-text Input) in the filter bar", () => {
    expect(SRC).toMatch(
      /value=\{filters\.financialYear \|\| "_all"\}[\s\S]{0,600}financialYearOptions\(\)\.map/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: FAIL (all 4 assertions in this describe block fail — none of this exists yet).

- [ ] **Step 3: Write minimal implementation**

In `src/pages/finance/VendorPaymentDispatchPage.tsx`, update the `Filters` interface (currently lines 87-94):

```typescript
interface Filters {
  branchId: string;
  month: string;
  financialYear: string;
  paymentStatus: string;
  dueDateFrom: string;
  dueDateTo: string;
  search: string;
}
```

Update `initialFilters()` (currently lines 122-131):

```typescript
function initialFilters(): Filters {
  return {
    branchId: "",
    month: "",
    financialYear: "",
    paymentStatus: "",
    dueDateFrom: "",
    dueDateTo: "",
    search: "",
  };
}
```

Add this function near `initialFilters()` (real data spans 2017-02 to the present per the design doc's live audit; generated, not hardcoded to "today"):

```typescript
function financialYearOptions(): string[] {
  const now = new Date();
  const currentStartYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const options: string[] = [];
  for (let year = currentStartYear + 1; year >= 2017; year--) {
    options.push(`${year}-${String((year + 1) % 100).padStart(2, "0")}`);
  }
  return options;
}
```

In the filter bar JSX (inside `{showFilters && (...)}`, after the `MonthYearPicker`), add:

```tsx
<Select
  value={filters.financialYear || "_all"}
  onValueChange={(value) => {
    setFilters((c) => ({ ...c, financialYear: value === "_all" ? "" : value }));
    setPage(1);
  }}
>
  <SelectTrigger className="h-7 w-28 text-xs">
    <SelectValue placeholder="All years" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="_all">All years</SelectItem>
    {financialYearOptions().map((fy) => (
      <SelectItem key={fy} value={fy}>{fy}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: PASS (4/4 in this describe block)

- [ ] **Step 5: Frontend build check**

Run: `npm run build 2>&1 | tail -15`
Expected: no TypeScript/build errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/finance/VendorPaymentDispatchPage.tsx src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts
git commit -m "$(cat <<'EOF'
feat(finance): wire financialYear filter on Vendor Payment Dispatch

Backend has accepted financialYear on GET /vendor-payments and
/vendor-payments/export since this endpoint shipped; the frontend
Filters interface never sent it. Added as a closed-set dropdown
(YYYY-YY, generated back to 2017-18 — the real data floor) per this
repo's no-free-text-on-closed-sets rule.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Frontend — KPI strip becomes `Metric` tiles + Pending Approval tile

**Files:**
- Modify: `src/pages/finance/VendorPaymentDispatchPage.tsx`
- Test: `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts` (append)

**Interfaces:**
- Consumes: `GET /api/finance/grns/summary` (existing, live, `grn.routes.ts:733-755`) — response shape `{ data: { byStatus: Record<string, {count:number; value:number}>; inQueue: {count:number; value:number} } }`, confirmed by reading `grn.service.ts:2330-2363`.
- Produces: local `function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "slate"|"blue"|"emerald"|"rose"|"amber" })` — copied recipe (no shared component exists in this codebase for it, confirmed by investigation; every sibling Finance page defines its own copy), used again by Task 4's backlog panel and referenced by name there.
- Produces: `pendingApprovalQuery` (TanStack Query, `queryKey: ["grn-approval-summary", filters.branchId]`) and derived `pendingApproval: { count: number; value: number } | null` — `null` when the query errors (e.g. 403 for a `payroll_head` viewer whose role isn't in GRN's read list) or hasn't loaded, otherwise the sum of `byStatus.branch_head_approved` + `byStatus.finance_head_approved`. Task 4 and Task 5 both read this same `pendingApproval` value — do not rename it.

- [ ] **Step 1: Write the failing test**

Append to `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`:

```typescript
describe("VendorPaymentDispatchPage — Metric tile KPI strip + backlog query (Task 3)", () => {
  it("defines a local Metric tile component matching the sibling Finance page recipe", () => {
    expect(SRC).toMatch(/function Metric\(\{[\s\S]*?label[\s\S]*?value[\s\S]*?\}/);
    expect(SRC).toContain("rounded-2xl border");
    expect(SRC).toContain("uppercase tracking-[0.15em]");
  });

  it("queries GET /api/finance/grns/summary for the approval backlog", () => {
    expect(SRC).toContain('"/api/finance/grns/summary"');
    expect(SRC).toMatch(/queryKey:\s*\["grn-approval-summary"/);
  });

  it("derives pendingApproval from branch_head_approved + finance_head_approved buckets", () => {
    expect(SRC).toContain("branch_head_approved");
    expect(SRC).toContain("finance_head_approved");
  });

  it("renders the KPI strip as a Metric tile grid, not plain spans", () => {
    expect(SRC).toMatch(/grid grid-cols-2 md:grid-cols-5 gap-2/);
    expect(SRC).toMatch(/<Metric\s+label="Page due"/);
    expect(SRC).toMatch(/<Metric\s+label="Pending approval"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: FAIL (this describe block's 4 assertions fail; Task 2's block still passes).

- [ ] **Step 3: Write minimal implementation**

Add the `Metric` component in `VendorPaymentDispatchPage.tsx`, below the existing `money()` helper (around line 120):

```tsx
function Metric({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "blue" | "emerald" | "rose" | "amber";
}) {
  const toneClass = {
    slate: "text-slate-950",
    blue: "text-blue-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">{label}</p>
      <p className={`mt-2 text-lg font-black ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
```

Add the backlog query inside the component, after the existing `ledgerVendorQuery` block (around line 245):

```typescript
  // GRN approval backlog — GET /api/finance/grns/summary already exists (grn.routes.ts),
  // already RBAC-scoped the same way as this page's own endpoints, and already returns
  // branch_head_approved/finance_head_approved counts. No new backend endpoint needed.
  // payroll_head is on this page's PAYMENT_READ_ROLES but not GRN_READ_ROLES, so a 403 here
  // is an expected outcome for that role, not an error — pendingApproval degrades to null.
  const pendingApprovalQuery = useQuery({
    queryKey: ["grn-approval-summary", filters.branchId],
    queryFn: () => hrmsApi.get<any>(
      `/api/finance/grns/summary${filters.branchId ? `?branchId=${filters.branchId}` : ""}`
    ),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pendingApproval: { count: number; value: number } | null = (() => {
    if (pendingApprovalQuery.isError) return null;
    const byStatus = (pendingApprovalQuery.data as any)?.data?.byStatus;
    if (!byStatus) return null;
    const branchHead = byStatus.branch_head_approved ?? { count: 0, value: 0 };
    const financeHead = byStatus.finance_head_approved ?? { count: 0, value: 0 };
    return {
      count: Number(branchHead.count ?? 0) + Number(financeHead.count ?? 0),
      value: Number(branchHead.value ?? 0) + Number(financeHead.value ?? 0),
    };
  })();
```

Replace the KPI strip block (currently lines 328-334):

```tsx
        {/* ── KPI strip ── */}
        <div className="grid grid-cols-2 gap-2 border-b bg-slate-50/40 px-4 py-3 text-xs shrink-0 md:grid-cols-5">
          <Metric label="Page due" value={money(summary.due)} />
          <Metric label="Paid" value={money(summary.paid)} tone="emerald" />
          <Metric label="Balance" value={money(summary.balance)} tone="blue" />
          <Metric label="Overdue" value={money(summary.overdue)} tone="rose" />
          {pendingApproval && (
            <Metric
              label="Pending approval"
              value={money(pendingApproval.value)}
              sub={`${pendingApproval.count} GRN${pendingApproval.count === 1 ? "" : "s"}`}
              tone="amber"
            />
          )}
        </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: PASS (8/8 across both describe blocks so far)

- [ ] **Step 5: Frontend build check**

Run: `npm run build 2>&1 | tail -15`
Expected: no errors. (`money()` was already defined and used elsewhere in this file, confirmed at line 114-120 and reused unchanged by the Aging panel — no new import needed.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/finance/VendorPaymentDispatchPage.tsx src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts
git commit -m "$(cat <<'EOF'
feat(finance): Metric-tile KPI strip on Vendor Payment Dispatch

Replaced the plain-text KPI strip with the Metric tile recipe already
used by AnnualBudgetSummaryPage/UnlinkedGrnReviewPage/
BranchBudgetManagementWorkspace, bringing this page's visual language
in line with its siblings. Added a Pending Approval tile sourced from
the existing GET /api/finance/grns/summary endpoint (no new backend
route) — surfaces the GRN backlog that explains most of this page's
current emptiness.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontend — Approval Backlog panel

**Files:**
- Modify: `src/pages/finance/VendorPaymentDispatchPage.tsx`
- Test: `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts` (append)

**Interfaces:**
- Consumes: `pendingApprovalQuery`, `pendingApproval` from Task 3 (exact names — do not redefine).
- Produces: `showBacklog` state + toggle button, rendered panel block placed directly after the existing Aging panel (`{showAging && (...)}`) and before the Ledger panel, matching their existing structural pattern.

- [ ] **Step 1: Write the failing test**

Append to `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`:

```typescript
describe("VendorPaymentDispatchPage — Approval Backlog panel (Task 4)", () => {
  it("declares a showBacklog toggle alongside showAging/showLedger", () => {
    expect(SRC).toMatch(/const \[showBacklog, setShowBacklog\] = useState\(false\);/);
  });

  it("renders a header button toggling showBacklog", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => setShowBacklog\(\(v\) => !v\)\}/);
  });

  it("renders the backlog panel gated on showBacklog, listing both approval stages", () => {
    expect(SRC).toMatch(/\{showBacklog && \([\s\S]*?Approval Backlog[\s\S]*?\}\)\}/);
    expect(SRC).toMatch(/Branch Head[\s\S]{0,200}Finance Head/);
  });

  it("links out to the GRN approval page rather than adding new write actions here", () => {
    expect(SRC).toMatch(/href="\/finance\/grn|to="\/finance\/grn|navigate\(.\/finance\/grn/);
  });
});
```

- [ ] **Step 2: Confirm the real GRN approval page route**

Before writing the implementation, find the actual route path so the link is real, not guessed:

Run: `grep -rn "VendorApproval\|GrnApproval\|/finance/grn" src/config/routes/finance.routes.tsx src/App.tsx 2>/dev/null | head -20`

Use whatever path this returns in place of the placeholder pattern above (the test in Step 1 accepts `/finance/grn` as a prefix match — adjust the literal `href`/`to` value, not the test, once you know the real path).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: FAIL (this describe block's 4 assertions fail).

- [ ] **Step 4: Write minimal implementation**

Add state near the other toggles (currently lines 161-164):

```typescript
  const [showBacklog, setShowBacklog] = useState(false);
```

Add a header button next to the existing Aging/Ledger/Filters buttons (after the Ledger button, before Filters, in the header action row):

```tsx
            <Button size="sm" variant="outline" onClick={() => setShowBacklog((v) => !v)}>
              <Clock className="mr-1.5 h-3.5 w-3.5" />Backlog
              {pendingApproval && pendingApproval.count > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">
                  {pendingApproval.count}
                </span>
              )}
            </Button>
```

Add `Clock` to the `lucide-react` import list at the top of the file (currently lines 3-14).

Add the panel after the existing Aging panel block (`{showAging && (...)}`, before the Ledger panel):

```tsx
      {/* Approval Backlog — GRNs that must clear Branch Head + Finance Head approval before
          they ever reach vendor_payment_tracking and this page's own grid. Read-only link-out;
          approving is a different page's job. */}
      {showBacklog && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">Approval Backlog</p>
          {pendingApprovalQuery.isError ? (
            <p className="text-xs text-slate-400">
              Approval backlog isn't visible for your role — ask a Finance/Accounts Head to check
              the GRN approval queue directly.
            </p>
          ) : !pendingApproval || pendingApproval.count === 0 ? (
            <p className="text-xs text-slate-400">No GRNs waiting on approval right now.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(() => {
                const byStatus = (pendingApprovalQuery.data as any)?.data?.byStatus ?? {};
                const stages: { key: string; label: string }[] = [
                  { key: "branch_head_approved", label: "Awaiting Finance Head (cleared Branch Head)" },
                  { key: "finance_head_approved", label: "Awaiting Accounts Head (cleared Finance Head)" },
                ];
                return stages.map(({ key, label }) => {
                  const bucket = byStatus[key] ?? { count: 0, value: 0 };
                  return (
                    <div key={key} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-[11px] font-medium text-slate-500 uppercase">{label}</p>
                      <p className="mt-1 text-base font-semibold tabular-nums text-amber-700">
                        {money(bucket.value)}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {bucket.count} GRN{bucket.count === 1 ? "" : "s"}
                      </p>
                    </div>
                  );
                });
              })()}
            </div>
          )}
          <a href="/finance/grn" className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline">
            Open GRN Approvals →
          </a>
        </div>
      )}
```

(Replace `"/finance/grn"` with whatever Step 2's grep found as the real route.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: PASS (all tests across Tasks 2-4's describe blocks)

- [ ] **Step 6: Frontend build check**

Run: `npm run build 2>&1 | tail -15`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/finance/VendorPaymentDispatchPage.tsx src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts
git commit -m "$(cat <<'EOF'
feat(finance): Approval Backlog panel on Vendor Payment Dispatch

Read-only panel (same toggle pattern as the existing Aging/Ledger
panels) showing GRN count + value stuck at each approval stage before
reaching this page's payment queue, with a link out to GRN Approvals.
No new write actions — the approval workflow itself is untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend — honest empty state

**Files:**
- Modify: `src/pages/finance/VendorPaymentDispatchPage.tsx`
- Test: `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts` (append)

**Interfaces:**
- Consumes: `pendingApproval` from Task 3 (exact name).

- [ ] **Step 1: Write the failing test**

Append to `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`:

```typescript
describe("VendorPaymentDispatchPage — honest empty state (Task 5)", () => {
  it("empty-row branch explains the approval backlog when one exists, otherwise falls back to the plain message", () => {
    expect(SRC).toMatch(/No payments due for dispatch/);
    expect(SRC).toMatch(/awaiting approval before they reach this queue/);
    expect(SRC).toContain("No payments found");
  });

  it("empty-row branches on pendingApproval, not a hardcoded string", () => {
    expect(SRC).toMatch(/\(rows \?\? \[\]\)\.length === 0 &&[\s\S]{0,600}pendingApproval[\s\S]{0,600}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: FAIL (both assertions in this describe block fail).

- [ ] **Step 3: Write minimal implementation**

Replace the empty-row block (currently lines 496-500):

```tsx
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400">
                      {pendingApproval && pendingApproval.count > 0 ? (
                        <>
                          No payments due for dispatch — {pendingApproval.count} GRN
                          {pendingApproval.count === 1 ? "" : "s"} ({money(pendingApproval.value)}) are
                          still awaiting approval before they reach this queue.{" "}
                          <button
                            type="button"
                            className="font-medium text-blue-600 hover:underline"
                            onClick={() => setShowBacklog(true)}
                          >
                            View backlog
                          </button>
                        </>
                      ) : (
                        "No payments found"
                      )}
                    </td>
                  </tr>
                )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: PASS (all tests across Tasks 2-5)

- [ ] **Step 5: Frontend build check**

Run: `npm run build 2>&1 | tail -15`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/finance/VendorPaymentDispatchPage.tsx src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts
git commit -m "$(cat <<'EOF'
fix(finance): honest empty state on Vendor Payment Dispatch

"No payments found" read as "nothing to pay" when the real cause was
usually an upstream approval backlog (GRNs not yet cleared through
Branch Head/Finance Head/Accounts Head). Empty grid now states the
backlog count and value when one exists, with a one-click link to the
new Approval Backlog panel; falls back to the plain message only when
there's genuinely no backlog either.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend — honest branch-scope badge

**Files:**
- Modify: `src/pages/finance/VendorPaymentDispatchPage.tsx`
- Test: `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts` (append)

**Interfaces:**
- Consumes: `capabilities.scopeBranchNames: string[]` from Task 1's backend change (already flows through the existing `PaymentCapabilities` fetch/typing in this file — needs the field added to the local `PaymentCapabilities` interface).

- [ ] **Step 1: Write the failing test**

Append to `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`:

```typescript
describe("VendorPaymentDispatchPage — honest scope badge (Task 6)", () => {
  it("PaymentCapabilities interface declares scopeBranchNames", () => {
    expect(SRC).toMatch(/interface PaymentCapabilities \{[\s\S]*?scopeBranchNames\??:\s*string\[\];[\s\S]*?\}/);
  });

  it("scope badge shows named branches for branch scope, not a generic 'branch scope' pill", () => {
    expect(SRC).toMatch(/capabilities\?\.scopeBranchNames/);
    expect(SRC).not.toMatch(/\{capabilities\.readScope\} scope/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: FAIL (both assertions in this describe block fail — the current file still has `{capabilities.readScope} scope`).

- [ ] **Step 3: Write minimal implementation**

Update the `PaymentCapabilities` interface (currently lines 32-38):

```typescript
interface PaymentCapabilities {
  canRead: boolean;
  canWrite: boolean;
  readScope: "organisation" | "branch";
  scopeBranchNames?: string[];
  writeRole: string | null;
  paymentModel?: "installment_ledger";
}
```

Replace the scope badge (currently lines 302-304):

```tsx
            {capabilities?.readScope === "organisation" ? (
              <Badge variant="outline">organisation scope</Badge>
            ) : capabilities?.scopeBranchNames && capabilities.scopeBranchNames.length > 0 ? (
              <Badge variant="outline" title="All branches in the filter bar is narrowed to these on the backend">
                {capabilities.scopeBranchNames.join(", ")} only
              </Badge>
            ) : capabilities?.readScope === "branch" ? (
              <Badge variant="outline">branch scope</Badge>
            ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: PASS (all tests across Tasks 2-6)

- [ ] **Step 5: Frontend build check**

Run: `npm run build 2>&1 | tail -15`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/finance/VendorPaymentDispatchPage.tsx src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts
git commit -m "$(cat <<'EOF'
fix(finance): show named branch(es) in Vendor Payment Dispatch scope badge

The "branch scope" pill never said which branch, while "All branches"
stayed selectable in the filter bar and was silently overridden
server-side (resolveFinanceBranchScopeSet). Badge now names the
actual resolved branch(es) via the capabilities route's new
scopeBranchNames field (Task 1). Falls back to the old generic pill
only if the field is empty/absent (defensive, shouldn't happen once
Task 1 is deployed).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Frontend — inline overdue chip, Ledger period tooltip, MonthYearPicker clear

**Files:**
- Modify: `src/pages/finance/VendorPaymentDispatchPage.tsx`
- Test: `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts` (append)

**Interfaces:**
- Consumes: `agingDays()` (existing helper, unchanged, `VendorPaymentDispatchPage.tsx:133-136`).

- [ ] **Step 1: Write the failing test**

Append to `src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`:

```typescript
describe("VendorPaymentDispatchPage — overdue chip, ledger tooltip, clearable month (Task 7)", () => {
  it("Due date cell shows an inline overdue chip using the existing agingDays() helper", () => {
    expect(SRC).toMatch(/agingDays\(p\.due_date\) > 0[\s\S]{0,200}days overdue/);
  });

  it("Ledger panel's Period column header carries a tooltip about accounting_period vs due_date", () => {
    expect(SRC).toMatch(/accounting_period[\s\S]{0,150}due_date/);
  });

  it("MonthYearPicker in the filter bar is clearable via emptyLabel", () => {
    expect(SRC).toMatch(/<MonthYearPicker[\s\S]{0,200}emptyLabel="All months"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: FAIL (all 3 assertions in this describe block fail).

- [ ] **Step 3: Write minimal implementation**

In the filter bar, update the `MonthYearPicker` call (currently lines 356-360):

```tsx
            <MonthYearPicker
              className="w-52"
              value={filters.month}
              onChange={(v) => { setFilters((c) => ({ ...c, month: v })); setPage(1); }}
              emptyLabel="All months"
            />
```

Replace the Due date cell (currently line 475):

```tsx
                    <td className="py-1">
                      {p.due_date ? formatISTDate(p.due_date) : "-"}
                      {p.due_date && agingDays(p.due_date) > 0 && !["Paid", "Closed"].includes(p.payment_status) && (
                        <div className="text-[10px] font-medium text-rose-600">
                          {agingDays(p.due_date)} days overdue
                        </div>
                      )}
                    </td>
```

In the Ledger panel's table header (currently lines 590-592), replace the `"Period"` header cell with a tooltip-carrying version:

```tsx
                  <tr className="border-b bg-slate-50">
                    {["GRN No.", "Date", "Invoice No.", "Period", "Due Amt", "TDS", "Net Payable", "Paid", "Balance", "Status", "Due Date", "Branch"].map((h) => (
                      <th
                        key={h}
                        className="h-8 px-3 text-left font-medium text-slate-500"
                        title={h === "Period" ? "This is accounting_period — the main grid above filters by due_date instead, so a bill can show a different month here than in the Due date filter." : undefined}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts`
Expected: PASS (all tests across Tasks 2-7 — full file)

- [ ] **Step 5: Frontend build check**

Run: `npm run build 2>&1 | tail -15`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/finance/VendorPaymentDispatchPage.tsx src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts
git commit -m "$(cat <<'EOF'
polish(finance): overdue chip, ledger period tooltip, clearable month filter

Small logic/UX fixes on Vendor Payment Dispatch: due-date column now
shows an inline "N days overdue" chip (reuses the existing
agingDays() helper, no new query) instead of overdue-ness only being
visible inside the separate Aging panel; the Vendor Ledger panel's
Period column is now labelled as accounting_period so it stops
looking like a bug when it disagrees with the grid's due_date filter;
MonthYearPicker in the filter bar is now clearable via its existing
(previously unused here) emptyLabel prop.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: End-to-end verification

**Files:** none modified — verification only, per this repo's CLAUDE.md mandatory-verification rules.

- [ ] **Step 1: Full frontend test suite for this file**

Run: `npx vitest run src/pages/finance/__tests__/VendorPaymentDispatchPage.upgrade.test.ts --reporter=verbose`
Expected: all tests from Tasks 2-7 pass (should be ~20 assertions total across 6 describe blocks).

- [ ] **Step 2: Full backend test suite for the touched module**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/`
Expected: all pass, including Task 1's new test and every existing `vendor-payment*`/`finance-*-scope*` contract test (confirms the capabilities handler edit didn't regress RBAC).

- [ ] **Step 3: Full builds**

Run: `npm run build 2>&1 | tail -15`
Expected: clean.

Run: `cd backend && npx tsc --noEmit 2>&1 | head -10`
Expected: clean.

- [ ] **Step 4: Hit the live capabilities endpoint**

Using a real token (read from wherever this repo's other verification scripts read one — never paste a literal token):

```bash
curl -s -H "Authorization: Bearer $TOKEN" https://mcnhrms.teammas.in/api/finance/vendor-payments/capabilities | jq .
```

Expected: response now includes `scopeBranchNames` (an array — empty for an organisation-scope account, populated for a branch-scoped one).

- [ ] **Step 5: Confirm the backlog numbers against the live database**

```bash
mysql -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" -e "
SELECT status, COUNT(*) AS cnt, SUM(COALESCE(amount_with_tax, amount)) AS total
FROM grn_request
WHERE status IN ('branch_head_approved','finance_head_approved')
GROUP BY status;"
```

Expected: counts/sums are in the same ballpark as what `GET /api/finance/grns/summary` and the new Pending Approval tile/backlog panel show in the browser (drift is expected — approvals move — but they must not be wildly different, e.g. off by an order of magnitude, which would mean the frontend derivation in Task 3 is wrong).

- [ ] **Step 6: Visual check in a real browser**

Using chrome-devtools MCP (or manually): navigate to the Vendor Payment Dispatch page, and confirm:
- KPI strip renders as 5 bordered tiles, not plain text.
- Pending Approval tile shows a non-zero value if the backlog query in Step 5 found rows.
- Backlog panel opens from the header button, shows both stage buckets, link out works.
- Empty grid (if the current filters produce one) shows the backlog-aware message, not bare "No payments found", when a backlog exists.
- financialYear dropdown is present in the filter bar and round-trips into the network request's query string.
- Scope badge shows a named branch (or "organisation scope") rather than the old generic "branch scope" pill.
- Due date column shows the overdue chip on at least one overdue row (if any exist in the current filter).
- MonthYearPicker can be cleared back to blank via its own "All months" option, not only the separate Clear button.

If any check fails, do not report this task as complete — fix the specific gap and re-run the relevant earlier task's steps.
