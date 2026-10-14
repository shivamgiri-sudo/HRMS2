import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query: poolQuery, execute: vi.fn(), getConnection: vi.fn() } }));
vi.mock("../payment-voucher.service.js", () => ({ paymentVoucherService: {} }));

let mod: typeof import("../money-flow.service.js");
beforeAll(async () => { mod = await import("../money-flow.service.js"); });
beforeEach(() => { poolQuery.mockReset(); });

const TODAY = "2026-10-14";
const bill = (o: Record<string, unknown> = {}) => ({
  id: "i1", bill_no: "09-192", invoice_date: "2026-09-01", grand_total: "118000.00", is_migrated: 0, last_sent_at: null,
  due_date: "2026-10-01", client_name: "Onfido", cost_centre_code: "OF/1", branch_id: "b1", branch_name: "Noida",
  s_invoice_id: null, s_received: null, s_tds: null, s_deduction: null, s_banked: null,
  cips_invoice_id: null, cips_received: null, cips_tds: null, cips_deduction: null, has_allocation: 0, credited: "0", ...o,
});

describe("toBillRow", () => {
  it("unsent HRMS bill with nothing received is 'billed, not sent' and 13 days overdue", () => {
    const r = mod.toBillRow(bill() as any, TODAY);
    expect(r).toMatchObject({ stage: "billed_not_sent", outstanding: 118000, daysOverdue: 13, ageBucket: "d0_30", settlementSource: "none" });
  });

  it("settled = received + TDS + deduction from HRMS receipts; banked only what was released", () => {
    const r = mod.toBillRow(bill({ last_sent_at: "2026-09-02", s_invoice_id: "i1", s_received: "100000.00", s_tds: "10000.00", s_deduction: "0.00", s_banked: "0.00" }) as any, TODAY);
    expect(r).toMatchObject({ stage: "part_paid", received: 100000, tds: 10000, outstanding: 8000, banked: 0, settlementSource: "receipts" });
  });

  it("falls back to Client Payments figures when no HRMS receipt exists; that money counts as banked", () => {
    const r = mod.toBillRow(bill({ is_migrated: 1, cips_invoice_id: "i1", cips_received: "106200.00", cips_tds: "11800.00", cips_deduction: "0" }) as any, TODAY);
    expect(r).toMatchObject({ stage: "paid", outstanding: 0, banked: 106200, ageBucket: null, daysOverdue: 0, settlementSource: "client_payments" });
  });

  it("HRMS receipts win over the Client Payments row", () => {
    const r = mod.toBillRow(bill({ s_invoice_id: "i1", s_received: "1000.00", s_tds: "0", s_deduction: "0", s_banked: "1000.00", cips_invoice_id: "i1", cips_received: "118000.00" }) as any, TODAY);
    expect(r.received).toBe(1000);
    expect(r.outstanding).toBe(117000);
  });

  it("a bill whose only receipt was voided does not fall back to the stale Client Payments row", () => {
    // SETTLEMENT_SQL drops void receipts, so s_* is null, but the allocation row still exists.
    const r = mod.toBillRow(bill({ has_allocation: 1, cips_invoice_id: "i1", cips_received: "118000.00", cips_tds: "0", cips_deduction: "0" }) as any, TODAY);
    expect(r).toMatchObject({ received: 0, outstanding: 118000, settlementSource: "receipts", stage: "billed_not_sent" });
  });

  it("a bill never touched by receipts still falls back to Client Payments", () => {
    const r = mod.toBillRow(bill({ has_allocation: 0, cips_invoice_id: "i1", cips_received: "118000.00", cips_tds: "0", cips_deduction: "0" }) as any, TODAY);
    expect(r).toMatchObject({ received: 118000, outstanding: 0, settlementSource: "client_payments" });
  });

  it("approved credit notes reduce outstanding; up to 50 paise left counts as paid", () => {
    const r = mod.toBillRow(bill({ s_invoice_id: "i1", s_received: "17999.60", s_tds: "0", s_deduction: "0", s_banked: "0", credited: "100000.00" }) as any, TODAY);
    expect(r).toMatchObject({ stage: "paid", outstanding: 0 });
  });

  it("I-Spark bills count as sent; not yet due lands in not_due", () => {
    const r = mod.toBillRow(bill({ is_migrated: 1, due_date: "2026-11-01" }) as any, TODAY);
    expect(r).toMatchObject({ stage: "sent_unpaid", ageBucket: "not_due", daysOverdue: 0 });
  });

  it("paise-exact sums: 0.1 + 0.2 style amounts do not drift", () => {
    const r = mod.toBillRow(bill({ grand_total: "0.30", s_invoice_id: "i1", s_received: "0.10", s_tds: "0.20", s_deduction: "0", s_banked: "0" }) as any, TODAY);
    expect(r.outstanding).toBe(0);
  });
});

