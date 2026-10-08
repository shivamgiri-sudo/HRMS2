import { describe, expect, it } from "vitest";
import { allocationAccountingMonthSql, grnAccountingMonthSql, vendorAccountingMonthSql } from "../pnl-grn-month.js";

// Owner rule 2026-10-06: a GRN counts in its ACCOUNTING month, never the raised / due / bill month first.
describe("GRN accounting month", () => {
  it("grn_request: accounting_period first, dates only as the last fallback", () => {
    const sql = grnAccountingMonthSql("g");
    expect(sql.indexOf("g.accounting_period")).toBeLessThan(sql.indexOf("g.recognition_period"));
    expect(sql.indexOf("g.recognition_period")).toBeLessThan(sql.indexOf("g.bill_date"));
    expect(sql).not.toContain("created_at, '%Y-%m')) ,");
  });

  it("vendor bill: its GRN's accounting month before its own recognition month and the due date", () => {
    const sql = vendorAccountingMonthSql("vpt");
    expect(sql.indexOf("gq.accounting_period")).toBeLessThan(sql.indexOf("vpt.recognition_period"));
    expect(sql.indexOf("vpt.recognition_period")).toBeLessThan(sql.indexOf("vpt.due_date"));
  });

  it("allocation: multi-month GRNs keep the per-month split, others take the GRN's accounting month", () => {
    const sql = allocationAccountingMonthSql("a", "g");
    const [multi, single] = sql.split("ELSE");
    expect(multi.indexOf("a.recognition_period")).toBeLessThan(multi.indexOf("g.accounting_period"));
    expect(single.indexOf("g.accounting_period")).toBeLessThan(single.indexOf("a.recognition_period"));
  });
});
