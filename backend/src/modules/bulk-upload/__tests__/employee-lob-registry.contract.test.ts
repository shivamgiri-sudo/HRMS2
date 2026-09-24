import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Registry wiring for the Employee LOB Mapping uploader: the route allow-list, the dispatcher,
 * the hub's rpc map, the migration manifest and the role gate must all agree, or the upload
 * type is selectable in the Hub but 501s (or is open to the wrong roles) at import time.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");
const ROUTES = read("../bulk-upload.routes.ts");
const DISPATCH = read("../bulk-dispatch.ts");
const HUB = read("../../../../../src/pages/BulkUploadHub.tsx");
const MANIFEST = read("../../../db/runPendingMigrations.ts");

const { hasAnyRole } = vi.hoisted(() => ({ hasAnyRole: vi.fn() }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { assertEmployeeLobUploader } from "../bulk-dispatch.js";

beforeEach(() => hasAnyRole.mockReset());

describe("Employee LOB Mapping uploader registry", () => {
  it("is on the route allow-list, the dispatcher, the hub rpc map and the migration manifest", () => {
    expect(ROUTES).toContain('"import_employee_lob_batch"');
    expect(DISPATCH).toContain('rpc_name === "import_employee_lob_batch"');
    expect(HUB).toContain('EMPLOYEE_LOB_MAPPING: "import_employee_lob_batch"');
    expect(MANIFEST).toContain('"1854_employee_lob_mapping_upload_template.sql"');
  });

  it("the route runs the role gate before queueing the import", () => {
    expect(ROUTES).toContain("await assertEmployeeLobUploader(rpc_name, req.authUser!.id);");
  });

  it("the template migration registers the two required columns only", () => {
    const sql = read("../../../../sql/1854_employee_lob_mapping_upload_template.sql");
    expect(sql).toContain("'EMPLOYEE_LOB_MAPPING'");
    expect(sql).toContain("JSON_ARRAY('employee_code', 'lob_code')");
    expect(sql).not.toMatch(/^\s*(DELETE|DROP|TRUNCATE|UPDATE)\b/im);
  });
});

describe("assertEmployeeLobUploader", () => {
  it("does nothing for other upload types", async () => {
    await expect(assertEmployeeLobUploader("import_lob_upload_batch", "u1")).resolves.toBeUndefined();
    expect(hasAnyRole).not.toHaveBeenCalled();
  });

  it("allows a WFM-LOB role", async () => {
    hasAnyRole.mockResolvedValue(true);
    await expect(assertEmployeeLobUploader("import_employee_lob_batch", "u1")).resolves.toBeUndefined();
    expect(hasAnyRole).toHaveBeenCalledWith("u1", "wfm", "wfm_spoc", "branch_wfm", "ho_wfm", "admin", "hr", "super_admin");
  });

  it("refuses other bulk-upload roles (e.g. payroll) with 403", async () => {
    hasAnyRole.mockResolvedValue(false);
    await expect(assertEmployeeLobUploader("import_employee_lob_batch", "u1")).rejects.toMatchObject({ statusCode: 403 });
  });
});
