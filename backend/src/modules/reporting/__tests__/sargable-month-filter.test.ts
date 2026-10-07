import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

const { monthClause } = await import("../reporting.service.js");

/**
 * `DATE_FORMAT(col,'%Y-%m') = ?` hides the column from the index. A valid YYYY-MM is
 * rewritten to the equivalent half-open range; anything else keeps the old predicate.
 */
describe("monthClause (reporting.service)", () => {
  it("returns nothing when no month is supplied", () => {
    expect(monthClause("adr.record_date", undefined)).toEqual({
      sql: "",
      params: [],
    });
    expect(monthClause("adr.record_date", "")).toEqual({ sql: "", params: [] });
  });

  it("rewrites a valid month to a sargable half-open range", () => {
    const c = monthClause("adr.record_date", "2026-08");
    expect(c.sql).toBe(
      "AND adr.record_date >= ? AND adr.record_date < DATE_ADD(?, INTERVAL 1 MONTH)",
    );
    expect(c.params).toEqual(["2026-08-01", "2026-08-01"]);
    expect(c.sql.match(/\?/g)).toHaveLength(c.params.length);
  });

  it("handles December (rolls into next year via DATE_ADD)", () => {
    expect(monthClause("was.session_date", "2026-12").params).toEqual([
      "2026-12-01",
      "2026-12-01",
    ]);
  });

  it("keeps the original predicate for malformed input", () => {
    for (const bad of ["2026-13", "2026-00", "2026-8", "abc", "2026-08-01"]) {
      const c = monthClause("adr.record_date", bad);
      expect(c.sql).toBe("AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?");
      expect(c.params).toEqual([bad]);
    }
  });
});

describe("report builders no longer wrap the date column in DATE_FORMAT for the month filter", () => {
  const svc = readFileSync(
    new URL("../reporting.service.ts", import.meta.url),
    "utf8",
  );
  const suite = readFileSync(
    new URL("../report-suite.routes.ts", import.meta.url),
    "utf8",
  );
  it("reporting.service.ts uses monthClause", () => {
    expect(svc).not.toMatch(/f\.month \? "AND DATE_FORMAT\(/);
  });
  it("report-suite.routes.ts uses pushMonthClause for adr.record_date", () => {
    expect(suite).not.toContain(
      `clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?")`,
    );
    expect(
      suite.match(
        /pushMonthClause\(clauses, params, "adr\.record_date", month\)/g,
      ),
    ).toHaveLength(4);
  });
});
