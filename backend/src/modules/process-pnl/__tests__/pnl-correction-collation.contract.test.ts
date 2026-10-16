import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// pnl_monthly_correction (migration 2221) has no COLLATE, so on MySQL 8 it is utf8mb4_0900_ai_ci while auth_user and
// employees are utf8mb4_unicode_ci. An unpinned join on created_by throws "Illegal mix of collations" (500 on list;
// on create/update the row is already written). Reproduced on MySQL 8.0.46 on 2026-10-16.
describe("pnl-correction routes: created_by joins pin the collation", () => {
  const src = readFileSync(join(__dirname, "..", "pnl-correction.routes.ts"), "utf8");
  const joins = src.match(/JOIN (auth_user au|employees e) ON [^\n]*pmc\.created_by[^\n]*/g) ?? [];

  it("finds all six created_by joins", () => {
    expect(joins).toHaveLength(6);
  });

  it("every one carries COLLATE utf8mb4_unicode_ci", () => {
    for (const j of joins) expect(j).toContain("pmc.created_by COLLATE utf8mb4_unicode_ci");
  });
});
