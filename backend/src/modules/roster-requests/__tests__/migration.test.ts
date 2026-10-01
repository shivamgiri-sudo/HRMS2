import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

describe("roster requests migration", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../../sql/migrations/1995_roster_request_decision_log_auto_rule.sql"), "utf8");
  it("creates the three tables idempotently", () => {
    for (const t of ["roster_request_decision_log", "roster_request_auto_rule", "roster_request_escalation"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
    expect(sql).toContain("UNIQUE KEY uq_kind_source (kind, source_id)");
    expect(sql).toContain("UNIQUE KEY uq_process_kind (process_id, kind)");
  });
});
