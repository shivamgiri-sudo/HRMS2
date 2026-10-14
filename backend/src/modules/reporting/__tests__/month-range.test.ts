import { describe, expect, it } from "vitest";
import { MonthRangeError, planMonthRange, withMonthRange } from "../month-range.js";

describe("planMonthRange", () => {
  it("ignores reports that are not month-driven", () => {
    expect(planMonthRange("headcount", { from: "2026-01-01", to: "2026-03-01" })).toBeNull();
  });
  it("passes through when no range or an explicit month is given", () => {
    expect(planMonthRange("payroll-register", {})).toBeNull();
    expect(planMonthRange("payroll-register", { month: "2026-07", from: "2026-01-01", to: "2026-02-01" })).toBeNull();
  });
  it("expands a range to every month touched, across a year boundary", () => {
    expect(planMonthRange("payroll-register", { from: "2025-11-20", to: "2026-02-03" }))
      .toEqual({ months: ["2025-11", "2025-12", "2026-01", "2026-02"], stacked: true });
  });
  it("rejects half-filled, inverted and over-long ranges", () => {
    expect(() => planMonthRange("payroll-register", { from: "2026-01-01" })).toThrow(MonthRangeError);
    expect(() => planMonthRange("payroll-register", { from: "2026-03-01", to: "2026-01-01" })).toThrow(MonthRangeError);
    expect(() => planMonthRange("payroll-register", { from: "2024-01-01", to: "2026-01-01" })).toThrow(/12 months/);
  });
  it("accepts single-month-only layouts only inside one month", () => {
    expect(planMonthRange("pf-ecr-format", { from: "2026-07-03", to: "2026-07-20" })).toEqual({ months: ["2026-07"], stacked: false });
    expect(() => planMonthRange("pf-ecr-format", { from: "2026-07-03", to: "2026-08-02" })).toThrow(/one month at a time/);
  });
});

describe("withMonthRange", () => {
  it("runs the handler per month, tags rows and paginates the merged result", async () => {
    const seen: string[] = [];
    const handler = async (req: any, res: any) => {
      seen.push(`${req.query.month}:${req.query.limit}:${req.query.from ?? "-"}`);
      res.json({ success: true, code: "payroll-register", data: [{ id: req.query.month + "a" }, { id: req.query.month + "b" }], totalCount: 2, meta: {} });
    };
    let out: any;
    const res: any = { status() { return res; }, json(b: any) { out = b; } };
    const req: any = { params: { code: "payroll-register" }, query: { from: "2026-06-10", to: "2026-07-02", limit: "3", offset: "1" } };
    await withMonthRange(handler)(req, res, () => {});
    expect(seen).toEqual(["2026-06:4:-", "2026-07:4:-"]);
    expect(out.totalCount).toBe(4);
    expect(out.data.map((r: any) => r.id)).toEqual(["2026-06b", "2026-07a", "2026-07b"]);
    expect(out.data[0].report_month).toBe("2026-06");
  });
  it("answers 400 for an invalid range", async () => {
    let code = 0; let body: any;
    const res: any = { status(n: number) { code = n; return res; }, json(b: any) { body = b; } };
    await withMonthRange(async () => {})({ params: { code: "payroll-register" }, query: { from: "2026-06-10" } }, res, () => {});
    expect(code).toBe(400); expect(body.error).toBe("INVALID_DATE_RANGE");
  });
});

import { filterRowsByDate, planRowRange, ROW_DATE_COLUMN, rowDay } from "../month-range.js";

describe("row-date range", () => {
  it("only applies to declared reports and requires both dates", () => {
    expect(planRowRange("headcount", { from: "2026-01-01", to: "2026-02-01" })).toBeNull();
    expect(planRowRange("asset-inventory", {})).toBeNull();
    expect(planRowRange("asset-inventory", { from: "2026-01-01", to: "2026-02-01" })).toEqual({ column: "purchase_date", from: "2026-01-01", to: "2026-02-01" });
    expect(() => planRowRange("asset-inventory", { from: "2026-01-01" })).toThrow(MonthRangeError);
  });
  it("filters inclusively, reads IST for timestamps and drops rows with no date", () => {
    const rows = [
      { id: 1, purchase_date: "2026-01-01" }, { id: 2, purchase_date: "2026-02-01" },
      { id: 3, purchase_date: "2026-02-02" }, { id: 4, purchase_date: null },
      { id: 5, purchase_date: "2026-01-31T19:00:00.000Z" }, // 2026-02-01 00:30 IST
    ];
    expect(filterRowsByDate(rows, "purchase_date", "2026-01-01", "2026-02-01").map(r => r.id)).toEqual([1, 2, 5]);
    expect(rowDay("2026-01-31T19:00:00.000Z")).toBe("2026-02-01");
  });
  it("names a column for every declared report", () => {
    for (const col of Object.values(ROW_DATE_COLUMN)) expect(col).toMatch(/^[a-z_]+$/);
  });
});
