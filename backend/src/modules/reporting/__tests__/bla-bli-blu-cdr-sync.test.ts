import { describe, it, expect } from "vitest";
import { buildDailySql, formatReportDate } from "../bla-bli-blu-cdr-sync.service.js";

/**
 * These tests do NOT hit dialer_db directly (a live connection to it was
 * already used once, interactively, to confirm the schema, the single
 * client_id='487' scoping, and that call_status/overall_call_status are
 * uniformly 'patched'/'success' across this table's whole 30-day window --
 * see sql/1728's own comment). They assert the generated SQL text is
 * faithful to what was verified live.
 */
describe("buildDailySql", () => {
  it("reads cdr_bla_bli_blu, the SmartPing cloud-dialer table confirmed live", () => {
    expect(buildDailySql()).toContain("FROM cdr_bla_bli_blu");
  });
  it("is parameterised on date_time, never string-interpolated", () => {
    expect(buildDailySql()).toContain("date_time >= ?");
  });
  it("counts unique customers/agents by the table's own customer_number/agent_name columns", () => {
    const sql = buildDailySql();
    expect(sql).toContain("COUNT(DISTINCT customer_number)");
    expect(sql).toContain("COUNT(DISTINCT agent_name)");
  });
  it("sums the table's own talk_time column", () => {
    expect(buildDailySql()).toContain("SUM(talk_time)");
  });
});

/** Same fix as inbound-cdr-sync.service.ts's formatCallDate -- toISOString() is wrong on an IST host. */
describe("formatReportDate", () => {
  it("formats a real Date object using local calendar components, not UTC", () => {
    const d = new Date(2026, 8, 10);
    expect(formatReportDate(d)).toBe("2026-09-10");
  });
  it("still accepts an already-ISO string defensively", () => {
    expect(formatReportDate("2026-09-10")).toBe("2026-09-10");
  });
});
