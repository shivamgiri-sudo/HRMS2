import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifestPath = new URL("../runPendingMigrations.ts", import.meta.url);
const bootstrapPath = new URL("../../../sql/000_run_all.sql", import.meta.url);
const migrationPath = new URL("../../../sql/460_ats_performance_indexes.sql", import.meta.url);

describe("runPendingMigrations manifest", () => {
  it("keeps ATS performance indexes registered in runtime and bootstrap order", () => {
    const manifest = readFileSync(manifestPath, "utf8");
    const bootstrap = readFileSync(bootstrapPath, "utf8");

    expect(manifest).toMatch(
      /"451_company_feed_foundation\.sql",\s*"460_ats_performance_indexes\.sql",/s,
    );
    expect(bootstrap).toMatch(
      /SOURCE sql\/451_company_feed_foundation\.sql;\s*SOURCE sql\/460_ats_performance_indexes\.sql;/s,
    );
  });

  it("preserves the expected ATS performance index statements", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("ats_recruiter_hiring_activity");
    expect(migration).toContain("idx_mobile");
    expect(migration).toContain("idx_date_created");
    expect(migration).toContain("idx_emp_mobile");
    expect(migration).toContain("idx_cand_mobile");
  });
});
