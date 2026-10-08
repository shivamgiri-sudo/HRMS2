import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { query } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

let app: express.Express;
beforeAll(async () => {
  const { financeAnalyticsRouter } = await import("../finance-analytics.routes.js");
  app = express();
  app.use("/api/finance/analytics", financeAnalyticsRouter);
});

let inFlight = 0;
let maxInFlight = 0;
const slow = (rows: any[]) =>
  (async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return [rows, []];
  })();

beforeEach(() => {
  query.mockReset();
  inFlight = 0;
  maxInFlight = 0;
});

describe("finance analytics endpoints run independent queries concurrently", () => {
  it("snapshot: same payload, queries overlap", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("total_receivables")) {
        return slow([{ total_receivables: "600", overdue_amount: "100", overdue_count: "2" }]);
      }
      if (sql.includes("avg_monthly_collected")) return slow([{ avg_monthly_collected: "100" }]);
      if (sql.includes("company_bank_account")) return slow([{ id: 1, name: "HDFC", balance: "5.5" }]);
      if (sql.includes("total_payables")) return slow([{ total_payables: "42" }]);
      throw new Error("unexpected");
    });
    const res = await request(app).get("/api/finance/analytics/snapshot");
    expect(res.body.data).toEqual({
      total_receivables: 600,
      overdue_amount: 100,
      overdue_count: 2,
      dso: 180,
      bank_balances: [{ id: "1", name: "HDFC", balance: 5.5 }],
      total_payables: 42,
    });
    expect(maxInFlight).toBeGreaterThanOrEqual(3);
  });

  it("snapshot: a failing collected query keeps receivables but leaves dso 0", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("total_receivables")) return slow([{ total_receivables: "600", overdue_amount: "1", overdue_count: "1" }]);
      if (sql.includes("avg_monthly_collected")) return Promise.reject(new Error("boom"));
      return slow([]);
    });
    const res = await request(app).get("/api/finance/analytics/snapshot");
    expect(res.status).toBe(200);
    expect(res.body.data.total_receivables).toBe(600);
    expect(res.body.data.dso).toBe(0);
  });

  it("collection-trend: merges invoiced and collected by month", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("client_invoice")) return slow([{ month: "2026-08", invoiced: "100" }, { month: "2026-09", invoiced: "50" }]);
      return slow([{ month: "2026-09", collected: "20" }, { month: "2026-07", collected: "5" }]);
    });
    const res = await request(app).get("/api/finance/analytics/collection-trend");
    expect(res.body.data.months).toEqual([
      { month: "2026-07", invoiced: 0, collected: 5, gap: -5 },
      { month: "2026-08", invoiced: 100, collected: 0, gap: 100 },
      { month: "2026-09", invoiced: 50, collected: 20, gap: 30 },
    ]);
    expect(maxInFlight).toBe(2);
  });

  it("revenue-collections: four queries overlap and a failing one falls back alone", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("DATE_FORMAT(invoice_date")) return slow([{ month: "2026-09", invoiced: "10" }]);
      if (sql.includes("DATE_FORMAT(pay_date")) return Promise.reject(new Error("boom"));
      if (sql.includes("client_name")) return slow([{ client_name: "Acme", invoiced: "9" }]);
      return slow([{ payment_status: "paid", cnt: "2", amount: "7" }]);
    });
    const res = await request(app).get("/api/finance/analytics/revenue-collections");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      trend: [],
      clientBreakdown: [{ client_name: "Acme", invoiced: 9 }],
      paymentStatusSummary: [{ status: "paid", count: 2, amount: 7 }],
    });
    expect(maxInFlight).toBe(3);
  });

  it("payables-aging: buckets and vendors overlap", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("b0_30")) return slow([{ b0_30: "1", b31_60: "2", b61_90: "3", b90_plus: "4", total: "10" }]);
      return slow([{ vendor_name: "V", pending_amount: "10", oldest_due: "2026-01-02T00:00:00Z" }]);
    });
    const res = await request(app).get("/api/finance/analytics/payables-aging");
    expect(res.body.data).toEqual({
      buckets: { b0_30: 1, b31_60: 2, b61_90: 3, b90_plus: 4, total: 10 },
      topVendors: [{ vendor_name: "V", pending_amount: 10, oldest_due: "2026-01-02" }],
    });
    expect(maxInFlight).toBe(2);
  });

  it("expense-trends: kpi and monthly overlap", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("total_spend") && sql.includes("avg_approval_days")) {
        return slow([{ total_spend: "100", pending_payments: "5", avg_approval_days: "2.26" }]);
      }
      return slow([{ month: "2026-05", expense_head: "Rent", amount: "40" }]);
    });
    const res = await request(app).get("/api/finance/analytics/expense-trends");
    expect(res.body.data).toEqual({
      kpis: { total_spend: 100, pending_payments: 5, avg_approval_days: 2.3 },
      monthly: [{ month: "2026-05", Rent: 40 }],
      topHeads: ["Rent"],
      topVendors: [],
    });
    expect(maxInFlight).toBe(2);
  });

  it("cash-flow-forecast: returns 14 weeks with both queries overlapped", async () => {
    query.mockImplementation(() => slow([]));
    const res = await request(app).get("/api/finance/analytics/cash-flow-forecast");
    expect(res.body.data.weeks).toHaveLength(14);
    expect(maxInFlight).toBe(2);
  });
});