describe("ageBucket", () => {
  it.each([[0, "not_due"], [1, "d0_30"], [30, "d0_30"], [31, "d31_60"], [61, "d61_90"], [91, "d90_plus"]])("%i days -> %s", (d, k) => {
    expect(mod.ageBucket(d as number)).toBe(k);
  });
});

describe("summary", () => {
  function script(bills: unknown[]) {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM client_provision")) return [[{ id: "p1", ref: "Oct-26", date: "2026-10-01", client_name: "Onfido", cost_centre_code: "OF/1", branch_name: "Noida", amount: "50000.00" }], []];
      if (sql.includes("invoice_status = 'proforma'")) return [[
        { id: "f1", ref: "PI/1", date: "2026-10-05", client_name: "Onfido", amount: "11800.00", proforma_approved_at: null },
        { id: "f2", ref: "PI/2", date: "2026-10-06", client_name: "Onfido", amount: "23600.00", proforma_approved_at: "2026-10-07" },
      ], []];
      if (sql.includes("FROM vendor_payment_tracking")) return [[{ id: "v1", grn_number: "GRN/1", vendor: "Acme", branch_name: "Noida", due_date: "2026-08-01", amount: "5000.00" }], []];
      if (sql.includes("WEEKDAY")) return [[{ week_start: "2026-10-12", recorded: "100000.00", banked: "0.00" }], []];
      if (sql.includes("pv.status = 'released'") && sql.includes("AS banked FROM client_receipt")) return [[{ banked: "0.00" }], []];
      if (sql.includes("FROM client_invoice ci")) return [bills, []];
      throw new Error(`unexpected SQL ${sql.slice(0, 80)}`);
    });
  }

  it("KPIs, funnel and ageing reconcile to the same bill rows", async () => {
    script([
      bill({ id: "a", grand_total: "118000.00" }),
      bill({ id: "b", grand_total: "59000.00", last_sent_at: "2026-09-02", s_invoice_id: "b", s_received: "50000.00", s_tds: "5900.00", s_deduction: "0", s_banked: "0" }),
      bill({ id: "c", grand_total: "236000.00", is_migrated: 1, cips_invoice_id: "c", cips_received: "212400.00", cips_tds: "23600.00", cips_deduction: "0" }),
    ]);
    const s = await mod.moneyFlowService.summary({ financeYear: "2026-27", today: TODAY, branchIds: null });
    expect(s.kpis.billed).toEqual({ count: 3, amount: 413000 });
    expect(s.kpis.received.amount).toBe(262400);
    expect(s.kpis.outstanding).toEqual({ count: 2, amount: 121100 });
    expect(s.kpis.overdue.amount).toBe(121100);
    expect(s.kpis.expected.amount).toBe(50000);
    expect(s.kpis.awaitingBank).toBe(50000);
    expect(s.kpis.payables.amount).toBe(5000);
    const f = Object.fromEntries(s.funnel.map((x) => [x.key, x.amount]));
    expect(f).toMatchObject({ provision: 50000, proforma_pending: 11800, awaiting_bill_no: 23600, billed_not_sent: 118000, part_paid: 3100, paid: 236000 });
    const ageing = s.receivablesAgeing.reduce((t, b) => t + b.amount, 0);
    expect(ageing).toBe(s.kpis.outstanding.amount);
    expect(s.payablesAgeing.find((b) => b.key === "d61_90")?.amount).toBe(5000);
    expect(s.topClients[0]).toMatchObject({ client: "Onfido", outstanding: 121100, bills: 2 });
  });

  it("a branch-scoped caller with no branch sees nothing (fail closed)", async () => {
    script([]);
    await mod.moneyFlowService.summary({ financeYear: "2026-27", today: TODAY, branchIds: [] });
    const billSql = poolQuery.mock.calls.map((c) => String(c[0])).find((q) => q.includes("FROM client_invoice ci") && q.includes("approved"));
    expect(billSql).toContain("1 = 0");
  });

  it("rejects a malformed finance year", async () => {
    script([]);
    await expect(mod.moneyFlowService.summary({ financeYear: "2026", today: TODAY })).rejects.toThrow(/2026-27/);
  });

  it("drill-down rows match the KPI", async () => {
    script([bill({ id: "a" }), bill({ id: "b", s_invoice_id: "b", s_received: "118000.00", s_tds: "0", s_deduction: "0", s_banked: "0" })]);
    const r = await mod.moneyFlowService.rows({ financeYear: "2026-27", today: TODAY }, "outstanding");
    expect(r.kind).toBe("bills");
    expect(r.rows.map((x: any) => x.id)).toEqual(["a"]);
  });
});
