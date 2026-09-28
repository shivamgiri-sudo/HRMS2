import { describe, it, expect } from "vitest";
import { buildCdrDailySql, buildAprDailySql, formatReportDate } from "../reginald-abandoned-cart-sync.service.js";

/**
 * These tests do NOT hit dialer_db directly (a live connection to it was
 * already used once, interactively, to confirm both tables/columns exist
 * and to pick the real campaign list -- see sql/1726's own comment). They
 * assert the generated SQL text is faithful to what was verified live.
 */
describe("buildCdrDailySql", () => {
  it("reads cdr_ob_25 filtered to the SOP's exact 5 campaigns, all confirmed present live", () => {
    const sql = buildCdrDailySql();
    expect(sql).toContain("FROM cdr_ob_25");
    for (const c of ["ABANDON", "KANNADA", "KERALA", "TAMIL", "TELUGU"]) {
      expect(sql).toContain(c);
    }
  });
  it("is parameterised on CallDate, never string-interpolated", () => {
    expect(buildCdrDailySql()).toContain("CallDate >= ?");
  });
});

describe("buildAprDailySql", () => {
  it("reads vicidial_agent_log_10_25 filtered to the same 5 campaigns", () => {
    const sql = buildAprDailySql();
    expect(sql).toContain("FROM vicidial_agent_log_10_25");
    for (const c of ["ABANDON", "KANNADA", "KERALA", "TAMIL", "TELUGU"]) {
      expect(sql).toContain(c);
    }
  });
  it("sums the table's own talk_sec/dispo_sec/wait_sec/dead_sec columns, confirmed live", () => {
    const sql = buildAprDailySql();
    expect(sql).toContain("SUM(talk_sec)");
    expect(sql).toContain("SUM(dispo_sec)");
    expect(sql).toContain("SUM(wait_sec)");
    expect(sql).toContain("SUM(dead_sec)");
  });
  it("is parameterised on event_time, never string-interpolated", () => {
    expect(buildAprDailySql()).toContain("event_time >= ?");
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
