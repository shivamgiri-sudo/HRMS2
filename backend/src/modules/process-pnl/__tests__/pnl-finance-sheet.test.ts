import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists, queryRows: vi.fn() }));

import {
  financeAllocationRows,
  isFinanceSheetPeriod,
  readFinanceSheetPeopleCost,
  type FinanceSheetLine,
} from "../pnl-finance-sheet.js";

const line = (o: Partial<FinanceSheetLine>): FinanceSheetLine => ({
  sheetBranch: "Noida", sheetProcess: "P", branchId: "B1", processId: "P1",
  agentSalary: 0, dscSalary: 0, bmcSalary: 0, idcTotal: 0, ...o,
});

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset().mockResolvedValue(true);
});

describe("Finance P&L sheet months (owner rule 2026-10-17)", () => {
  it("covers the months Finance closed in db_bill, up to 2026-09, and nothing from 2026-10", () => {
    expect(isFinanceSheetPeriod("2026-04")).toBe(true);
    expect(isFinanceSheetPeriod("2026-09")).toBe(true);
    expect(isFinanceSheetPeriod("2026-10")).toBe(false);
    expect(isFinanceSheetPeriod("bad")).toBe(false);
  });

  it("people cost is the sheet's agent/DSC/BMC, per branch and per mapped process, marked complete", async () => {
    execute.mockResolvedValueOnce([[
      { sheet_branch: "Noida", sheet_process: "Housing", branch_id: "B1", process_id: "P1", agent_salary: 100, dsc_salary: 20, bmc_salary: 5, idc_total: 0 },
      { sheet_branch: "Noida", sheet_process: "ALTRX", branch_id: "B1", process_id: null, agent_salary: 10, dsc_salary: 0, bmc_salary: 0, idc_total: 0 },
    ], []]);
    const people = await readFinanceSheetPeopleCost("2026-08");
    expect(people?.fromFinanceSheet).toBe(true);
    expect(people?.byBranch.get("B1")).toEqual({ agent_salary: 110, dsc_people: 20, bmc_people: 5 });
    expect(people?.byProcess.get("P1")).toEqual({ agent_salary: 100, dsc_people: 20, bmc_people: 5 });
    expect(people?.byProcess.size).toBe(1);
  });

  it("returns null, so HRMS payroll is kept, when the sheet is not loaded or the month is from 2026-10", async () => {
    execute.mockResolvedValueOnce([[], []]);
    expect(await readFinanceSheetPeopleCost("2026-08")).toBeNull();
    expect(await readFinanceSheetPeopleCost("2026-10")).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("Finance allocation = sheet IDC - db_bill operating GRNs", () => {
  it("per mapped process, with the rest of the branch in one branch row; the branch sums exactly", () => {
    const lines = [
      line({ processId: "P1", idcTotal: 1000 }),
      line({ processId: "P2", idcTotal: 500 }),
      line({ processId: null, sheetProcess: "Vacant Seats", idcTotal: 300 }),
    ];
    const grn = new Map([["B1|P1", 800], ["B1|P2", 600], ["B1|PX", 100], ["B1|", 50]]);
    const rows = financeAllocationRows(lines, grn);
    expect(rows).toEqual([
      { branchId: "B1", processId: "P1", amount: 200 },
      { branchId: "B1", processId: "P2", amount: -100 },
      { branchId: "B1", processId: null, amount: 150 },
    ]);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(1800 - 1550);
  });

  it("emits nothing for a branch whose GRNs already equal the sheet", () => {
    expect(financeAllocationRows([line({ idcTotal: 700 })], new Map([["B1|P1", 700]]))).toEqual([]);
  });

  it("ignores branches the sheet does not carry", () => {
    expect(financeAllocationRows([line({ idcTotal: 100 })], new Map([["B1|P1", 100], ["B9|", 5000]]))).toEqual([]);
  });
});
