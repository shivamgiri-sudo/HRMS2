import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, tableExists } = vi.hoisted(() => ({ execute: vi.fn(), tableExists: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));

const L = (lakhs: number) => lakhs * 100000;

function mockDb(options: { payrollRows?: number } = {}) {
  const payrollRows = options.payrollRows ?? 2;
  tableExists.mockReset();
  execute.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM cost_centre_master ccm") && q.includes("LEFT JOIN branch_master")) {
      return [[
        {
          id: "cc-noida-1",
          cost_centre_code: "BSS/IB/Noida/534",
          cost_centre_name: "Noida Inbound",
          company_name: "Mas Callnet India Pvt Ltd",
          active_status: 1,
          branch_id: "branch-noida",
          branch_name: "NOIDA",
        },
        {
          id: "cc-noida-2",
          cost_centre_code: "BSS/BO/Noida/999",
          cost_centre_name: "Noida Back Office",
          company_name: "Mas Callnet India Pvt Ltd",
          active_status: 1,
          branch_id: "branch-noida",
          branch_name: "NOIDA",
        },
      ], []];
    }
    if (q.includes("WITH invoice_actual AS")) {
      return [[
        {
          cost_centre_id: "cc-noida-1",
          cost_centre_code: "BSS/IB/Noida/534",
          invoice_amount: L(100),
          provision_amount: L(130),
          accrual_amount: L(30),
          credit_note: L(10),
        },
      ], []];
    }
    if (q.includes("FROM grn_entry_line_snapshot")) {
      return [[
        { cost_centre_id: "cc-noida-1", amount: L(20) },
        { cost_centre_id: "cc-noida-2", amount: L(5) },
      ], []];
    }
    if (q.includes("FROM finance_budget_line l")) {
      return [[
        { cost_centre_id: "cc-noida-1", amount: L(50) },
        { cost_centre_id: "cc-noida-2", amount: L(4) },
      ], []];
    }
    if (q.includes("FROM finance_budget_header")) {
      return [[{ branch_id: "branch-noida", amount: L(200) }], []];
    }
    if (q.includes("COUNT(l.id) AS `rows`")) {
      return [[{ rows: payrollRows, latest_synced_at: "2026-08-31 10:00:00" }], []];
    }
    if (q.includes("FROM salary_prep_line l") && q.includes("GROUP BY e.cost_centre_id")) {
      return payrollRows > 0
        ? [[{ cost_centre_id: "cc-noida-1", staff: 2, amount: L(60) }], []]
        : [[], []];
    }
    if (q.includes("COUNT(*) AS `rows`") && q.includes("FROM pnl_running_salary_snapshot")) {
      return [[{ rows: 2, latest_synced_at: "2026-08-19 12:00:00" }], []];
    }
    if (q.includes("FROM pnl_running_salary_snapshot")) {
      return [[{ cost_centre_id: "cc-noida-1", staff: 2, amount: L(42) }], []];
    }
    if (q.includes("e.cost_centre_id IS NULL")) return [[{ count: 0, amount: 0 }], []];
    if (q.includes("COUNT(*) AS `rows`")) return [[{ rows: 3, latest_synced_at: "2026-08-19 09:00:00" }], []];
    return [[], []];
  });
}

beforeEach(() => vi.resetModules());

describe("P&L reconciliation", () => {
  it("builds active cost-centre P&L from recognised revenue, GRN, budget and payroll", async () => {
    mockDb();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"] });
    const row = out.rows.find((item) => item.costCentreId === "cc-noida-1");

    expect(row?.recognisedRevenue).toBe(L(120));
    expect(row?.revenueInvoice).toBe(L(100));
    expect(row?.revenueAccrual).toBe(L(30));
    expect(row?.creditNote).toBe(L(10));
    expect(row?.operatingProfit).toBe(L(40));
    expect(out.totals.revenue).toBe(L(120));
    expect(out.branches[0].branchName).toBe("NOIDA");
    expect(out.branches[0].operatingProfit).toBe(L(35));
  });

  it("labels an open month as live when payroll is not posted", async () => {
    mockDb({ payrollRows: 0 });
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08");

    expect(out.mode).toBe("LIVE_MTD");
    expect(out.blockers.join(" ")).toContain("Live P&L uses accrued running salary");
    expect(out.rows[0].payrollCost).toBe(L(42));
    expect(out.rows[0].issues).toContain("PAYROLL_ACCRUED_NOT_FINAL");
    expect(out.rows[0].sourceStatus).toBe("PARTIAL");
  });
});
