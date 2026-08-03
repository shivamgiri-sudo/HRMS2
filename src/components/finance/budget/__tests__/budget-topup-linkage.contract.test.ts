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
    // canReview must reuse the same capability flags as the GRN/budget approval queues —
    // not a new, easy-to-drift permission check.
    expect(workspace).toContain("capabilities?.canReviewBranchStage || capabilities?.canReviewFinanceStage");
  });

  it("BudgetTopupPanel posts to the routes registered in Phase B", () => {
    const panel = read("components/finance/budget/BudgetTopupPanel.tsx");
    expect(panel).toContain("/api/finance/pnl/budget-topups?");
    expect(panel).toContain('"/api/finance/pnl/budget-topups"');
    expect(panel).toContain("/api/finance/pnl/budget-topups/${id}/review");
    expect(panel).not.toContain(".replaceAll(");
  });
});
