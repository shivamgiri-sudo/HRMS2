import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner rule (2026-09-23): budget comes from HRMS (finance_budget_header/line) for every branch +
 * month that has an ACTIVE HRMS budget, and from the db_bill mirror only where it has none. One
 * reader (pnl-budget-source.ts) feeds CEO Overview, YTD, Live P&L and the budget drilldown, so
 * these pin the rule once for all of them.
 */

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));

import {
  budgetByBranchId, budgetByCostCentreId, entriesForCodes, readBudgetEntries, sumAmount, topUpsForCodes,
} from "../pnl-budget-source.js";

const PERIOD = "2026-08";

const hrmsHeaders = [{ id: "fbh-n", branch_id: "noida-2nd-spelling", branch_name: "Noida " }];
const hrmsLines = [
  // A line posted to one cost centre.
  { budget_id: "fbh-n", branch_id: "noida-2nd-spelling", branch_name: "Noida ", line_id: "l1", allocation_id: null,
    head: "Admin", sub_head: "Rent", item_name: "Floor 1", cost_centre_id: "cc-534", cost_centre_code: "BSS/IB/Noida/534", amount: 40000 },
  // A branch-level line split across two cost centres by its allocation rows.
  { budget_id: "fbh-n", branch_id: "noida-2nd-spelling", branch_name: "Noida ", line_id: "l2", allocation_id: "a1",
    head: "Utilities", sub_head: null, item_name: "Power", cost_centre_id: "cc-534", cost_centre_code: "BSS/IB/Noida/534", amount: 6000 },
  { budget_id: "fbh-n", branch_id: "noida-2nd-spelling", branch_name: "Noida ", line_id: "l2", allocation_id: "a2",
    head: "Utilities", sub_head: null, item_name: "Power", cost_centre_id: "cc-999", cost_centre_code: "BSS/BO/Noida/999", amount: 4000 },
  // A branch-level line with no allocation: branch budget, no cost centre.
  { budget_id: "fbh-n", branch_id: "noida-2nd-spelling", branch_name: "Noida ", line_id: "l3", allocation_id: null,
    head: "Admin", sub_head: null, item_name: "Common", cost_centre_id: null, cost_centre_code: null, amount: 1000 },
];
const mirrorLines = [
  // NOIDA also has mirror budget this month — must be ignored, HRMS is active for it.
  { bill_source_id: 1, budget_source_id: 10, expense_type_name: "BSS/IB/Noida/534", amount: 777777, branch_name: "NOIDA", branch_id: "noida-min-id", cost_centre_id: "cc-534" },
  // AHMEDABAD has only the mirror — kept.
  { bill_source_id: 2, budget_source_id: 20, expense_type_name: "BSS/IB/AHD/100", amount: 25000, branch_name: "AHMEDABAD", branch_id: "ahd", cost_centre_id: "cc-100" },
  { bill_source_id: 3, budget_source_id: 20, expense_type_name: "BSS/IB/AHD/101", amount: 5000, branch_name: "AHMEDABAD", branch_id: "ahd", cost_centre_id: "cc-101" },
];
const mirrorTopUps = [
  { bill_source_id: 10, reopen_additional_amount: 88888, branch_name: "NOIDA", branch_id: "noida-min-id" },
  { bill_source_id: 20, reopen_additional_amount: 3000, branch_name: "AHMEDABAD", branch_id: "ahd" },
];

function mockDb(opts: { headers?: unknown[]; lines?: unknown[] } = {}) {
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM finance_budget_header h") && q.includes("JOIN finance_budget_line l")) return [opts.lines ?? hrmsLines, []];
    if (q.includes("FROM finance_budget_header h")) return [opts.headers ?? hrmsHeaders, []];
    if (q.includes("FROM finance_budget_line_snapshot l")) return [mirrorLines, []];
    if (q.includes("reopen_additional_amount <> 0")) return [mirrorTopUps, []];
    return [[], []];
  });
}

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
});

