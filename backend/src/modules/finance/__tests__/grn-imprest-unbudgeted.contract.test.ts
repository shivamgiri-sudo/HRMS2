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
 * (e2c8db0d, pinned in grn-unbudgeted-flow.contract.test.ts) to Imprest GRNs, and then again
 * (this file, second revision) to MIXED GRNs: a single GRN can now carry some cost centres
 * with a real approved budget line and others with none, resolved independently per row
 * instead of a single whole-GRN is_unbudgeted flag deciding it for every row.
 *
 * History:
 *   1. Imprest originally hard-blocked any Head/Sub-head with no matching budget line at all
 *      — even though headOptions/subHeadOptions already offered the full expense master.
 *   2. That was fixed by extending the vendor cascade's whole-GRN unbudgeted flag to Imprest's
 *      single-line cascade (resolvedLine/isImprestUnbudgeted) — but still all-or-nothing.
 *   3. Imprest was then moved onto the same costCentreSplits architecture Vendor already used
 *      (percentage-based, per-cost-centre, multiple rows), which made the old single-line
 *      cascade (resolvedLine/singleLine/form.costCentreKey) permanently unreachable for
 *      Imprest — every save started throwing "Pick the exact budget line first" because
 *      nothing populated those fields any more.
 *   4. This revision: saveAllocations() (the endpoint Imprest actually calls) and
 *      saveComponentAllocations() (Vendor's) both now resolve budgeted-vs-unbudgeted per row,
 *      so one GRN can mix cost centres with and without an approved budget line under the same
 *      Head/Sub-head — the raiser is never blocked, and every unbudgeted row is flagged
 *      (grn_cost_allocation.is_unbudgeted) for later reporting on what was never budgeted.
 *   5. Group C step 2a (2026-08-22): saveAllocations() stopped letting an unbudgeted row through
 *      with no capacity check at all. It is now checked, like every budgeted row, against budget
 *      aggregated across the whole branch for its head+sub-head (budget-headroom-gate.service.ts)
 *      and funded from a REAL line found there — is_unbudgeted still records that the raiser
 *      picked no line themselves, but budget_line_id is no longer NULL waiting to be linked.
 */
describe("unbudgeted Imprest GRN — raise, save, submit, approve", () => {
  it("the form drives Imprest through costCentreSplits, never the old single-line cascade", () => {
    const form = readRepo("src/components/finance/grn/BudgetLinkedGrnForm.tsx");

    // isUnbudgetedExpense is the one authoritative "no budget anywhere for this Head/Sub-head"
    // signal now, shared by both grn types — no isVendor gate on it.
    expect(form).toContain("if (!form.head || !form.subHead) return false;");
    expect(form).toContain(
      "return vendorCostCentreGroups.length > 0 && vendorCostCentreGroups.every((g) => g.lines.length === 0);"
    );

    // A cost-centre row with no budgetLineId is not a save-blocking error any more — the
    // backend resolves it per row as an unbudgeted allocation against that row's own cost
    // centre, mixed freely with rows that do have a budget line.
    expect(form).not.toContain(
      "Select a budget line for every included cost centre — the Budget section shows which."
    );
    expect(form).toContain(
      "// An included row with no budgetLineId is not an error — the backend now resolves it"
    );

    // Imprest's rows are built straight off costCentreSplits (the same state Vendor's split
    // table drives), each row falling back to a synthetic unit_rate 1 / quantity = share
    // convention when it has no resolved budget line — the same convention the vendor
    // unbudgeted synthetic line already uses.
    // The included rows are pulled out first so their exact paise shares can be computed in one
    // go (splitIntoPaise) — same source state, same per-row fallback, just no longer a bare
    // inline .filter().map() chain.
    expect(form).toContain("const includedRows = costCentreSplits.filter((row) => row.included);");
    expect(form).toContain(
      "const quantity = line && perUnitGross > 0\n                  ? Number((shareGross / perUnitGross).toFixed(4))\n                  : Number(shareGross.toFixed(2));"
    );
    expect(form).toContain("unitRate: line ? Number(line.unit_rate) : 1,");

    // The allocations PUT sends each row's own cost centre for an unbudgeted row — not the
    // retired single-cost-centre field (form.costCentreKey), which the new UI never sets.
    expect(form).toContain("costCentreId: !item.budgetLineId ? item.costCentreKey : undefined,");
  });

  it("saveAllocations() resolves each row independently — no whole-GRN is_unbudgeted gate", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");

    // The single flag that used to force every row down the same branch is gone.
    expect(service).not.toContain("const isUnbudgeted = Number(grn.is_unbudgeted) === 1;");

    // Budgeted rows are pre-resolved (locked + period-checked) in a first pass, so an
    // unbudgeted row later in the same save can borrow a real head/sub-head/gst_type off one
    // of them.
    expect(service).toContain("const referenceLine = resolvedLines.find(Boolean) ?? null;");

    // A row with no budgetLineId is the per-row unbudgeted branch now, not a header-flag branch.
    expect(service).toContain("if (!allocation?.budgetLineId) {");
    expect(service).toContain(
      "throw new Error(`Allocation ${index + 1}: cost centre is required for an unbudgeted allocation`);"
    );
    expect(service).toContain("cost centre not found or inactive");
    expect(service).toContain("cost centre does not belong to this branch");

    // The unbudgeted row's own head/sub_head/gst_type (used to derive the money it needs funded,
    // and to look up branch-wide coverage for that head+sub-head) borrows from a budgeted row in
    // the same save when one exists, and only falls back to the GRN header's own columns (stale/
    // blank for a GRN that started out mixed) when every row in this save is unbudgeted.
    //
    // Updated for Group C step 2a (2026-08-22, branch-aggregate headroom gate): this used to be
    // one field of a synthetic `line` object that was ALSO the funding line (no capacity check at
    // all). It is now just a local used to price the row's target amount — the real funding
    // line(s) are resolved separately via getHeadSubHeadCoverage/allocateAcrossLines below, so the
    // exact source shape changed even though the borrowing rule itself did not.
    expect(service).toContain('unit: "amount"');
    expect(service).toContain(
      "head = referenceLine ? String(referenceLine.head) : String(grn.head || \"Unbudgeted\");"
    );

    // is_unbudgeted is written per allocation row, unchanged from before.
    //
    // Updated for Group C step 2a: it is NO LONGER true that budget_line_id starts NULL for an
    // unbudgeted row and gets overwritten only if Finance Head later links one — the headroom gate
    // now supplies a real funding line (drawn from the branch aggregate) at save time, so
    // budget_line_id is real from the start. is_unbudgeted is the only surviving signal that the
    // raiser themselves picked no line; it must stay independent of budget_line_id for that
    // reason, not because that column changes later.
    expect(service).toContain("pnl_cost_amount, lifecycle_status, remarks, is_unbudgeted, created_by)");
    expect(service).toContain("item.isUnbudgeted ? 1 : 0, actorUserId,");

    // The GRN header's own is_unbudgeted flag is now derived from the rows just written
    // (true if ANY row came back unbudgeted), not left untouched from create time — a GRN
    // created as an ordinary budgeted draft can still end up with an unbudgeted cost centre
    // once split, and that must route through the same stricter approval.
    expect(service).toContain("prepared.some((item) => item.isUnbudgeted) ? 1 : 0,");
  });

  it("reuses the already-generic backend lifecycle instead of duplicating it", () => {
    const service = read("src/modules/finance/grn-smart.service.ts");

    // reserve/consume/release/review, loadAllocations, and the approval-queue banner were
    // already grnType-agnostic before this change — createUnbudgetedDraft/resolveCanonicalVendor
    // already special-case grnType === "imprest" (vendorId null), and saveComponentAllocations
    // stays vendor-only on purpose (invoice-component shape does not apply to Imprest).
    expect(service).toContain('if (String(grn.grn_type) !== "vendor") {');
    expect(service).toContain('throw new Error("Invoice-component GRNs are only supported for vendor GRNs");');

    // reserve/consume/release already decide per allocation row (hasBudgetLine(allocation)),
    // not off a GRN-level flag — this is what already made a mixed GRN safe to reserve/consume/
    // release once the save-side stopped forcing all-or-nothing.
    expect(service).toContain("function hasBudgetLine(allocation: any)");
    expect(service).toContain("if (!hasBudgetLine(allocation)) continue;");

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
