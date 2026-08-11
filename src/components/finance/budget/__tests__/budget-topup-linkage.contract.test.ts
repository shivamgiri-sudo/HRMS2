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
