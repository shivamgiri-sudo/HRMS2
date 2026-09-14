import { describe, expect, it } from "vitest";
import { applyCopyForward, type PriorBudgetRow } from "../BranchBudgetPlannerGrid";
import type { BranchBudgetLineInput } from "@/hooks/useBranchBudget";

/**
 * Copy-forward on the branch budget planner.
 *
 * The reported defect: "Copy Jul is enabled but clicking it does nothing." It was true. The old
 * implementation only `.map()`ed over rows that already existed, and a branch opening a fresh
 * month has exactly one starter row with `head: ""`. That row matches no prior key, so it came
 * back unchanged — no rows created, nothing filled, no error. The Prev and Var cells were blank
 * on that same row for the same reason, which is why it read as two separate bugs.
 *
 * A reducer that silently does nothing is invisible in review and in the UI, so every rule it
 * follows is pinned here.
 */

const blank = (preset: Partial<BranchBudgetLineInput> = {}): BranchBudgetLineInput => ({
  attributionScope: "branch_common",
  planningLevel: "branch",
  costCentreId: null,
  processId: null,
  head: "",
  subHead: "",
  itemName: "",
  itemDescription: "",
  quantity: 1,
  unit: "Unit",
  unitRate: 0,
  taxTreatment: "exclusive",
  gstRate: 18,
  gstType: "cgst_sgst",
  recoverableTaxPct: 100,
  preferredVendorId: null,
  allocationDriver: "equal_split",
  justification: "",
  ...preset,
});

/** The preset the workspace injects — non-GST, matching the "add from masters" path. */
const makeLine = (preset: Partial<BranchBudgetLineInput>) => blank({
  taxTreatment: "non_gst", gstRate: 0, gstType: "none", recoverableTaxPct: 0,
  justification: `${preset.subHead || preset.head} for 2026-08`,
  ...preset,
});

/** A slice of the real July mirror for AHMEDABAD-JALDARSHAN. */
const JULY: PriorBudgetRow[] = [
  { head: "Communication & Connectivity", subHead: "Company Owned Data", amount: 77_500 },
  { head: "Office Rent", subHead: "Office Rent", amount: 229_517 },
  { head: "Electricity", subHead: "Electricity Govt.", amount: 160_000 },
  { head: "Staff Welfare", subHead: "Drinking Water", amount: 14_000 },
];

describe("applyCopyForward", () => {
  it("populates an empty draft — the exact case that did nothing", async () => {
    // One untouched starter row, which is what a branch with no budget yet actually has.
    const result = applyCopyForward([blank()], JULY, makeLine);
    expect(result, "clicking Copy on a fresh month must create last month's rows").toHaveLength(4);
    expect(result.map((l) => l.head)).toContain("Office Rent");
    // The starter row must not survive as a stray empty line above the budget.
    expect(result.some((l) => l.head === "")).toBe(false);
  });

  it("uses last month's amount as the rate when only a total is known", async () => {
    const result = applyCopyForward([blank()], JULY, makeLine);
    const data = result.find((l) => l.subHead === "Company Owned Data")!;
    expect(data.quantity).toBe(1);
    expect(data.unitRate).toBe(77_500);
  });

  it("preserves a real quantity x rate when the prior month has one", async () => {
    // A workspace budget carries both, so copying must not flatten 12 x 32,000 into 1 x 384,000.
    const result = applyCopyForward(
      [blank()],
      [{ head: "Repairs & Maintenance", subHead: "R&M- Ups Networking Equipment", amount: 384_000, quantity: 12, unitRate: 32_000 }],
      makeLine,
    );
    expect(result[0].quantity).toBe(12);
    expect(result[0].unitRate).toBe(32_000);
  });

  it("never overwrites a row the branch has already priced", async () => {
    // AHMEDABAD-JALDARSHAN's August draft holds this line at 40,000 against July's 77,500.
    const existing = blank({
      head: "Communication & Connectivity", subHead: "Company Owned Data",
      quantity: 1, unitRate: 40_000,
    });
    const result = applyCopyForward([existing], JULY, makeLine);
    const kept = result.find((l) => l.subHead === "Company Owned Data")!;
    expect(kept.unitRate, "the branch's own planning outranks last month's").toBe(40_000);
    expect(result).toHaveLength(4);
  });

  it("fills a matching row that exists but carries no figure", async () => {
    const empty = blank({ head: "Office Rent", subHead: "Office Rent", quantity: 0, unitRate: 0 });
    const result = applyCopyForward([empty], JULY, makeLine);
    expect(result.filter((l) => l.subHead === "Office Rent"), "must fill, not duplicate").toHaveLength(1);
    expect(result.find((l) => l.subHead === "Office Rent")!.unitRate).toBe(229_517);
  });

  it("matches an existing row regardless of casing", async () => {
    const existing = blank({ head: "office rent", subHead: "OFFICE RENT", quantity: 0, unitRate: 0 });
    const result = applyCopyForward([existing], JULY, makeLine);
    expect(result.filter((l) => l.head.toLowerCase() === "office rent")).toHaveLength(1);
  });

  it("returns the draft untouched when there is nothing to copy", async () => {
    const starter = [blank()];
    expect(applyCopyForward(starter, [], makeLine)).toBe(starter);
  });

  it("creates copied rows as non-GST, not the 18% blankLine default", async () => {
    // Otherwise the branch clears an unwanted 18% on every single copied row.
    const result = applyCopyForward([blank()], JULY, makeLine);
    expect(result.every((l) => l.taxTreatment === "non_gst" && l.gstRate === 0)).toBe(true);
  });

  it("collapses a duplicated head/sub-head into one row carrying the sum", async () => {
    // Real prior data contains duplicates — 2026-09 NOIDA-2 has several pairs twice — and the
    // Prev column sums them, so the row Copy creates has to agree with what Prev displays.
    const result = applyCopyForward([blank()], [
      { head: "Legal/Consultancy Charges", subHead: "Legal & Professional Charges", amount: 13_500 },
      { head: "Legal/Consultancy Charges", subHead: "Legal & Professional Charges", amount: 13_500 },
    ], makeLine);
    expect(result).toHaveLength(1);
    expect(result[0].quantity! * result[0].unitRate!).toBe(27_000);
  });

  it("keeps the starter row when nothing was created", async () => {
    // Every prior key already present and priced: no new rows, so the draft is left exactly as is.
    const priced = blank({ head: "Office Rent", subHead: "Office Rent", quantity: 1, unitRate: 500 });
    const result = applyCopyForward([priced], [JULY[1]], makeLine);
    expect(result).toHaveLength(1);
    expect(result[0].unitRate).toBe(500);
  });
});
