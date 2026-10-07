import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(
  path.resolve(__dirname, "../dpdpAccessExport.service.ts"),
  "utf8",
);

describe("DPDP access export column names", () => {
  it("does not select the non-existent employees.nationality / designation / department", () => {
    expect(src).not.toMatch(/nationality/);
    expect(src).not.toMatch(/blood_group,\s+official_email/);
    expect(src).toContain("dg.designation_name AS designation");
    expect(src).toContain("dp.dept_name AS department");
    expect(src).toContain(
      "LEFT JOIN designation_master dg ON dg.id = e.designation_id",
    );
  });
  it("reads audit events from sensitive_action_log entity_type / acted_at", () => {
    expect(src).toContain(
      "SELECT action_type, entity_type AS target_type, acted_at AS created_at, ip_address",
    );
    expect(src).toContain("ORDER BY acted_at DESC");
    expect(src).not.toMatch(/SELECT action_type, target_type/);
  });
});
