import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function readRepo(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

/**
 * UNBUDGETED vendor GRNs — a Head/Sub-head with no approved budget line, which the vendor form
 * deliberately allows a raiser to pick.
 *
 * The path existed in pieces and had never once executed end to end: saveComponentAllocations()
 * had full isUnbudgeted handling, the is_unbudgeted columns were live, and the form showed
 * "Finance Head must link during approval" — but five separate breaks meant such a GRN could not
 * be saved, let alone approved. Verified against production 2026-08-20: 0 of 84,782 grn_request
 * rows had is_unbudgeted = 1 and 0 of 38 grn_cost_allocation rows had a NULL budget line.
 *
 * Each test below pins one of those five breaks plus the approval control that makes allowing the
 * flow safe.
 */
describe("unbudgeted vendor GRN — raise, save, submit, link, approve", () => {
  it("break 1: the form no longer dereferences a budget line that cannot exist", () => {
    const form = readRepo("src/components/finance/grn/BudgetLinkedGrnForm.tsx");

    // The exact pre-fix expression. `.find(...)!` returned undefined for an unbudgeted GRN and
    // the next line read `.id` off it, throwing "Cannot read properties of undefined".
    expect(form).not.toContain(
      "budgetLines.find((line) => line.id === costCentreSplits[0].budgetLineId)!"
    );
    expect(form).not.toContain("attemptedLineIdRef.current = firstLine.id;");
    expect(form).toContain("attemptedLineIdRef.current = firstLine?.id ?? null;");

    // Unbudgeted skips the lookup entirely rather than relying on the optional chain.
    expect(form).toContain("? (isUnbudgetedExpense\n            ? undefined");

    // Every other path still REQUIRES a line, and now says so instead of asserting non-null.
    expect(form).toContain("if (!firstLine && !(isVendor && isUnbudgetedExpense)) {");
    expect(form).toContain("The selected budget line is no longer available.");

    // The create payload carries what replaces the budget line.
    expect(form).toContain("isUnbudgeted: isVendor && isUnbudgetedExpense ? true : undefined,");
    expect(form).toContain("head: isVendor && isUnbudgetedExpense ? form.head : undefined,");
    expect(form).toContain("subHead: isVendor && isUnbudgetedExpense ? form.subHead : undefined,");
    expect(form).toContain("unbudgetedCostCentreId");
  });

  it("break 2: createDraft accepts an unbudgeted GRN and still validates everything else", () => {
    const service = read("src/modules/finance/grn.service.ts");

    // The unconditional reject is gone, but the requirement survives for every ordinary GRN.
    expect(service).not.toContain(
      'if (!payload.budgetLineId) throw new Error("An approved budget line is required");'
    );
    expect(service).toContain("if (!isUnbudgeted && !payload.budgetLineId) {");
    expect(service).toContain('throw new Error("An approved budget line is required");');

    expect(service).toContain("async function createUnbudgetedDraft(");
    expect(service).toContain(
      "return await createUnbudgetedDraft(payload, paymentTermsDays, actorUserId, actorRole);"
    );

    // head/sub_head must be real — saveComponentAllocations reads them back off this row to build
    // its synthetic lines, so a placeholder here would mis-classify the whole GRN.
    expect(service).toContain('throw new Error("An expense head is required for an unbudgeted GRN")');
    expect(service).toContain('throw new Error("An expense sub-head is required for an unbudgeted GRN")');

    // The cost centre replaces the budget line as the branch tie, and gets the same scrutiny.
    expect(service).toContain('throw new Error("A cost centre is required for an unbudgeted GRN")');
    expect(service).toContain('throw new Error("Cost centre not found or inactive")');
    expect(service).toContain('throw new Error("Cost centre does not belong to this branch")');

    // Period-lock and financial-year rules are NOT waived just because there is no budget line.
    expect(service).toContain("is locked for P&L close. Raise this against the current open period.");
    expect(service).toContain("const financialYear = financialYearFromPeriod(accountingPeriod);");

    // The row is flagged, and carries no budget linkage.
    expect(service).toContain("is_unbudgeted, created_by, created_at)");
    expect(service).toContain('writeGrnAudit("CREATE_DRAFT_UNBUDGETED"');
  });

  it("break 3: migration 1512 relaxes the two NOT NULLs, additively and idempotently", () => {
    const sql = read("sql/1512_grn_unbudgeted_allocation_nullable.sql");
    const runner = read("src/db/runPendingMigrations.ts");

    expect(sql).toContain("MODIFY COLUMN budget_id CHAR(36)");
    expect(sql).toContain("MODIFY COLUMN budget_line_id CHAR(36)");
    // Collation restated so the only declared change is nullability — a bare MODIFY would silently
    // reset the column to the table default and break the FK.
    expect(sql).toContain("COLLATE utf8mb4_unicode_ci NULL");

    // Guarded, because migrations run at boot here: a second execution must be a no-op.
    expect(sql).toContain("information_schema.COLUMNS");
    expect(sql).toContain("IS_NULLABLE = 'NO'");
    expect(sql).toContain("PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;");

    // Nothing destructive.
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|FOREIGN\s+KEY)/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/UPDATE\s+grn_/i);

    expect(runner).toContain('"1512_grn_unbudgeted_allocation_nullable.sql"');
  });

  it("break 4: loadAllocations keeps unlinked splits instead of dropping them", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");

    // The inner joins dropped every unbudgeted row, so review() reported "no saved cost
    // allocations" — the wrong problem entirely.
    expect(service).not.toContain("JOIN finance_budget_line l ON l.id = a.budget_line_id\n       JOIN finance_budget_header h ON h.id = a.budget_id");
    expect(service).toContain("LEFT JOIN finance_budget_line l ON l.id = a.budget_line_id");
    expect(service).toContain("LEFT JOIN finance_budget_header h ON h.id = a.budget_id");

    // Locking intent is preserved on the table that is actually mutated.
    expect(service).toContain('forUpdate ? " FOR UPDATE OF a" : ""');
  });

  it("break 5: no lifecycle helper passes a null budget line to budget consumption", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");

    expect(service).toContain("function hasBudgetLine(allocation: any) {");
    expect(service).toContain(
      "return allocation.budget_line_id != null && String(allocation.budget_line_id).length > 0;"
    );

    // All four of reserve / consume / release / reverseConsumption skip an unlinked split.
    const skips = service.match(/if \(!hasBudgetLine\(allocation\)\) continue;/g) ?? [];
    expect(skips.length).toBe(4);
  });

  it("Finance Head cannot approve while any split is unlinked, but can always reject", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");

    expect(service).toContain(
      "const unlinked = allocations.filter((allocation) => !hasBudgetLine(allocation));"
    );
    expect(service).toContain("This is an unbudgeted GRN. Link an approved budget line to");

    // The gate sits inside the finance_head APPROVED arm only. If it had been hoisted above the
    // decision branch, an unbudgeted GRN could never be turned down either — a reviewer trapped
    // into linking a budget to something they want to refuse.
    const financeArm = service.slice(service.indexOf('} else if (role === "finance_head") {'));
    const gateIndex = financeArm.indexOf("This is an unbudgeted GRN.");
    const approvedIndex = financeArm.indexOf('if (decision === "approved") {');
    const rejectIndex = financeArm.indexOf("await releaseAllocations(connection, allocations);");
    expect(approvedIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeGreaterThan(approvedIndex);
    expect(gateIndex).toBeLessThan(rejectIndex);
  });

  it("linking re-applies every draft-time budget check and reserves post-Branch-Head", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    const routes = read("src/modules/finance/grn-smart.routes.ts");

    expect(service).toContain("async linkUnbudgetedBudgetLines(");

    // Only an unbudgeted GRN, and only while it is still awaiting review.
    expect(service).toContain(
      'throw new Error("This GRN was raised against an approved budget — there is nothing to link")'
    );
    expect(service).toContain('if (!["submitted", "branch_head_approved"].includes(String(grn.status)))');

    // Same branch (via lockBudgetLine), same period, same cost centre, real capacity.
    expect(service).toContain("await lockBudgetLine(connection, String(link.budgetLineId), String(grn.branch_id))");
    expect(service).toContain("does not match the accounting month");
    expect(service).toContain("that budget line belongs to a different cost centre");
    expect(service).toContain("exceeds the line's available budget of");

    // The reservation that Branch Head approval could not make is made now.
    expect(service).toContain('if (String(allocation.lifecycle_status) === "reserved") {');
    expect(service).toContain("await budgetConsumptionService.reserve(");

    // The header only reads as budgeted once nothing is left unlinked.
    expect(service).toContain("if (!stillUnlinked.length && remaining.length) {");
    expect(service).toContain('writeAuditInTransaction(\n        connection,\n        "GRN_UNBUDGETED_BUDGET_LINKED"');

    // Deciding which budget absorbs unbudgeted spend is Finance's authority, not a Branch Head's.
    expect(routes).toContain('"/:id/link-budget"');
    expect(routes).toContain("requireRole(...SMART_OVERRIDE_ROLES)");
    expect(routes).toContain("grnSmartService.linkUnbudgetedBudgetLines(");
  });

  it("the approval queue exposes the linking step and mirrors the server gate", () => {
    const queue = readRepo("src/components/finance/grn/SmartGrnApprovalQueue.tsx");

    expect(queue).toContain("/link-budget");
    expect(queue).toContain("const canLinkBudget = Boolean(capabilities?.canReviewFinanceStage);");
    expect(queue).toContain("const unlinkedAllocations = useMemo(");

    // Candidate lines are filtered to the split's own cost centre, matching the server rule.
    expect(queue).toContain('String(line.cost_centre_id ?? "") === String(alloc.cost_centre_id ?? "")');

    // Client-side mirror of the approval gate, scoped to the finance stage and to approval only.
    expect(queue).toContain('&& target.status === "branch_head_approved"');
    expect(queue).toContain("Link a budget line first");

    // Picks are per-GRN — switching target must not carry a line chosen for another GRN's split.
    expect(queue).toContain("setBudgetLinks({});");
  });
});
