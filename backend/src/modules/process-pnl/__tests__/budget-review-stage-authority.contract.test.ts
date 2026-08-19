import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Branch-budget review authority, after the 2026-08-19 owner decision that Finance Head approves
 * branch budgets at every level and that maker-checker does not apply to Finance Head or
 * Super Admin.
 *
 * Written against the source rather than by driving review(), which needs a live connection and a
 * FOR UPDATE transaction — the same approach budget-governance-controls.contract.test.ts already
 * takes for the transfer and tax-amendment maker-checker rules.
 *
 * Every assertion here fails against the pre-change service, which mapped each role to exactly
 * one status via a chained ternary (`role === "branch_head" ? "submitted" : ...`).
 */
const svc = readFileSync(
  resolve(__dirname, "../branch-budget.service.ts"),
  "utf8"
);

function reviewBody() {
  const start = svc.indexOf("  async review(");
  expect(start, "review() must exist").toBeGreaterThan(-1);
  return svc.slice(start, svc.indexOf("\n  async ", start + 10));
}

describe("branch budget review — stage authority", () => {
  it("resolves the stage from the budget status, not from the reviewer's role", () => {
    const body = reviewBody();
    expect(body).toContain("REVIEW_STAGES[currentStatus as keyof typeof REVIEW_STAGES]");
    // The old role->status ternary must be gone; it is what pinned each role to one stage.
    expect(body).not.toContain(`role === "branch_head"\n      ? "submitted"`);
    expect(body).not.toMatch(/const expectedStatus\s*=/);
  });

  it("lets Finance Head act at all three stages, and Super Admin too", () => {
    for (const stage of ["submitted", "branch_head_approved", "finance_head_approved"]) {
      const block = svc.slice(svc.indexOf(`  ${stage}: {`));
      const roles = block.slice(0, block.indexOf("},"));
      expect(roles, `${stage} must admit finance_head`).toContain('"finance_head"');
      expect(roles, `${stage} must admit super_admin`).toContain('"super_admin"');
    }
  });

  it("keeps each stage owner able to act on their own stage", () => {
    const submitted = svc.slice(svc.indexOf("  submitted: {"));
    expect(submitted.slice(0, submitted.indexOf("},"))).toContain('"branch_head"');
    const fha = svc.slice(svc.indexOf("  finance_head_approved: {"));
    expect(fha.slice(0, fha.indexOf("},"))).toContain('"accounts_head"');
  });

  it("does NOT widen the middle stage to branch_head or accounts_head", () => {
    const bha = svc.slice(svc.indexOf("  branch_head_approved: {"));
    const roles = bha.slice(0, bha.indexOf("},"));
    expect(roles).not.toContain('"branch_head"');
    expect(roles).not.toContain('"accounts_head"');
  });

  it("stamps the stage's own column and advances to the stage's own next status", () => {
    const body = reviewBody();
    expect(body).toContain("const approvalPrefix = stage.column;");
    expect(body).toContain(": stage.next;");
    // A finance_head acting early must complete the Branch Head step, not skip it.
    const submitted = svc.slice(svc.indexOf("  submitted: {"));
    const stage = submitted.slice(0, submitted.indexOf("},"));
    expect(stage).toContain('next: "branch_head_approved"');
    expect(stage).toContain('column: "branch_head_approved"');
  });

  it("exempts exactly finance_head and super_admin from maker-checker", () => {
    const line = svc.slice(svc.indexOf("const MAKER_CHECKER_EXEMPT_ROLES"));
    const decl = line.slice(0, line.indexOf(");") + 1);
    expect(decl).toContain('"finance_head"');
    expect(decl).toContain('"super_admin"');
    expect(decl).not.toContain('"branch_head"');
    expect(decl).not.toContain('"accounts_head"');
    // and the guard actually consults it
    expect(reviewBody()).toContain("!MAKER_CHECKER_EXEMPT_ROLES.has(role)");
  });

  it("still blocks a non-exempt reviewer from approving their own prior work", () => {
    const body = reviewBody();
    expect(body).toContain("BUDGET_MAKER_CHECKER");
    expect(body).toContain("priorActors");
    // submitter is checked at every stage; earlier approvers only at later stages
    expect(body).toContain("submitted this budget");
    expect(body).toContain("performed the Branch Head approval");
    expect(body).toContain("performed the Finance Head approval");
  });

  it("keeps the optimistic status lock on the row it actually read", () => {
    const body = reviewBody();
    expect(body).toContain("WHERE id = ? AND status = ?");
    expect(body).toContain("currentStatus,");
    expect(body).toContain("BUDGET_STATUS_CHANGED");
  });
});
