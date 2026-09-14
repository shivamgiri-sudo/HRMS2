import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * trainee_master.last_updated_at on the LMS's own database is datetime(3) NOT
 * NULL with no default — it only self-populates via "ON UPDATE
 * CURRENT_TIMESTAMP(3)", which does nothing for a plain INSERT. The INSERT this
 * file builds named 15 columns but never included last_updated_at, so every
 * first-time provisioning (no existing trainee_master row to hit the ON
 * DUPLICATE KEY UPDATE branch instead) failed outright: "Field
 * 'last_updated_at' doesn't have a default value". Caught by the caller as
 * best-effort, so it never failed the employee bulk import itself (see
 * employee-master-bulk-batched.test.ts's "does not fail the row when LMS
 * provisioning throws" test) — but the trainee row was never created and no
 * LMS learner was ever actually linked on a brand-new employee's first import.
 * Live-confirmed by invoking provisionLmsIdentityForEmployee directly against
 * the real HRMS + LMS databases: externalSynced was always false before this
 * fix, always true after.
 */

const { execute: hrmsExecute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: hrmsExecute } }));

const lmsConn = { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const lmsPool = { getConnection: vi.fn(async () => lmsConn) };
const { getLmsPool, upsertMapping } = vi.hoisted(() => ({
  getLmsPool: vi.fn(),
  upsertMapping: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lms.service.js", () => ({
  getLmsPool,
  lmsService: { upsertMapping },
}));

import { provisionLmsIdentityForEmployee } from "../lms-provisioning.service.js";

beforeEach(() => {
  hrmsExecute.mockReset();
  lmsConn.execute.mockReset();
  lmsConn.beginTransaction.mockReset();
  lmsConn.commit.mockReset();
  lmsConn.rollback.mockReset();
  lmsConn.release.mockReset();
  lmsPool.getConnection.mockClear();
  getLmsPool.mockReset().mockResolvedValue(lmsPool);
  upsertMapping.mockReset().mockResolvedValue(undefined);

  hrmsExecute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM employees e")) {
      return [[{ id: "emp-1", employee_code: "MAS001", first_name: "Amit", last_name: "Kumar", email: null, official_email: "amit@teammas.in", mobile: "9999999999", branch_name: "NOIDA", process_name: "ONFIDO", department_name: null }], []];
    }
    if (sql.includes("FROM lms_employee_mapping")) return [[], []];
    return [[], []];
  });
  lmsConn.execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FOR UPDATE")) return [[], []]; // no existing trainee_master row
    if (sql.includes("SELECT 1 FROM trainee_master")) return [[], []]; // learner id available
    return [{}, []]; // the INSERT itself
  });
});

describe("provisionLmsIdentityForEmployee — trainee_master INSERT", () => {
  it("includes last_updated_at in the column list and a value in VALUES, keeping placeholders aligned", async () => {
    const result = await provisionLmsIdentityForEmployee({ employeeCode: "MAS001", createdBy: "user-1" });

    expect(result.externalSynced).toBe(true);
    expect(lmsConn.commit).toHaveBeenCalledTimes(1);
    expect(lmsConn.rollback).not.toHaveBeenCalled();

    const insertCall = lmsConn.execute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO trainee_master"),
    );
    expect(insertCall, "trainee_master INSERT not found").toBeDefined();
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).toMatch(/\blast_updated_at\)/); // last column named
    expect(sql).toMatch(/NOW\(3\)\)\s*$/m); // its value literal, last in VALUES
    // 9 placeholders (id..lob) + 'Active','HRMS','PERMANENT' literals + permanent_emp_id
    // placeholder + NOW() (emp_id_mapped_at) + created_by placeholder + NOW(3)
    // (last_updated_at) = 11 bound params, matching the two remaining `?`s beyond
    // the original 9 (permanent_emp_id, created_by).
    expect(params).toHaveLength(11);
  });

  it("rolls back and reports externalSynced=false if the INSERT still fails, without throwing to the caller", async () => {
    lmsConn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FOR UPDATE")) return [[], []];
      if (sql.includes("SELECT 1 FROM trainee_master")) return [[], []];
      if (sql.includes("INSERT INTO trainee_master")) throw new Error("Field 'last_updated_at' doesn't have a default value");
      return [{}, []];
    });

    const result = await provisionLmsIdentityForEmployee({ employeeCode: "MAS001", createdBy: "user-1" });

    expect(result.externalSynced).toBe(false);
    expect(lmsConn.rollback).toHaveBeenCalledTimes(1);
    expect(lmsConn.commit).not.toHaveBeenCalled();
  });
});
