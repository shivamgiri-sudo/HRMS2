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
    // Shared budget reader (pnl-budget-source.ts): NOIDA has an ACTIVE HRMS budget this month, so
    // its lines are the budget and the mirror is not consulted for NOIDA.
    if (q.includes("FROM finance_budget_header h") && q.includes("JOIN finance_budget_line l")) {
      return [[
        { budget_id: "fbh-1", branch_id: "branch-noida", branch_name: "NOIDA", line_id: "l1", allocation_id: null,
          head: "Admin", sub_head: null, item_name: "Rent", cost_centre_id: "cc-noida-1", cost_centre_code: "BSS/IB/Noida/534", amount: L(50) },
        { budget_id: "fbh-1", branch_id: "branch-noida", branch_name: "NOIDA", line_id: "l2", allocation_id: null,
          head: "Admin", sub_head: null, item_name: "Power", cost_centre_id: "cc-noida-2", cost_centre_code: "BSS/BO/Noida/999", amount: L(4) },
      ], []];
    }
    if (q.includes("FROM finance_budget_header h")) {
      return [[{ id: "fbh-1", branch_id: "branch-noida", branch_name: "NOIDA" }], []];
    }
    if (q.includes("FROM finance_budget_line_snapshot l")) {
      return [[
        { bill_source_id: 1, budget_source_id: 9, expense_type_name: "BSS/IB/Noida/534", amount: L(999), branch_name: "Noida", branch_id: "branch-noida", cost_centre_id: "cc-noida-1" },
      ], []];
    }
    if (q.includes("COUNT(l.id) AS `rows`")) {
      return [[{ rows: payrollRows, latest_synced_at: "2026-08-31 10:00:00" }], []];
    }
    // readPayroll's primary query: groups by the effective (post-override) cost centre, which is
    // either the bare column or a COALESCE wrapping it — never the branch grouping used elsewhere.
    if (q.includes("FROM salary_prep_line l") && q.includes("GROUP BY") && q.includes("cost_centre_id") && !q.includes("branch_id")) {
      return payrollRows > 0
        ? [[{ cost_centre_id: "cc-noida-1", staff: 2, amount: L(60) }], []]
        : [[], []];
    }
    // readUnallocatedPayroll's "has final payroll posted?" probe.
    if (q.includes("AS line_count") && q.includes("FROM salary_prep_line l")) {
      return [[{ line_count: payrollRows }], []];
    }
    if (q.includes("COUNT(*) AS `rows`") && q.includes("FROM pnl_running_salary_snapshot")) {
      return [[{ rows: 2, latest_synced_at: "2026-08-19 12:00:00" }], []];
    }
    if (q.includes("FROM pnl_running_salary_snapshot")) {
      return [[{ cost_centre_id: "cc-noida-1", staff: 2, amount: L(42) }], []];
    }
    // readUnallocatedPayroll / exceptions(): filtering on the effective cost centre being NULL,
    // whether that's the bare column or a COALESCE wrapping it.
    if (q.includes("cost_centre_id") && q.includes("IS NULL")) return [[{ count: 0, amount: 0 }], []];
    if (q.includes("COUNT(*) AS `rows`")) return [[{ rows: 3, latest_synced_at: "2026-08-19 09:00:00" }], []];
    return [[], []];
  });
}

beforeEach(() => vi.resetModules());

