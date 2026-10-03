import { describe, expect, it } from "vitest";
import { inlineLimitPlaceholders as f } from "../limit-placeholders.js";

describe("inlineLimitPlaceholders", () => {
  it("inlines LIMIT ? OFFSET ? and removes those params, keeping the others in order", () => {
    expect(f("SELECT * FROM t WHERE a = ? AND b = ? ORDER BY id LIMIT ? OFFSET ?", ["x", "y", 200, 400])).toEqual({
      sql: "SELECT * FROM t WHERE a = ? AND b = ? ORDER BY id LIMIT 200 OFFSET 400",
      params: ["x", "y"],
    });
  });
  it("handles the payslip-lines shape (search params, then limit and offset)", () => {
    const r = f("SELECT spl.* FROM s WHERE spl.run_id = ? AND (c LIKE ? OR n LIKE ?) ORDER BY spl.employee_code ASC\n LIMIT ? OFFSET ?", ["run", "%a%", "%a%", 25, 0]);
    expect(r.sql).toContain("LIMIT 25 OFFSET 0");
    expect(r.params).toEqual(["run", "%a%", "%a%"]);
  });
  it("handles LIMIT ? alone and the MySQL LIMIT ?, ? form", () => {
    expect(f("SELECT 1 LIMIT ?", [5])).toEqual({ sql: "SELECT 1 LIMIT 5", params: [] });
    expect(f("SELECT 1 LIMIT ?, ?", [10, 20])).toEqual({ sql: "SELECT 1 LIMIT 10, 20", params: [] });
  });
  it("accepts digit strings, case-insensitive keywords, any whitespace", () => {
    expect(f("select 1 limit\n  ?  offset\t?", ["7", "3"]).sql).toBe("select 1 limit\n  7  offset\t3");
  });
  it("leaves unrelated placeholders alone, even when numeric", () => {
    expect(f("SELECT * FROM t WHERE n > ? AND id = ?", [5, 7])).toEqual({ sql: "SELECT * FROM t WHERE n > ? AND id = ?", params: [5, 7] });
    expect(f("SELECT * FROM t WHERE x = ? LIMIT ?", [1, 9])).toEqual({ sql: "SELECT * FROM t WHERE x = ? LIMIT 9", params: [1] });
  });
  it("never inlines anything that is not a plain non-negative integer (so it cannot carry SQL)", () => {
    for (const bad of [-1, 1.5, NaN, Infinity, "1; DROP TABLE t", "1 OR 1=1", "", "abc", null, undefined, {}, [1], 2 ** 40]) {
      const r = f("SELECT 1 LIMIT ?", [bad]);
      expect(r.sql).toBe("SELECT 1 LIMIT ?");
      expect(r.params).toEqual([bad]);
    }
  });
  it("a bad OFFSET is left bound while a good LIMIT is still inlined", () => {
    expect(f("SELECT 1 LIMIT ? OFFSET ?", [10, -5])).toEqual({ sql: "SELECT 1 LIMIT 10 OFFSET ?", params: [-5] });
  });
  it("ignores LIMIT / ? inside string literals, quoted identifiers and comments", () => {
    expect(f("SELECT 'LIMIT ?' AS s, `LIMIT ?` FROM t WHERE a = ? LIMIT ?", ["a", 3]).sql).toBe("SELECT 'LIMIT ?' AS s, `LIMIT ?` FROM t WHERE a = ? LIMIT 3");
    expect(f("SELECT 1 -- LIMIT ?\nFROM t WHERE a = ? LIMIT ?", ["a", 4]).sql).toBe("SELECT 1 -- LIMIT ?\nFROM t WHERE a = ? LIMIT 4");
    expect(f("SELECT /* LIMIT ? */ 1 FROM t WHERE a = ? LIMIT ?", ["a", 4]).sql).toBe("SELECT /* LIMIT ? */ 1 FROM t WHERE a = ? LIMIT 4");
    expect(f("SELECT 'it''s ?' FROM t LIMIT ?", [2]).sql).toBe("SELECT 'it''s ?' FROM t LIMIT 2");
  });
  it("is a no-op without params or without LIMIT/OFFSET", () => {
    expect(f("SELECT 1 LIMIT 5", undefined)).toEqual({ sql: "SELECT 1 LIMIT 5", params: undefined });
    expect(f("SELECT ?", [1])).toEqual({ sql: "SELECT ?", params: [1] });
    expect(f("SELECT 1 LIMIT 5", [])).toEqual({ sql: "SELECT 1 LIMIT 5", params: [] });
  });
  it("handles several LIMITs (subqueries) correctly", () => {
    const r = f("SELECT * FROM (SELECT id FROM a WHERE x = ? LIMIT ?) q WHERE y = ? LIMIT ? OFFSET ?", ["x", 3, "y", 10, 20]);
    expect(r).toEqual({ sql: "SELECT * FROM (SELECT id FROM a WHERE x = ? LIMIT 3) q WHERE y = ? LIMIT 10 OFFSET 20", params: ["x", "y"] });
  });
  it("does not treat a column or table named like the keyword's neighbour as a limit", () => {
    expect(f("SELECT rate_limit FROM t WHERE rate_limit = ?", [5])).toEqual({ sql: "SELECT rate_limit FROM t WHERE rate_limit = ?", params: [5] });
  });
});
