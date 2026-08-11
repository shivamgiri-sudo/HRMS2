import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

describe("budget top-up request — GRN linkage and queue wiring", () => {
  it("BudgetLinkedGrnForm surfaces a 'Request a budget increase' action only on the exact over-budget error", () => {
    const form = read("components/finance/grn/BudgetLinkedGrnForm.tsx");
    expect(form).toContain("attemptedLineIdRef");
    expect(form).toContain("/exceeds (the )?available budget/i");
    expect(form).toContain("Request a budget increase");
    // The link must carry the exact line, branch and period so the destination doesn't
    // make the raiser re-find what they were just blocked on.
    expect(form).toContain("/finance/branch-budget?tab=topups&topupLine=");
    expect(form).toContain("&branchId=${form.branchId}");
  });

  it("useToast forwards an action button through to sonner, not silently dropping it", () => {
    const hook = read("hooks/use-toast.ts");
    expect(hook).toContain("action?: { label: string; onClick: () => void }");
    expect(hook).toContain("action,");
  });

  it("BranchBudgetManagementWorkspace reads the deep-link params and renders the Top-up tab", () => {
    const workspace = read("pages/finance/BranchBudgetManagementWorkspace.tsx");
    expect(workspace).toContain('useSearchParams()');
    expect(workspace).toContain('searchParams.get("topupLine")');
    expect(workspace).toContain('<TabsTrigger value="topups">');
    expect(workspace).toContain("<BudgetTopupPanel");
    // Review authority must reuse the same capability flags as the GRN/budget approval queues —
    // not a new, easy-to-drift permission check — and must be passed per stage, because the
    // backend picks the reviewer role from the row's status, not from "may review anything".
    expect(workspace).toContain("canReviewBranchStage={Boolean(capabilities?.canReviewBranchStage)}");
    expect(workspace).toContain("canReviewFinanceStage={Boolean(capabilities?.canReviewFinanceStage)}");
    // canCreate must mirror TOPUP_CREATE_ROLES (super_admin/admin/branch_admin + branch_head).
    // Hardcoding it true showed finance_head/accounts_head a button whose POST always 403s.
    expect(workspace).toContain("canCreate={Boolean(capabilities?.canCreate || capabilities?.canReviewBranchStage)}");
    expect(workspace).not.toMatch(/^\s*canCreate\s*$/m);
  });

  it("BudgetTopupPanel posts to the routes registered in Phase B", () => {
    const panel = read("components/finance/budget/BudgetTopupPanel.tsx");
    expect(panel).toContain("/api/finance/pnl/budget-topups?");
    expect(panel).toContain('"/api/finance/pnl/budget-topups"');
    expect(panel).toContain("/api/finance/pnl/budget-topups/${id}/review");
    expect(panel).not.toContain(".replaceAll(");
  });

  it("BudgetTopupPanel reads the headroom column the API actually returns", () => {
    const panel = read("components/finance/budget/BudgetTopupPanel.tsx");
    const service = fs.readFileSync(
      path.resolve(srcRoot, "../backend/src/modules/process-pnl/branch-budget.service.ts"),
      "utf8"
    );
    // availableLines() aliases the headroom as available_gross_amount. Reading it as
    // available_amount is not a type error (the row arrives as untyped JSON) — it silently
    // printed "available ₹0.00" for every option, which reads as an unusable budget.
    expect(service).toContain("AS available_gross_amount");
    expect(panel).toContain("money(line.available_gross_amount)");
    expect(panel).not.toContain("line.available_amount");
  });

  it("BudgetTopupPanel offers Approve/Reject only to the stage that owns the row", () => {
    const panel = read("components/finance/budget/BudgetTopupPanel.tsx");
    // 'submitted' belongs to branch_head and 'branch_head_approved' to finance_head, exactly as
    // resolveFinanceStageRole resolves them for workflow "grn". One combined canReview flag
    // showed each reviewer the other's button, and the POST came back 400.
    expect(panel).toContain('request.status === "submitted" && canReviewBranchStage');
    expect(panel).toContain('request.status === "branch_head_approved" && canReviewFinanceStage');
  });
});

/**
 * Contract and cache invariants found by the Phase 1 audit.
 *
 * Each of these was invisible on screen: a column that renders "-", a figure that stays stale
 * for 60 seconds, a name that falls back to a role label. None would fail a typecheck, because
 * every one of these rows arrives from the API as untyped JSON.
 */
describe("finance surfaces read the fields their APIs actually return", () => {
  const backend = (rel: string) => fs.readFileSync(path.resolve(srcRoot, "../backend", rel), "utf8");

  it("the invoice register asks for billing_invoice's real columns", () => {
    const page = read("pages/finance/ProcessPnlDetailPage.tsx");
    const service = backend("src/modules/process-pnl/process-pnl.service.ts");
    // getRevenue selects invoice_ref/period_from/period_to/sent_at/paid_at — and no
    // invoice_number, invoice_date or due_date, which is what the table used to ask for.
    expect(service).toContain("invoice_ref,");
    expect(service).not.toContain("invoice_number");
    expect(page).not.toContain('key: "invoice_number"');
    expect(page).not.toContain('key: "invoice_date"');
    expect(page).not.toContain('key: "due_date"');
    expect(page).toContain('key: "invoice_ref"');
  });

  it("the payroll table only shows the statutory split when the source has one", () => {
    const page = read("pages/finance/ProcessPnlDetailPage.tsx");
    // The employee_salary_assignment fallback returns loaded_cost only; rendering the four
    // statutory columns against it printed "₹NaN" on every row.
    expect(page).toContain('peopleCostQuery.data?.source === "salary_prep_line"');
    // …and currency() must not be able to emit NaN even if another field goes missing.
    expect(page).toContain("if (value != null && !Number.isFinite(value)) return \"-\";");
  });

  it("reviewer correction notes join employees on the key raised_by actually holds", () => {
    const service = backend("src/modules/process-pnl/branch-budget.service.ts");
    // raised_by is written from actor(req).id — the auth_user id, not employees.id.
    expect(service).toContain("LEFT JOIN employees e ON e.user_id = c.raised_by");
    expect(service).not.toContain("LEFT JOIN employees e ON e.id = c.raised_by");
  });

  it("applying a top-up drops every cache that reads the line it changed", () => {
    const panel = read("components/finance/budget/BudgetTopupPanel.tsx");
    for (const key of ["branch-budgets", "budget-lines-available-for-topup", "available-budget-lines"]) {
      expect(panel, `${key} reads finance_budget_line and must be invalidated`)
        .toContain(`queryKey: ["${key}"]`);
    }
  });

  it("a P&L recalculation drops the caches that serve the P&L screens", () => {
    const hook = read("hooks/usePnlReconciliation.ts");
    // All three carry staleTime 60_000, so omitting them served pre-recalculation numbers.
    for (const key of ["bpo-process-pnl", "pnl-statement", "budget-consolidation"]) {
      expect(hook).toContain(`queryKey: ["${key}"]`);
    }
  });

  it("no mutation invalidates a query key that does not exist", () => {
    const button = read("components/finance/grn/GrnBudgetImportButton.tsx");
    // Matches the call, not the name — the comment above it names the dead key deliberately.
    expect(button).not.toContain('queryKey: ["branch-budget-allocations"]');
    expect(button).toContain('queryKey: ["branch-budget-detail"]');
  });
});
