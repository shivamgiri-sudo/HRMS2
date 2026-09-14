import { describe, expect, it } from "vitest";
import { parseTargetTables } from "../migration-target-table-check.js";

/**
 * HRMS2 delta-audit, 2026-08-14 (Stage 4): the tool this pins was described
 * as built and run once against production in commit 656cc5b1 (the 1007
 * outage fix), but never actually committed — this is that tool, built for
 * real, with the exact two production incidents from that day as fixtures.
 */
describe("parseTargetTables", () => {
  it("flags INSERT INTO a table the file does not create — the exact 1007 bug", () => {
    const sql = `
      INSERT IGNORE INTO workforce_page_catalog (id, page_code, route_path)
      VALUES ('p1', 'PAYROLL_READINESS', '/payroll/readiness');
      INSERT IGNORE INTO workforce_role_page_permissions (role_key, page_id)
      VALUES ('admin', 'p1');
    `;
    const { written } = parseTargetTables(sql);
    expect(written.has("workforce_page_catalog")).toBe(true);
    expect(written.has("workforce_role_page_permissions")).toBe(true);
  });

  it("does not flag a table the migration creates itself, even when it also writes to it", () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS wfm_rest_policy (
        id CHAR(36) PRIMARY KEY
      );
      INSERT INTO wfm_rest_policy (id) VALUES (UUID());
    `;
    const { created, written } = parseTargetTables(sql);
    expect(created.has("wfm_rest_policy")).toBe(true);
    expect(written.has("wfm_rest_policy")).toBe(false);
  });

  it("flags ALTER TABLE against a table the file does not create — the 1006 shape (minus the syntax bug)", () => {
    const sql = `ALTER TABLE payroll_branch_readiness ADD COLUMN employee_count_active INT;`;
    const { written } = parseTargetTables(sql);
    expect(written.has("payroll_branch_readiness")).toBe(true);
  });

  it("ignores commented-out statements", () => {
    const sql = `
      -- INSERT INTO some_dead_table (id) VALUES (1);
      /* ALTER TABLE another_dead_table ADD COLUMN x INT; */
      CREATE TABLE IF NOT EXISTS real_table (id CHAR(36) PRIMARY KEY);
    `;
    const { written, created } = parseTargetTables(sql);
    expect(written.size).toBe(0);
    expect(created.has("real_table")).toBe(true);
  });

  it("handles backtick-quoted identifiers the same as bare ones", () => {
    const sql = "INSERT INTO `page_catalog` (id) VALUES ('p1');";
    const { written } = parseTargetTables(sql);
    expect(written.has("page_catalog")).toBe(true);
  });

  it("is case-insensitive on both keywords and table names", () => {
    const sql = "insert into Page_Catalog (id) values ('p1');";
    const { written } = parseTargetTables(sql);
    expect(written.has("page_catalog")).toBe(true);
  });

  it("REPLACE INTO is treated the same as INSERT INTO", () => {
    const sql = "REPLACE INTO some_table (id) VALUES (1);";
    const { written } = parseTargetTables(sql);
    expect(written.has("some_table")).toBe(true);
  });

  it("a clean migration against a real, existing table flags nothing", () => {
    const sql = `UPDATE data_retention_policy SET is_active = 0 WHERE entity_type IN ('leave_request') AND is_active = 1;`;
    const { written } = parseTargetTables(sql);
    expect(written.has("data_retention_policy")).toBe(true); // exists in production — the caller checks that separately
  });
});
