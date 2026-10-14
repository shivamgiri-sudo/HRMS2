import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finance Analytics follows the Money Flow rules: the same bill rows give the same AR, overdue
 * and ageing; MAS-only; branch-scoped for non-org-wide callers; collections never double counted.
 */
const { query, policy, roles } = vi.hoisted(() => ({
  query: vi.fn(),
  policy: { orgWide: true, ownBranchId: null as string | null },
  roles: [] as string[][],
}));
vi.mock("../../../db/mysql.js", () => ({ db: { query, execute: query, getConnection: vi.fn() } }));
vi.mock("../payment-voucher.service.js", () => ({ paymentVoucherService: {} }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...r: string[]) => { roles.push(r); return (_req: any, _res: any, next: any) => next(); },
}));
vi.mock("../../../shared/branchDecisionScope.js", () => ({
  loadBranchPolicy: vi.fn(async () => ({ ...policy })),
}));

let app: express.Express;
let moneyFlow: typeof import("../money-flow.service.js");
const TODAY = "2026-10-14";
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
  const { financeAnalyticsRouter } = await import("../finance-analytics.routes.js");
  moneyFlow = await import("../money-flow.service.js");
  app = express();
  app.use("/api/finance/analytics", financeAnalyticsRouter);
});
afterAll(() => { vi.useRealTimers(); });

const bill = (o: Record<string, unknown> = {}) => ({
  id: "i1", bill_no: "09-192", invoice_date: "2026-09-01", grand_total: "118000.00", is_migrated: 0, last_sent_at: null,
  due_date: "2026-10-01", client_name: "Onfido", cost_centre_code: "OF/1", branch_id: "b1", branch_name: "Noida",
  s_invoice_id: null, s_received: null, s_tds: null, s_deduction: null, s_banked: null,
  cips_invoice_id: null, cips_received: null, cips_tds: null, cips_deduction: null, has_allocation: 0, credited: "0", ...o,
});

/** One fixture for both pages: unpaid, part paid by receipt, paid on the old screen, voided receipt, credit note. */
const FIXTURE = [
  bill({ id: "a", grand_total: "118000.00" }),
  bill({ id: "b", grand_total: "59000.00", last_sent_at: "2026-09-02", s_invoice_id: "b", s_received: "50000.00", s_tds: "5900.00", s_deduction: "0", s_banked: "0" }),
  bill({ id: "c", grand_total: "236000.00", is_migrated: 1, cips_invoice_id: "c", cips_received: "212400.00", cips_tds: "23600.00", cips_deduction: "0" }),
  // Receipt voided: no SETTLEMENT_SQL row, stale "paid" cips row must be ignored.
  bill({ id: "d", grand_total: "10000.00", client_name: "Acme", due_date: "2026-11-30", has_allocation: 1, cips_invoice_id: "d", cips_received: "10000.00", cips_tds: "0", cips_deduction: "0" }),
  bill({ id: "e", grand_total: "5000.00", client_name: "Acme", due_date: "2026-06-01", credited: "1000.00" }),
];

function script(bills: unknown[] = FIXTURE) {
  query.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("FROM client_provision")) return [[], []];
    if (s.includes("invoice_status = 'proforma'")) return [[], []];
    if (s.includes("FROM vendor_payment_tracking")) return [[{ total_payables: "42", id: "v1", amount: "42", due_date: "2026-10-20", b0_30: "42", total: "42" }], []];
    if (s.includes("WEEKDAY")) return [[], []];
    if (s.includes("AS banked FROM client_receipt")) return [[{ banked: "0" }], []];
    if (s.includes("FROM client_bill_collection_run_snapshot")) return [[{ month: "2026-01", collected: "6000.00" }], []];
    if (s.includes("FROM client_receipt r")) return [[{ month: "2026-10", collected: "6000.00" }], []];
    if (s.includes("company_bank_account")) return [[{ id: 1, name: "HDFC", balance: "5.5" }, { id: 2, name: "ICICI", balance: "4.5" }], []];
    if (s.includes("SUM(ci.grand_total) AS invoiced")) return [[{ month: "2026-09", invoiced: "100" }, { month: "2026-10", invoiced: "50" }], []];
    if (s.includes("FROM client_invoice ci")) return [bills, []];
    throw new Error(`unexpected SQL ${s.slice(0, 80)}`);
  });
}
const sqlCalls = () => query.mock.calls.map((c) => [String(c[0]), c[1]] as [string, unknown[]]);

beforeEach(() => {
  query.mockReset();
  policy.orgWide = true;
  policy.ownBranchId = null;
});

