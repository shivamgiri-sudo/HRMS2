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
 * UNBUDGETED Imprest GRNs — extends the vendor-only "no approved budget line" path
 * (e2c8db0d, pinned in grn-unbudgeted-flow.contract.test.ts) to single-line Imprest GRNs.
 *
 * Before this: BudgetLinkedGrnForm.tsx hard-blocked with "No approved budget line for this
 * Head/Sub-head in this cost centre and period" for any Imprest GRN whose Head/Sub-head had
 * no matching budget line anywhere — even though headOptions/subHeadOptions had already been
 * widened to offer the full expense master, so the combination was always selectable. Split
 * mode stays hard-blocked: its picker only ever offers existing budget lines.
 *
 * The backend machinery (createUnbudgetedDraft, loadAllocations, reserve/consume/release/
 * review, the approval-queue banner) was already grnType-agnostic — the only backend gap was
 * grnSmartService.saveAllocations(), the route Imprest actually calls, which hard-required
 * allocation.budgetLineId on every row.
 */
describe("unbudgeted Imprest GRN — raise, save, submit, approve", () => {
  it("the form allows a single-line Imprest GRN with no matching budget line", () => {
    const form = readRepo("src/components/finance/grn/BudgetLinkedGrnForm.tsx");

    expect(form).toContain("const isImprestUnbudgeted =");
    expect(form).toContain(
      "const isUnbudgetedFlow = (isVendor && isUnbudgetedExpense) || (!isVendor && !splitMode && isImprestUnbudgeted);"
    );

    // The old hard block ("No approved budget line...") no longer sets a validation error for
    // single-line mode. Split mode still requires a real budget line per row.
    expect(form).not.toContain(
      'if (form.head && form.subHead && !needsItemChoice && !resolvedLine) {\n          next.budgetLineId ='
    );

    // The submit-handler guard exempts the unbudgeted case instead of always throwing.
    expect(form).toContain("if (!resolvedLine && !isImprestUnbudgeted) {");

    // Single-line row building falls back to the raw amount when there is no resolved line —
    // same unit_rate 1 / quantity = amount convention the vendor synthetic line already uses.
    expect(form).toContain("quantity: resolvedLine ? singleLine!.quantity : Number(form.amount),");
    expect(form).toContain("unitRate: resolvedLine ? Number(resolvedLine.unit_rate) : 1,");

    // The allocations PUT sends costCentreId instead of budgetLineId for the unbudgeted row.
    expect(form).toContain("costCentreId: !item.budgetLineId ? form.costCentreKey : undefined,");
  });

  it("saveAllocations() accepts an unbudgeted row instead of hard-requiring a budget line", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");

    // Read off the GRN's own stored flag, not the request body — is_unbudgeted was already
    // fixed at creation by createUnbudgetedDraft, and a GRN is never a mix of budgeted and
    // unbudgeted allocations.
    expect(service).toContain("const isUnbudgeted = Number(grn.is_unbudgeted) === 1;");

    // A budgeted allocation is still required for every ordinary GRN.
    expect(service).toContain("if (!allocation?.budgetLineId) throw new Error(`Allocation ${index + 1}: budget line is required`);");

    // An unbudgeted row requires a cost centre instead, validated against the branch exactly
    // like createUnbudgetedDraft() already validates the header's own cost centre.
    expect(service).toContain(
      "if (!allocation?.costCentreId) {\n            throw new Error(`Allocation ${index + 1}: cost centre is required for an unbudgeted allocation`);"
    );
    expect(service).toContain("cost centre not found or inactive");
    expect(service).toContain("cost centre does not belong to this branch");

    // The synthetic line mirrors saveComponentAllocations()'s vendor-unbudgeted convention:
    // unit "amount", head/sub_head read back off the GRN header.
    expect(service).toContain('unit: "amount"');
    expect(service).toContain('head: String(grn.head || "Unbudgeted"),');

    // No capacity check and nothing added to groupedUsage for an unbudgeted row — it has no
    // budget line to hold a running total against.
    expect(service).toContain("prepared.push({ line, quantity, unitRate, amounts, remarks: allocation.remarks?.trim() || null, isUnbudgeted: true });");

    // is_unbudgeted is written per allocation row, same reason the vendor path already does —
    // the NULL budget_line_id that identifies it is overwritten if a budget line is later linked.
    expect(service).toContain("pnl_cost_amount, lifecycle_status, remarks, is_unbudgeted, created_by)");
    expect(service).toContain("item.isUnbudgeted ? 1 : 0, actorUserId,");
  });

  it("reuses the already-generic backend lifecycle instead of duplicating it", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");

    // reserve/consume/release/review, loadAllocations, and the approval-queue banner were
    // already grnType-agnostic before this change — createUnbudgetedDraft/resolveCanonicalVendor
    // already special-case grnType === "imprest" (vendorId null), and saveComponentAllocations
    // stays vendor-only on purpose (invoice-component shape does not apply to Imprest).
    expect(service).toContain('if (String(grn.grn_type) !== "vendor") {');
    expect(service).toContain('throw new Error("Invoice-component GRNs are only supported for vendor GRNs");');

    const grnService = read("src/modules/finance/grn.service.ts");
    expect(grnService).toContain('if (grnType === "imprest") {');
    expect(grnService).toContain("return { vendorId: null, vendorName: null };");
  });

  it("the approval queue's unbudgeted banner is already grnType-agnostic", () => {
    const queue = readRepo("src/components/finance/grn/SmartGrnApprovalQueue.tsx");

    // Keyed on the GRN's own is_unbudgeted flag, not on grn_type — so no queue change was
    // needed to surface an unbudgeted Imprest GRN the same way an unbudgeted vendor GRN is.
    expect(queue).toContain("const isUnbudgetedTarget = Number(parent?.is_unbudgeted ?? 0) === 1;");
  });
});
