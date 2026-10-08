import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

// Per head/sub-head correction notes (migration 433). A reviewer sending a budget back must say
// which head/sub-head is wrong, rather than leaving one free-text remark against the whole budget.
// These guard the three things that were actually wrong or fragile while building it.

describe("budget line correction schema", () => {
  it("is registered in the migration manifest", () => {
    const manifest = read("src/db/runPendingMigrations.ts");
    expect(manifest).toContain("433_budget_line_corrections.sql");
  });

  it("does not foreign-key correction notes to finance_budget_line", () => {
    const migration = read("sql/433_budget_line_corrections.sql");
    // saveDraft() replaces the whole line set (DELETE then INSERT with fresh UUIDs). An FK to
    // finance_budget_line with ON DELETE CASCADE would therefore destroy every correction the
    // instant the branch admin saved the very fix the note asked for. Notes are anchored on
    // head/sub_head/item_name instead, with line_id kept only as a soft pointer.
    expect(migration).not.toMatch(/REFERENCES\s+finance_budget_line\b/i);
    expect(migration).toMatch(/REFERENCES\s+finance_budget_header/i);
    expect(migration).toMatch(/\bhead\s+VARCHAR/i);
    expect(migration).toMatch(/\bsub_head\s+VARCHAR/i);
  });
});

describe("reviewer paths", () => {
  it("exposes reviewer-revise without colliding with the create/submit owner", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain('"/pnl/budgets/:id/reviewer-revise"');
    // Must stay off the two paths owned exclusively by budgetCoverageRouter.
    expect(routes).not.toMatch(/router\.post\(\s*"\/pnl\/budgets"/);
    expect(routes).not.toMatch(/router\.post\(\s*"\/pnl\/budgets\/:id\/submit"/);
  });

  it("keeps the budget at the reviewer's own stage when they edit in place", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    const start = service.indexOf("async reviewerRevise(");
    expect(start).toBeGreaterThan(-1);
    // End at the NEXT method, not at "async review(" — another method may sit between them, and
    // slicing that far swept deleteOrSupersede's "SET status = 'closed'" into this assertion.
    const nextMethod = service.indexOf("\n  async ", start + 10);
    const body = service.slice(start, nextMethod > -1 ? nextMethod : undefined);
    // A reviewer editing lines must not advance, reset or otherwise move the budget: they still
    // have to Approve afterwards, so the edit cannot be used to skip their own stage.
    expect(body).not.toMatch(/SET\s+status\s*=/i);
    expect(body).toContain("REVIEWER_EDIT");
    // And it must be refused unless the budget is sitting at that reviewer's stage.
    expect(body).toContain("cannot revise a budget in status");
  });

  it("requires at least one head/sub-head note when sending a budget back", () => {
    const service = read("src/modules/process-pnl/branch-budget.service.ts");
    expect(service).toContain(
      "At least one head/sub-head correction note is required when sending a budget back for revision"
    );
  });
});

describe("correction notes close on the path the UI actually uses", () => {
  it("resolves open notes in budgetCoverageService.submitBudget", () => {
    // The UI submits through budgetCoverageRouter -> budgetCoverageService.submitBudget().
    // branchBudgetService.submit() is NOT that path, so resolving notes only there left every
    // note permanently open after a resubmit.
    const coverage = read("src/modules/process-pnl/budget-coverage.service.ts");
    const start = coverage.indexOf("async submitBudget(");
    expect(start).toBeGreaterThan(-1);
    const body = coverage.slice(start);
    expect(body).toMatch(/UPDATE\s+finance_budget_line_correction/i);
    expect(body).toMatch(/resolved_at\s*=\s*NOW\(\)/i);
    // Resolved, never deleted — repeated round trips have to stay auditable.
    expect(body).not.toMatch(/DELETE\s+FROM\s+finance_budget_line_correction/i);
  });
});