describe("Finance Analytics receivables = Money Flow", () => {
  it("snapshot AR, overdue and count equal Money Flow outstanding for the same bills", async () => {
    script();
    const mf = await moneyFlow.moneyFlowService.summary({ financeYear: "2026-27", today: TODAY, branchIds: null });
    const res = await request(app).get("/api/finance/analytics/snapshot");
    expect(res.status).toBe(200);
    // a 118000 + b 3100 + d 10000 (voided receipt) + e 4000 (credit note); c is paid.
    expect(mf.kpis.outstanding.amount).toBe(135100);
    expect(res.body.data.total_receivables).toBe(mf.kpis.outstanding.amount);
    expect(res.body.data.overdue_amount).toBe(mf.kpis.overdue.amount);
    expect(res.body.data.overdue_count).toBe(mf.kpis.overdue.count);
    // DSO on receipts + pre-receipt legacy collections: 12000 / 12 = 1000 a month.
    expect(res.body.data.dso).toBe(Math.round((135100 / 1000) * 30 * 10) / 10);
    expect(res.body.data.dso_days).toBe(res.body.data.dso);
    expect(res.body.data.bank_balance).toBe(10);
    expect(res.body.data.total_payables).toBe(42);
  });

  it("ar-aging buckets by days past due, by client label, and totals to the same AR", async () => {
    script();
    const mf = await moneyFlow.moneyFlowService.summary({ financeYear: "2026-27", today: TODAY, branchIds: null });
    const res = await request(app).get("/api/finance/analytics/ar-aging");
    const { rows, totals } = res.body.data;
    expect(totals.total).toBe(mf.kpis.outstanding.amount);
    const mfAgeing = Object.fromEntries(mf.receivablesAgeing.map((b) => [b.key, b.amount]));
    expect(totals).toMatchObject({
      current: mfAgeing.not_due, days_1_30: mfAgeing.d0_30, days_31_60: mfAgeing.d31_60,
      days_61_90: mfAgeing.d61_90, days_90_plus: mfAgeing.d90_plus,
    });
    expect(rows.map((r: any) => r.client_name)).toEqual(["Onfido", "Acme"]);
    expect(rows[1]).toMatchObject({ current: 10000, days_90_plus: 4000, d90_plus: 4000, total: 14000 });
  });

  it("bill query: MAS only, approved, receipt settlement with voucher rule, credit notes, due date", async () => {
    script();
    await request(app).get("/api/finance/analytics/snapshot");
    const billSql = sqlCalls().find(([s]) => s.includes("FROM client_invoice ci") && s.includes("has_allocation"))![0];
    expect(billSql).toContain("mascallnet");
    expect(billSql).toContain("ci.invoice_status = 'approved'");
    expect(billSql).toContain("pv.status NOT IN ('rejected', 'withdrawn')");
    expect(billSql).toContain("credit_status = 'approved'");
    expect(billSql).toContain("cc.payment_terms");
    expect(billSql).toContain("billing_client_name");
  });

  it("collections: receipts with the voucher rule; legacy snapshot only before the first receipt, MAS only", async () => {
    script();
    await request(app).get("/api/finance/analytics/collection-trend");
    const calls = sqlCalls();
    const receipts = calls.find(([s]) => s.includes("FROM client_receipt r"))![0];
    expect(receipts).toContain("r.status = 'recorded'");
    expect(receipts).toContain("pv.status NOT IN ('rejected', 'withdrawn')");
    const legacy = calls.find(([s]) => s.includes("client_bill_collection_run_snapshot"))![0];
    expect(legacy).toContain("s.pay_date < COALESCE((SELECT MIN(r0.receipt_date) FROM client_receipt r0");
    expect(legacy).toContain("mascallnet");
  });

  it("collection-trend merges billed and collected by month and keeps the page's month_label", async () => {
    script();
    const res = await request(app).get("/api/finance/analytics/collection-trend");
    expect(res.body.data.months).toEqual([
      { month: "2026-01", month_label: "Jan 26", invoiced: 0, collected: 6000, gap: -6000 },
      { month: "2026-09", month_label: "Sep 26", invoiced: 100, collected: 0, gap: 100 },
      { month: "2026-10", month_label: "Oct 26", invoiced: 50, collected: 6000, gap: -5950 },
    ]);
  });

  it("revenue-collections: client split and payment status from the same bill rows", async () => {
    script();
    const res = await request(app).get("/api/finance/analytics/revenue-collections");
    expect(res.status).toBe(200);
    const st = Object.fromEntries(res.body.data.paymentStatusSummary.map((x: any) => [x.status, x.count]));
    expect(st).toEqual({ pending: 3, partial: 1, paid: 1 });
    expect(res.body.data.clientBreakdown[0]).toEqual({ client_name: "Onfido", invoiced: 413000 });
  });

  it("cash-flow-forecast: expected in is what is still owed, in the due-date week", async () => {
    script();
    const res = await request(app).get("/api/finance/analytics/cash-flow-forecast");
    const weeks = res.body.data.weeks;
    expect(weeks).toHaveLength(14);
    expect(weeks[0].week_start).toBe("2026-10-12");
    // Only bill d (due 2026-11-30) falls inside the 14 weeks; the others are already past due.
    expect(weeks.reduce((s: number, w: any) => s + w.expected_in, 0)).toBe(10000);
    expect(weeks.find((w: any) => w.week_start === "2026-11-30").expected_in).toBe(10000);
    expect(weeks[1].expected_out).toBe(42);
  });
});

describe("access and branch scope", () => {
  it("opens to the Money Flow roles", async () => {
    const { MONEY_FLOW_ROLES } = await import("../money-flow.routes.js");
    expect(roles).toContainEqual([...MONEY_FLOW_ROLES]);
  });

  it("a branch user sees only its branch and no company bank balances", async () => {
    policy.orgWide = false;
    policy.ownBranchId = "b9";
    script();
    const res = await request(app).get("/api/finance/analytics/snapshot");
    expect(res.body.data.bank_balances).toEqual([]);
    const calls = sqlCalls();
    expect(calls.some(([s]) => s.includes("company_bank_account"))).toBe(false);
    const bills = calls.find(([s]) => s.includes("has_allocation"))!;
    expect(bills[0]).toContain("cc.branch_id IN (?)");
    expect(bills[1]).toContain("b9");
    const pay = calls.find(([s]) => s.includes("vendor_payment_tracking"))!;
    expect(pay[0]).toContain("vpt.branch_id IN (?)");
  });

  it("a non-org-wide user with no branch sees nothing (fail closed)", async () => {
    policy.orgWide = false;
    policy.ownBranchId = null;
    script();
    await request(app).get("/api/finance/analytics/ar-aging");
    expect(sqlCalls().find(([s]) => s.includes("has_allocation"))![0]).toContain("1 = 0");
  });
});
