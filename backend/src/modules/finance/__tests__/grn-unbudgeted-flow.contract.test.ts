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
    expect(form).toContain("isUnbudgetedExpense\n          ? undefined");

    // Every other path still REQUIRES a line, and now says so instead of asserting non-null.
    // isUnbudgetedFlow (added when the same "unbudgeted" path was extended to Imprest GRNs)
    // subsumes the original `isVendor && isUnbudgetedExpense` condition here.
    expect(form).toContain("if (!firstLine && !isUnbudgetedFlow) {");
    expect(form).toContain("The selected budget line is no longer available.");

    // The create payload carries what replaces the budget line.
    expect(form).toContain("isUnbudgeted: isUnbudgetedFlow ? true : undefined,");
    expect(form).toContain("head: isUnbudgetedFlow ? form.head : undefined,");
    expect(form).toContain("subHead: isUnbudgetedFlow ? form.subHead : undefined,");
    expect(form).toContain("unbudgetedCostCentreId");
    // isUnbudgetedExpense is grn-type-agnostic now (Imprest moved onto the same costCentreSplits
    // architecture Vendor already used), so it alone covers the vendor case; the Imprest-only
    // OR clause is legacy (isImprestUnbudgeted requires form.costCentreKey, which the current
    // Imprest UI never sets) and never fires, but stays for the retired single-line cascade.
    expect(form).toContain(
      "const isUnbudgetedFlow = isUnbudgetedExpense || (!isVendor && !splitMode && isImprestUnbudgeted);"
    );
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

  it("approval is NOT gated on linking a budget line", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    const queue = readRepo("src/components/finance/grn/SmartGrnApprovalQueue.tsx");

    /*
     * Deliberate product decision: an unbudgeted GRN approves without a budget line. Linking is
     * an option Finance Head has, never a gate.
     *
     * This test exists because the opposite once shipped here, and because the blocker is the
     * kind of thing a later reader "restores" as an obvious missing control. It is not missing.
     */
    expect(service).not.toContain("This is an unbudgeted GRN. Link an approved budget line to");
    expect(service).not.toContain(
      "const unlinked = allocations.filter((allocation) => !hasBudgetLine(allocation));"
    );
    expect(queue).not.toContain("Link a budget line first");

    /*
     * What makes approving-unlinked safe rather than a hole, and what must not regress:
     * consumeAllocations() marks EVERY row consumed — the P&L overlay aggregates on
     * lifecycle_status = 'consumed' with no dependency on budget_line_id, so the cost still
     * reaches the P&L. Only the per-line budget reservation is skipped, because no line exists.
     */
    const consumeFn = service.slice(
      service.indexOf("async function consumeAllocations("),
      service.indexOf("async function releaseAllocations(")
    );
    expect(consumeFn).toContain("if (!hasBudgetLine(allocation)) continue;");
    expect(consumeFn).toContain("SET lifecycle_status = 'consumed'");
    // The status UPDATE is unconditional across the GRN's rows — it must NOT be filtered to
    // linked ones, or unbudgeted spend would vanish from the P&L entirely.
    expect(consumeFn).not.toContain("AND budget_line_id IS NOT NULL");

    // is_unbudgeted marks spend with NO budget line behind it. It used to mark "the raiser picked
    // no line", which stopped implying the same thing once the branch-wide headroom gate began
    // funding every saved row from the aggregate — fully funded spend was being written, and
    // reported, as off-budget. Whose budget paid is its own column now (migration 1630).
    expect(service).toContain("item.line.id == null ? 1 : 0");
    expect(service).toContain("cell.line.id == null ? 1 : 0");
    expect(service).toContain("funding_cost_centre_id");
  });

  it("linking re-applies every draft-time budget check and reserves post-Branch-Head", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");
    const routes = read("src/modules/finance/grn-smart.routes.ts");

    expect(service).toContain("async linkUnbudgetedBudgetLines(");

    // Gated on the ROWS, not the header flag. Gating on is_unbudgeted made this endpoint
    // unreachable for everything saved after the headroom gate: the flag is 0 whenever the
    // aggregate funded the GRN, which is nearly always. What Finance re-points is a row funded
    // from another cost centre's line, and that is a row-level fact.
    expect(service).toContain("isRelinkable");
    expect(service).toContain(
      "Every cost-centre split on this GRN is already funded by its own cost centre's budget line"
    );
    expect(service).toContain('if (!["submitted", "branch_head_approved"].includes(String(grn.status)))');

    // Same branch (via lockBudgetLine), same period, same cost centre, real capacity.
    expect(service).toContain("await lockBudgetLine(connection, String(link.budgetLineId), String(grn.branch_id))");
    expect(service).toContain("does not match the accounting month");
    expect(service).toContain("that budget line belongs to a different cost centre");
    expect(service).toContain("exceeds the line's available budget of");

    /*
     * Quantity is re-derived against the line being linked, and reserved with that figure.
     *
     * An unbudgeted split is costed against a synthetic line with unit "amount" and unit_rate 1,
     * so its stored quantity IS the rupee amount. Reserving 52,012 of those against a line
     * approved for 12 months either fails on availability with a nonsensical message or, worse,
     * silently swallows a line's entire quantity budget on one invoice. Derived the same way
     * saveComponentAllocations() derives it: base / unit_rate.
     */
    expect(service).toContain(
      "const linkedQuantity = roundQuantity(Number(allocation.amount_without_tax) / lineUnitRate);"
    );
    // The re-derived quantity is STORED and reserved with, but it no longer decides whether the
    // link is allowed — the whole-unit count stopped being a spending control on 2026-08-27 (see
    // the banner atop budget-consumption.service.ts). The money check two assertions up
    // ("exceeds the line's available budget of") is the surviving gate.
    expect(service).not.toContain("remain approved on that line");
    expect(service).toContain("has no approved unit rate to derive a consumed quantity from");
    expect(service).toContain("quantity = ?, unit = ?, unit_rate = ?");

    // The reservation that Branch Head approval could not make is made now — with the re-derived
    // quantity, never the synthetic one.
    expect(service).toContain('if (String(allocation.lifecycle_status) === "reserved") {');
    expect(service).toContain("await budgetConsumptionService.reserve(");
    const linkBody = service.slice(service.indexOf("async linkUnbudgetedBudgetLines("));
    const reserveCall = linkBody.slice(linkBody.indexOf("await budgetConsumptionService.reserve("), linkBody.indexOf("linked.push({"));
    expect(reserveCall).toContain("linkedQuantity,");
    expect(reserveCall).not.toContain("Number(allocation.quantity)");

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

    // No client-side approval gate either — the queue must not reintroduce one the server
    // deliberately dropped.
    expect(queue).not.toContain("Link a budget line first");
    // The banner says approval is available now, rather than presenting linking as remedial.
    expect(queue).toContain("You can approve this as it");

    // Picks are per-GRN — switching target must not carry a line chosen for another GRN's split.
    expect(queue).toContain("setBudgetLinks({});");
  });
});