describe("P&L reconciliation — seat-rate estimate", () => {
  function mockWithSeatLines() {
    mockDb();
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      // cc-noida-2 has no invoice or provision; its last invoice billed 10 seats at 30,000.
      if (q.includes("FROM billing_invoice_particular_snapshot p") && q.includes("p.period_code >= ?")) {
        return [[
          { cost_centre_id: "cc-noida-2", period_code: "2026-07", bill_source_id: 9, service: "", particulars: "Telecalling seat", rate: 30000, qty: 10, amount: 300000 },
          { cost_centre_id: "cc-noida-1", period_code: "2026-07", bill_source_id: 8, service: "", particulars: "Inbound seat", rate: 20000, qty: 5, amount: 100000 },
        ], []];
      }
      return base(sql, params);
    });
  }

  it("estimates revenue only for a cost centre with no invoice and no provision, inside the window", async () => {
    mockWithSeatLines();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { asOfDate: "2026-09-15" });
    const unbilled = out.rows.find((row) => row.costCentreId === "cc-noida-2")!;
    const billed = out.rows.find((row) => row.costCentreId === "cc-noida-1")!;

    expect(unbilled.revenueBasis).toBe("ESTIMATED");
    expect(unbilled.revenueEstimated).toBe(L(3)); // closed month: the full 10 x 30,000
    expect(unbilled.recognisedRevenue).toBe(L(3));
    expect(unbilled.sourceStatus).toBe("ESTIMATED");
    expect(unbilled.estimateSourcePeriod).toBe("2026-07");
    expect(unbilled.issues).toContain("REVENUE_ESTIMATED_FROM_SEAT_RATE");

    // The invoiced cost centre keeps exactly its invoice-based figure.
    expect(billed.revenueBasis).toBe("INVOICE");
    expect(billed.revenueEstimated).toBe(0);
    expect(billed.recognisedRevenue).toBe(L(120));

    expect(out.totals.revenueEstimated).toBe(L(3));
    expect(out.totals.estimatedCostCentres).toBe(1);
    expect(out.blockers.join(" ")).toContain("ESTIMATED as seat rate x seats");
  });

  it("shows margin as NA when the month has estimated revenue but no people cost at all", async () => {
    mockDb({ payrollRows: 0 });
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("WITH invoice_actual AS")) return [[], []]; // nothing invoiced yet
      if (q.includes("FROM pnl_running_salary_snapshot") && !q.includes("AS `rows`")) return [[], []]; // no people cost
      if (q.includes("FROM billing_invoice_particular_snapshot p") && q.includes("p.period_code >= ?")) {
        return [[{ cost_centre_id: "cc-noida-1", period_code: "2026-08", bill_source_id: 1, service: "", particulars: "Inbound seat", rate: 30000, qty: 10, amount: 300000 }], []];
      }
      return base(sql, params);
    });
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-09", { asOfDate: "2026-09-15" });

    expect(out.totals.revenueEstimated).toBe(L(1.5)); // 15 of 30 days of 10 x 30,000
    expect(out.totals.payrollCost).toBe(0);
    expect(out.totals.marginPct).toBeNull();
    expect(out.blockers.join(" ")).toContain("margin is shown as NA");
  });

  it("never estimates a closed month outside the window", async () => {
    mockWithSeatLines();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { asOfDate: "2026-11-02" });
    const unbilled = out.rows.find((row) => row.costCentreId === "cc-noida-2")!;

    expect(unbilled.revenueBasis).toBe("NONE");
    expect(unbilled.recognisedRevenue).toBe(0);
    expect(out.estimate.applied).toBe(false);
  });
});

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
    // Budget from the shared reader: HRMS only (the mirror's L(999) for the same branch is ignored).
    expect(row?.allocatedBudget).toBe(L(50));
    expect(row?.branchBudget).toBe(L(54));
    expect(out.totals.allocatedBudget).toBe(L(54));
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

