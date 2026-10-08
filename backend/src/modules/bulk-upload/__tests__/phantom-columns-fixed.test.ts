import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Eight bulk-upload services wrote to columns that do not exist on the live schema.
 * Every row of every batch of those eight types failed with ER_BAD_FIELD_ERROR,
 * verified against live `mas_hrms` via PREPARE before each fix:
 *
 *   - asset-master-bulk.service.ts       — asset_condition / asset_status
 *   - department-master-bulk.service.ts  — cost_centre
 *   - designation-master-bulk.service.ts — level
 *   - process-master-bulk.service.ts     — lob_id (process_master has no FK to
 *                                           lob_master at all; the real column is
 *                                           the free-text business_lob)
 *   - employee-master-bulk.service.ts    — created_by
 *   - roster-assignment-bulk.service.ts  — target_record_id
 *   - shift-roster-bulk.service.ts       — target_record_id
 *   - weekoff-preference-bulk.service.ts — target_record_id
 *
 * The five approval-gated services already use the real pair the 2026 migration
 * created (created_entity_type / created_entity_id, written by linkRowToEntity in
 * bulk-approval.service.ts) — the three target_record_id fixes bring the older
 * WFM/roster services in line with that same pair.
 *
 * This is a static source check, not a live-DB one: it guards against the phantom
 * names being reintroduced, which is what a live PREPARE cannot do outside a
 * database connection.
 */

const DIR = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

/**
 * Strips `//` line comments and `/* ... *\/` block comments before a phantom-column
 * regex runs. Every one of these fixes explains itself with a comment that legitimately
 * names the old phantom column ("cost_centre was never a real column…") — asserting
 * blanket absence of the string would flag that prose, not the bug. What must actually
 * be gone is the column reference in code (an INSERT list, an UPDATE clause, a bound
 * key) — this checks that surface, not the changelog explaining it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*/, ""))
    .join("\n");
}

describe("bulk-upload services no longer write to nonexistent columns", () => {
  it("asset-master-bulk.service.ts drops asset_condition/asset_status for the real status column", () => {
    const code = stripComments(read("asset-master-bulk.service.ts"));
    expect(code).not.toMatch(/asset_condition/);
    expect(code).not.toMatch(/asset_status/);
    expect(code).toMatch(/INSERT INTO asset_master[\s\S]{0,300}\bstatus\b/);
  });

  it("department-master-bulk.service.ts drops the nonexistent cost_centre column", () => {
    const code = stripComments(read("department-master-bulk.service.ts"));
    expect(code).not.toMatch(/cost_centre/);
  });

  it("designation-master-bulk.service.ts drops the nonexistent level column", () => {
    const code = stripComments(read("designation-master-bulk.service.ts"));
    expect(code).not.toMatch(/\blevel\b/);
  });

  it("process-master-bulk.service.ts writes business_lob, not a nonexistent lob_id FK", () => {
    const code = stripComments(read("process-master-bulk.service.ts"));
    expect(code).not.toMatch(/\blob_id\b/);
    expect(code).not.toMatch(/FROM lob_master/);
    expect(code).toMatch(/business_lob/);
  });

  it("employee-master-bulk.service.ts drops the nonexistent created_by column", () => {
    const code = stripComments(read("employee-master-bulk.service.ts"));
    expect(code).not.toMatch(/\bcreated_by\b/);
  });

  it.each([
    "roster-assignment-bulk.service.ts",
    "shift-roster-bulk.service.ts",
    "weekoff-preference-bulk.service.ts",
  ])("%s writes created_entity_type/created_entity_id, not target_record_id", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/target_record_id/);
    expect(code).toMatch(/created_entity_type/);
    expect(code).toMatch(/created_entity_id/);
  });
});

describe("template-declared optional columns are no longer silently discarded", () => {
  it("branch-master-bulk.service.ts reads active_status, call_centre_code and display_name", () => {
    const src = read("branch-master-bulk.service.ts");
    expect(src).toMatch(/data\.active_status/);
    expect(src).toMatch(/data\.call_centre_code/);
    expect(src).toMatch(/data\.display_name/);
  });

  it("lob-master-bulk.service.ts reads active_status", () => {
    const src = read("lob-master-bulk.service.ts");
    expect(src).toMatch(/data\.active_status/);
  });

  it("department-master-bulk.service.ts reads active_status", () => {
    const src = read("department-master-bulk.service.ts");
    expect(src).toMatch(/data\.active_status/);
  });

  it("designation-master-bulk.service.ts reads active_status", () => {
    const src = read("designation-master-bulk.service.ts");
    expect(src).toMatch(/data\.active_status/);
  });

  it("process-master-bulk.service.ts reads business_lob, client_name and workload_type", () => {
    const src = read("process-master-bulk.service.ts");
    expect(src).toMatch(/data\.business_lob/);
    expect(src).toMatch(/data\.client_name/);
    expect(src).toMatch(/data\.workload_type/);
  });

  it("asset-master-bulk.service.ts reads status, asset_type, vendor, warranty_expiry, notes and branch_code", () => {
    const src = read("asset-master-bulk.service.ts");
    expect(src).toMatch(/data\.status/);
    expect(src).toMatch(/data\.asset_type/);
    expect(src).toMatch(/data\.vendor/);
    expect(src).toMatch(/data\.warranty_expiry/);
    expect(src).toMatch(/data\.notes/);
    expect(src).toMatch(/data\.branch_code/);
  });
});

describe("EMAIL_TEMPLATE_IMPORT is excluded from the generic Bulk Upload Hub", () => {
  it("BulkUploadHub.tsx filters it out of the templates it renders", () => {
    const src = fs.readFileSync(
      path.resolve(DIR, "..", "..", "..", "..", "src", "pages", "BulkUploadHub.tsx"),
      "utf8",
    );
    expect(src).toMatch(/EMAIL_TEMPLATE_IMPORT/);
    expect(src).toMatch(/\.filter\(/);
  });
});