describe("readBudgetEntries — HRMS first, mirror only where HRMS has no active budget", () => {
  it("takes a branch with an active HRMS budget from HRMS only, and every other branch from the mirror", async () => {
    mockDb();
    const entries = await readBudgetEntries(PERIOD);
    const byBranch = budgetByBranchId(entries);
    expect(byBranch.get("noida-2nd-spelling")).toBe(40000 + 6000 + 4000 + 1000);
    // The mirror's NOIDA rows (lines AND top-up) are suppressed even though the mirror resolves
    // NOIDA to a different branch_master spelling: the decision is made on the normalised name.
    expect(byBranch.has("noida-min-id")).toBe(false);
    expect(byBranch.get("ahd")).toBe(25000 + 5000 + 3000);
    expect(new Set(entries.map((e) => e.source))).toEqual(new Set(["hrms", "mirror"]));
  });

  it("uses finance_budget_header.status = 'active' as the definition of an HRMS budget", async () => {
    mockDb();
    await readBudgetEntries(PERIOD);
    const hrmsSql = execute.mock.calls.map(([s]) => String(s)).filter((s) => s.includes("FROM finance_budget_header h"));
    expect(hrmsSql.length).toBe(2);
    for (const s of hrmsSql) expect(s).toContain("h.status = 'active'");
  });

  it("falls back to the mirror for every branch when HRMS has no active budget that month", async () => {
    mockDb({ headers: [], lines: [] });
    const byBranch = budgetByBranchId(await readBudgetEntries(PERIOD));
    expect(byBranch.get("noida-min-id")).toBe(777777 + 88888);
    expect(byBranch.get("ahd")).toBe(33000);
    // No active header, so the HRMS line query is not even issued.
    expect(execute.mock.calls.some(([s]) => String(s).includes("JOIN finance_budget_line l"))).toBe(false);
  });

  it("an active HRMS header with no lines still takes the branch off the mirror (rule is 'header exists')", async () => {
    mockDb({ lines: [] });
    const byBranch = budgetByBranchId(await readBudgetEntries(PERIOD));
    expect(byBranch.get("noida-2nd-spelling") ?? 0).toBe(0);
    expect(byBranch.has("noida-min-id")).toBe(false);
  });

  it("per cost centre: HRMS lines and allocation rows by centre; no header top-up or unallocated line is given a centre", async () => {
    mockDb();
    const entries = await readBudgetEntries(PERIOD);
    const byCc = budgetByCostCentreId(entries);
    expect(byCc.get("cc-534")).toBe(46000);
    expect(byCc.get("cc-999")).toBe(4000);
    expect(byCc.get("cc-100")).toBe(25000);
    // Branch total = cost-centre total + the unattributed parts (HRMS line l3, AHD top-up).
    const ccTotal = [...byCc.values()].reduce((t, v) => t + v, 0);
    const branchTotal = [...budgetByBranchId(entries).values()].reduce((t, v) => t + v, 0);
    expect(branchTotal - ccTotal).toBe(1000 + 3000);
  });

  it("a code scope sums its lines plus only wholly-owned top-ups (focus panel / drilldown / YTD rule)", async () => {
    mockDb();
    const entries = await readBudgetEntries(PERIOD);
    expect(sumAmount(entriesForCodes(entries, ["bss/ib/noida/534"]))).toBe(46000);
    // AHD budget 20 funds 100 and 101: its top-up is shared for {100}, attributable for {100,101}.
    expect(topUpsForCodes(entries, ["BSS/IB/AHD/100"])).toEqual({ attributable: 0, shared: 3000 });
    expect(topUpsForCodes(entries, ["BSS/IB/AHD/100", "BSS/IB/AHD/101"])).toEqual({ attributable: 3000, shared: 0 });
  });

  it("rejects a malformed period without querying", async () => {
    expect(await readBudgetEntries("Aug-26")).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