describe("P&L reconciliation — OP% scope rules (2026-09-15 OP% check)", () => {
  /** Wrap mockDb's answers, overriding the queries a test cares about. */
  function withOverrides(overrides: (q: string) => unknown[] | undefined, options?: { payrollRows?: number }) {
    mockDb(options);
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const hit = overrides(String(sql));
      return hit ? [hit, []] : base(sql, params);
    });
  }

  it("counts pay of staff with no cost centre in branch and company cost, but in no row", async () => {
    withOverrides((q) => (q.includes("cost_centre_id") && q.includes("IS NULL") && q.includes("GROUP BY e.branch_id")
      ? [{ branch_id: "branch-noida", branch_name: "NOIDA", staff: 3, amount: L(6) }]
      : undefined));
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"] });
    // Baseline: revenue 120, payroll 60 (rows), GRN 25 → OP 35. Plus Rs 6 L of unmapped staff.
    expect(out.totals.unallocatedPayroll).toBe(L(6));
    expect(out.totals.payrollCost).toBe(L(66));
    expect(out.totals.operatingProfit).toBe(L(29));
    expect(out.totals.marginPct).toBeCloseTo((29 / 120) * 100, 6);
    expect(out.branches[0]).toMatchObject({ unallocatedPayroll: L(6), payrollCost: L(66), operatingProfit: L(29) });
    expect(out.rows.reduce((t, r) => t + r.payrollCost, 0), "rows keep only what is really theirs").toBe(L(60));
    expect(out.blockers.join(" ")).toMatch(/no cost centre is included/);
  });

  it("while payroll is not posted, reads unmapped staff's ACCRUED pay from the running snapshot (audit item 13)", async () => {
    // The running snapshot DOES hold cost_centre_id = NULL rows (flushRows writes every employee).
    // They used to be dropped — readPayroll's snapshot leg skips them and this was final-run only —
    // so an open month under-counted people cost. The final-run query must not be used here.
    withOverrides((q) => {
      if (q.includes("FROM pnl_running_salary_snapshot") && q.includes("IS NULL") && q.includes("GROUP BY s.branch_id")) {
        return [{ branch_id: "branch-noida", branch_name: "NOIDA", staff: 3, amount: L(4) }];
      }
      if (q.includes("FROM salary_prep_line l") && q.includes("IS NULL") && q.includes("GROUP BY e.branch_id")) {
        return [{ branch_id: "branch-noida", branch_name: "NOIDA", staff: 3, amount: L(6) }];
      }
      return undefined;
    }, { payrollRows: 0 });
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"] });
    expect(out.totals.unallocatedPayroll, "accrued, from the snapshot — not the (absent) final run").toBe(L(4));
    // Rows: running payroll 42 on cc-noida-1. Plus 4 unallocated.
    expect(out.totals.payrollCost).toBe(L(46));
    expect(out.branches[0]).toMatchObject({ unallocatedPayroll: L(4) });
    const runningCall = execute.mock.calls.find(([sql]) => String(sql).includes("GROUP BY s.branch_id"));
    expect(runningCall?.[1], "branch filter applies to the snapshot's home branch").toEqual(["2026-08", "branch-noida"]);
  });

  it("narrows cost centres and unallocated payroll to the Client / Search processes (audit item 19)", async () => {
    mockDb();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"], processIds: ["p1", "p2"] });
    const calls = execute.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: (params ?? []) as unknown[] }));
    const ccCall = calls.find((c) => c.sql.includes("FROM cost_centre_master ccm") && c.sql.includes("LEFT JOIN branch_master"))!;
    expect(ccCall.sql).toContain("e.process_id IN (?,?)");
    expect(ccCall.params).toEqual(["branch-noida", "p1", "p2"]);
    const unallocatedCall = calls.find((c) => c.sql.includes("IS NULL") && c.sql.includes("GROUP BY e.branch_id"))!;
    expect(unallocatedCall.sql).toContain("AND e.process_id IN (?,?)");
    expect(unallocatedCall.params).toEqual(["2026-08", "branch-noida", "p1", "p2"]);
  });

  it("an explicitly empty process list matches nothing rather than everything", async () => {
    mockDb();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    await getPnlReconciliation("2026-08", { processIds: [] });
    const ccCall = execute.mock.calls.map(([sql]) => String(sql))
      .find((sql) => sql.includes("FROM cost_centre_master ccm") && sql.includes("LEFT JOIN branch_master"))!;
    expect(ccCall).toContain("1 = 0");
  });

  it("shows NA, not an inflated margin, when no GRN exists anywhere for the month", async () => {
    withOverrides((q) => (q.includes("FROM grn_cost_allocation") || q.includes("FROM grn_entry_line_snapshot") ? [] : undefined));
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-03", { branchIds: ["branch-noida"] });
    expect(out.idcMissing).toBe(true);
    expect(out.totals.grnActual).toBe(0);
    expect(out.totals.marginPct).toBeNull();
    expect(out.branches.every((b) => b.marginPct === null)).toBe(true);
    expect(out.rows.every((r) => r.marginPct === null)).toBe(true);
    expect(out.blockers.join(" ")).toMatch(/No indirect cost \(GRN\)/);
  });

  it("never reports a margin on negative revenue (credit notes above invoices)", async () => {
    withOverrides((q) => (q.includes("WITH invoice_actual AS")
      ? [{ cost_centre_id: "cc-noida-1", cost_centre_code: "BSS/IB/Noida/534", invoice_amount: L(1), provision_amount: 0, accrual_amount: 0, credit_note: L(1.27) }]
      : undefined));
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-06", { branchIds: ["branch-noida"] });
    const row = out.rows.find((r) => r.costCentreId === "cc-noida-1")!;
    expect(row.recognisedRevenue).toBeCloseTo(-L(0.27), 2);
    expect(row.marginPct).toBeNull();
    expect(out.totals.marginPct).toBeNull();
  });
});

