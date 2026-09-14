import { describe, it, expect, beforeEach, vi } from "vitest";

import { db } from "../../../db/mysql.js";
import { createPackage, updatePackage } from "../payrollMasters.service.js";

/**
 * Creating or updating a salary package has never worked.
 *
 * createPackage wrote grade_id, slab_id, location_id, cost_centre_id,
 * basic_amt, conveyance_type, gross_monthly, ctc_monthly and effective_from.
 * salary_package_master has none of those. It is keyed by branch_name +
 * cost_centre_code + band_code and stores basic/hra/conveyance/... plus the
 * statutory columns, so every write raised ER_BAD_FIELD_ERROR.
 *
 * The UI was never wrong: NativeSalaryPackageAdmin posts exactly the real
 * columns and blocks submission without branch_name, band_code and
 * package_amount. The page and the database agreed; only the service did not.
 *
 * Confirmed on production: all 295 rows carry source_db='db_bill' and
 * created_by NULL - nothing has ever been created through this API.
 */
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

interface Captured { sql: string; params: unknown[] }

function capture(existing?: Record<string, unknown>): Captured[] {
  const calls: Captured[] = [];
  mockExecute.mockImplementation((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM salary_package_master/i.test(sql)) {
      return Promise.resolve([[existing ?? { id: "pkg-1", branch_name: "Noida", band_code: "C", package_amount: 25000 }], []]);
    }
    return Promise.resolve([{ affectedRows: 1 } as never, []]);
  });
  return calls;
}

const PHANTOM = [
  "grade_id", "slab_id", "location_id", "cost_centre_id",
  "basic_amt", "conveyance_type", "gross_monthly", "ctc_monthly", "effective_from",
];

const VALID = {
  branch_name: "Noida", cost_centre_code: "CC-OPS-01", band_code: "C",
  package_amount: 25000, basic: 10000, hra: 4000, lta: 0, gross: 21050, ctc: 23609,
};

describe("salary package writes use the real schema", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[], []]);
  });

  it("createPackage names no column the table lacks", async () => {
    const calls = capture();
    await createPackage({ ...VALID }, "user-1");
    const insert = calls.find((c) => /INSERT INTO salary_package_master/i.test(c.sql));
    expect(insert).toBeDefined();
    for (const col of PHANTOM) expect(insert!.sql).not.toContain(col);
  });

  it("createPackage writes the columns that do exist", async () => {
    const calls = capture();
    await createPackage({ ...VALID }, "user-1");
    const insert = calls.find((c) => /INSERT INTO salary_package_master/i.test(c.sql))!;
    for (const col of ["branch_name", "band_code", "package_amount", "basic", "hra", "lta", "gross", "ctc", "net_in_hand"]) {
      expect(insert.sql).toContain(col);
    }
  });

  it("records honest provenance rather than inheriting the db_bill default", async () => {
    const calls = capture();
    await createPackage({ ...VALID }, "user-1");
    const insert = calls.find((c) => /INSERT INTO salary_package_master/i.test(c.sql))!;
    expect(insert.sql).toContain("source_db");
    expect(insert.params).toContain("hrms");
  });

  it("rejects a payload missing the NOT NULL keys before touching the database", async () => {
    const calls = capture();
    await expect(
      createPackage({ band_code: "C", package_amount: 100 } as never, "user-1")
    ).rejects.toMatchObject({ statusCode: 400, code: "PACKAGE_FIELDS_REQUIRED" });
    expect(calls.some((c) => /INSERT INTO/i.test(c.sql))).toBe(false);
  });

  it("updatePackage merges over the stored row so a partial payload cannot blank a column", async () => {
    const calls = capture({
      id: "pkg-1", branch_name: "Noida", cost_centre_code: "CC-OPS-01",
      band_code: "C", package_amount: 25000, basic: 10000, hra: 4000,
    });
    await updatePackage("pkg-1", { band_code: "D" } as never);
    const update = calls.find((c) => /UPDATE salary_package_master/i.test(c.sql));
    expect(update).toBeDefined();
    for (const col of PHANTOM) expect(update!.sql).not.toContain(col);
    // basic came from the existing row, not from the partial payload
    expect(update!.params).toContain(10000);
    expect(update!.params).toContain("D");
  });

  it("coerces unparseable money to 0 rather than NaN", async () => {
    const calls = capture();
    await createPackage({ ...VALID, hra: "abc" } as never, "user-1");
    const insert = calls.find((c) => /INSERT INTO salary_package_master/i.test(c.sql))!;
    expect(insert.params.some((p) => Number.isNaN(p as number))).toBe(false);
  });
});
