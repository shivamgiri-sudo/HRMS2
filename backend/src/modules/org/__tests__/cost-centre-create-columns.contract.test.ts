import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

/**
 * POST /api/org/cost-centres named four columns cost_centre_master does not have —
 * current_mandate, billing_days_per_month, hours_per_fte_per_day and billing_type. The migration
 * that would add them (1564_cost_centre_billing_fields.sql) has never run against mas_hrms: only
 * its working_days_per_week exists. So the statement failed outright with "Unknown column
 * 'current_mandate' in 'field list'".
 *
 * It went unnoticed because a stricter gate throws first — countOrphanedRecords() refuses the
 * whole route while any active cost centre is missing client/LOB/branch/process, and on
 * 2026-08-27 that was 401 of 401. The break was real but unreachable, waiting for the day that
 * backlog cleared.
 *
 * schema-column-refs could not catch it either: the snapshot carried the four columns, so the
 * reference looked valid. Both sides are corrected — the statement no longer names them and the
 * snapshot no longer claims they exist — and this test keeps them from coming back together.
 */
describe("org cost-centre create writes only columns the table has", () => {
  const PHANTOM = ["current_mandate", "billing_days_per_month", "hours_per_fte_per_day", "billing_type"];

  it("the INSERT names no column that is absent from cost_centre_master", () => {
    const service = read("src/modules/org/org.service.ts");
    const insert = service.slice(service.indexOf("INSERT INTO cost_centre_master"));
    const columns = insert.slice(insert.indexOf("("), insert.indexOf("VALUES"));
    for (const column of PHANTOM) {
      expect(columns).not.toContain(column);
    }
    // working_days_per_week is from the same migration but DOES exist, so it stays.
    expect(columns).toContain("working_days_per_week");
  });

  it("the schema snapshot no longer claims cost_centre_master has them", () => {
    const snapshot = JSON.parse(read("sql/schema-snapshot.json")) as {
      tables: Record<string, string[]>;
    };
    const columns = snapshot.tables.cost_centre_master;
    expect(columns).toBeDefined();
    for (const column of PHANTOM) {
      expect(columns).not.toContain(column);
    }
    expect(columns).toContain("working_days_per_week");
  });

  it("column list and placeholder count still agree", () => {
    const service = read("src/modules/org/org.service.ts");
    const insert = service.slice(service.indexOf("INSERT INTO cost_centre_master"));
    const columns = insert.slice(insert.indexOf("(") + 1, insert.indexOf("VALUES"));
    const columnCount = columns.split(",").filter((part) => part.trim().replace(/\)/g, "")).length;
    const values = insert.slice(insert.indexOf("VALUES"));
    const placeholders = (values.slice(0, values.indexOf("`")).match(/\?/g) ?? []).length;
    expect(placeholders).toBe(columnCount);
  });
});