describe("P&L reconciliation — committed GRN estimate (reserved, not yet consumed)", () => {
  function withOverrides(overrides: (q: string) => unknown[] | undefined, options?: { payrollRows?: number }) {
    mockDb(options);
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const hit = overrides(String(sql));
      return hit ? [hit, []] : base(sql, params);
    });
  }

  it("adds reserved GRN as a committed estimate inside the open window", async () => {
    withOverrides((q) => (q.includes("lifecycle_status = 'reserved'")
      ? [{ cost_centre_id: "cc-noida-2", amount: L(8) }]
      : undefined));
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"], asOfDate: "2026-09-15" });
    const row = out.rows.find((r) => r.costCentreId === "cc-noida-2")!;
    expect(row.grnEstimated).toBe(L(8));
    expect(row.issues).toContain("GRN_ESTIMATED_FROM_RESERVED");
    // cc-noida-2 has no revenue/payroll of its own, plus its existing Rs 5L mirror GRN (fixture)
    // and now Rs 8L reserved — the whole OP is both cost components together.
    expect(row.operatingProfit).toBe(-L(13));
    expect(out.totals.grnEstimated).toBe(L(8));
    expect(out.blockers.join(" ")).toMatch(/1 cost centre\(s\) also carry Rs 8\.00 L .* committed estimate/);
  });

  // Owner rule 2026-09-24: "Reserved + Consumed should be there in P&L" — for EVERY month. This
  // test used to pin the opposite (reserved dropped outside the estimate window); inverted on purpose.
  it("counts reserved GRN for a closed month outside the estimate window too", async () => {
    withOverrides((q) => (q.includes("lifecycle_status = 'reserved'")
      ? [{ cost_centre_id: "cc-noida-2", amount: L(8) }]
      : undefined));
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-03", { branchIds: ["branch-noida"], asOfDate: "2026-09-15" });
    const row = out.rows.find((r) => r.costCentreId === "cc-noida-2")!;
    expect(row.grnEstimated).toBe(L(8));
    expect(row.operatingProfit).toBe(-L(13));
    expect(out.totals.grnEstimated).toBe(L(8));
    // The seat-rate REVENUE estimate keeps its window: a closed month gets no revenue estimate.
    expect(out.estimate.applied).toBe(false);
    expect(out.totals.revenueEstimated).toBe(0);
  });

  it("reserved GRN alone (no consumed anywhere) satisfies the IDC-exists check and margin is not NA'd", async () => {
    withOverrides((q) => {
      if (q.includes("lifecycle_status = 'reserved'")) return [{ cost_centre_id: "cc-noida-1", amount: L(8) }];
      // No consumed GRN anywhere, app-side or mirror — this alone would normally trip idcMissing.
      if (q.includes("lifecycle_status = 'consumed'") || q.includes("FROM grn_entry_line_snapshot")) return [];
      return undefined;
    });
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"], asOfDate: "2026-09-15" });
    expect(out.idcMissing).toBe(false);
    expect(out.totals.marginPct).not.toBeNull();
    const row = out.rows.find((r) => r.costCentreId === "cc-noida-1")!;
    expect(row.grnActual).toBe(0);
    expect(row.grnEstimated).toBe(L(8));
    // Revenue 120, payroll 60, no consumed GRN, Rs 8L reserved GRN estimate.
    expect(row.operatingProfit).toBe(L(52));
  });

  it("with no committed GRN fixture at all, grnEstimated is zero everywhere (existing behaviour unchanged)", async () => {
    mockDb();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"], asOfDate: "2026-09-15" });
    expect(out.totals.grnEstimated).toBe(0);
    expect(out.rows.every((r) => r.grnEstimated === 0)).toBe(true);
  });
});

