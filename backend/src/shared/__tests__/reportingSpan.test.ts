import { describe, expect, it } from "vitest";
import { spanClauseFor } from "../reportingSpan";

describe("spanClauseFor", () => {
  it("covers direct reports and the reports of those reports", () => {
    const clause = spanClauseFor("emp-1");
    expect(clause.sql).toContain("e.reporting_manager_id = ?");
    expect(clause.sql).toContain("IN (SELECT t.id FROM employees t WHERE t.reporting_manager_id = ?)");
    expect(clause.params).toEqual(["emp-1", "emp-1"]);
  });

  it("uses the given table alias", () => {
    expect(spanClauseFor("emp-1", "x").sql).toContain("x.reporting_manager_id = ?");
  });
});