describe("P&L reconciliation — below-the-line (depreciation, finance cost, tax)", () => {
  function withOverrides(overrides: (q: string) => unknown[] | undefined, options?: { payrollRows?: number }) {
    mockDb(options);
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const hit = overrides(String(sql));
      return hit ? [hit, []] : base(sql, params);
    });
  }

  it("subtracts a company-wide depreciation/finance-cost/tax entry from truePat, leaving operatingProfit and marginPct untouched", async () => {
    withOverrides((q) => (q.includes("FROM process_pnl_cost_component")
      ? [
          { cost_type: "depreciation", amount: L(10) },
          { cost_type: "finance_cost", amount: L(3) },
          { cost_type: "tax", amount: L(1) },
        ]
      : undefined));
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"] });
    // Baseline: revenue 120, payroll 60, GRN 25 -> operatingProfit 35 (unchanged, contribution margin).
    expect(out.totals.operatingProfit).toBe(L(35));
    expect(out.totals.marginPct).toBeCloseTo((35 / 120) * 100, 6);
    expect(out.totals.depreciation).toBe(L(10));
    expect(out.totals.financeCost).toBe(L(3));
    expect(out.totals.taxProvision).toBe(L(1));
    expect(out.totals.belowTheLineTotal).toBe(L(14));
    // True bottom line: 35 - 14 = 21.
    expect(out.totals.truePat).toBe(L(21));
    expect(out.totals.truePatPct).toBeCloseTo((21 / 120) * 100, 6);
    // Never allocated to a row or branch.
    expect(out.rows.every((r) => !("depreciation" in r))).toBe(true);
    expect(out.branches.every((b) => !("depreciation" in b))).toBe(true);
  });

  it("filters to company-wide rows only (process_id IS NULL AND branch_id IS NULL) — never the canonical engine's per-process rows", async () => {
    mockDb();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"] });
    const call = execute.mock.calls.find(([sql]) => String(sql).includes("FROM process_pnl_cost_component"));
    expect(call, "must query process_pnl_cost_component").toBeTruthy();
    expect(String(call![0])).toContain("process_id IS NULL AND branch_id IS NULL");
    expect(String(call![0])).toContain("status = 'approved'");
  });

  it("with nothing entered, truePat equals operatingProfit and a blocker explains why", async () => {
    mockDb();
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"] });
    expect(out.totals.belowTheLineTotal).toBe(0);
    expect(out.totals.truePat).toBe(out.totals.operatingProfit);
    expect(out.blockers.join(" ")).toMatch(/Depreciation, finance cost and tax have not been entered/);
  });

  it("nulls truePatPct (not truePat) alongside marginPct when IDC data is missing company-wide", async () => {
    withOverrides((q) => (q.includes("FROM grn_cost_allocation") || q.includes("FROM grn_entry_line_snapshot") ? [] : undefined));
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-03", { branchIds: ["branch-noida"] });
    expect(out.idcMissing).toBe(true);
    expect(out.totals.marginPct).toBeNull();
    expect(out.totals.truePatPct).toBeNull();
    expect(typeof out.totals.truePat).toBe("number");
  });

  it("returns zero below-the-line figures when the table does not exist yet (pre-migration/older DB)", async () => {
    mockDb();
    tableExists.mockImplementation(async (name: string) => name !== "process_pnl_cost_component");
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"] });
    expect(out.totals.belowTheLineTotal).toBe(0);
    expect(out.totals.truePat).toBe(out.totals.operatingProfit);
  });
});

describe("P&L reconciliation — budget of a cost centre closed after the month", () => {
  it("keeps a closed, otherwise idle cost centre's period budget in allocatedBudget", async () => {
    mockDb();
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM cost_centre_master ccm") && q.includes("LEFT JOIN branch_master")) {
        const [rows] = (await base(sql, params)) as [Record<string, unknown>[], unknown];
        return [[...rows, {
          id: "cc-noida-closed", cost_centre_code: "BSS/IB/Noida/777", cost_centre_name: "Noida Closed",
          company_name: "Mas Callnet India Pvt Ltd", active_status: 0, branch_id: "branch-noida", branch_name: "NOIDA",
        }], []];
      }
      if (q.includes("FROM finance_budget_header h") && q.includes("JOIN finance_budget_line l")) {
        const [rows] = (await base(sql, params)) as [Record<string, unknown>[], unknown];
        return [[...rows, {
          budget_id: "fbh-1", branch_id: "branch-noida", branch_name: "NOIDA", line_id: "l3", allocation_id: null,
          head: "Admin", sub_head: null, item_name: "Rent", cost_centre_id: "cc-noida-closed",
          cost_centre_code: "BSS/IB/Noida/777", amount: 105000,
        }], []];
      }
      return base(sql, params);
    });
    const { getPnlReconciliation } = await import("../pnl-reconciliation.service.js");
    const out = await getPnlReconciliation("2026-08", { branchIds: ["branch-noida"], asOfDate: "2026-09-24" });

    const closed = out.rows.find((row) => row.costCentreId === "cc-noida-closed");
    expect(closed, "closed cost centre with only budget still has a row for the month").toBeDefined();
    expect(closed?.allocatedBudget).toBe(105000);
    expect(out.totals.allocatedBudget).toBe(L(54) + 105000);
  });
});
