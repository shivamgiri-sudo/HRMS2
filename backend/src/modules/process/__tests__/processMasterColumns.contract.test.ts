import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import { db } from "../../../db/mysql.js";
import { processRepositoryMySQL } from "../process.repository.mysql.js";

/**
 * No process could be created, renamed, or activated - through either of the two
 * endpoints that do it.
 *
 * process_master has 22 columns. process.repository.mysql.ts wrote fourteen, and
 * nine of them do not exist: department_id, branch_name, location_name,
 * process_owner_employee_id, process_manager_employee_id, description, metadata,
 * created_by, updated_by. POST /api/processes therefore returned
 * ER_BAD_FIELD_ERROR every time. update() appended `updated_by = ?`
 * unconditionally, so PUT /api/processes/:id failed whatever it contained, and
 * PATCH /:id/status failed on that same column.
 *
 * org.service.ts - the path NativeOrgMasters.tsx actually posts to, at
 * /api/org/processes - named exactly one phantom column, department_id, in both
 * its INSERT and its UPDATE. That alone was enough to make creating or editing a
 * process from the Org Masters page a 500.
 *
 * The canonical DDL agrees with production: 001_core_org.sql defines
 * process_master without any of these, and no later migration adds them.
 * Migration 199, whose name suggests otherwise, is a data migration that only
 * adds client_name.
 *
 * Verified against production 8.0.42 on a TEMPORARY copy of the real table: all
 * four old statements fail, all four new ones succeed.
 */
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

interface Captured { sql: string; params: unknown[] }

const PHANTOM_COLUMNS = [
  "department_id",
  "branch_name",
  "location_name",
  "process_owner_employee_id",
  "process_manager_employee_id",
  "description",
  "metadata",
  "created_by",
  "updated_by",
];

function capture(): Captured[] {
  const calls: Captured[] = [];
  mockExecute.mockImplementation((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/SELECT \* FROM process_master/i.test(sql) || /FROM process_master WHERE id/i.test(sql)) {
      return Promise.resolve([[{ id: "p-1", process_code: "OPS", process_name: "Ops" }], []]);
    }
    return Promise.resolve([{ affectedRows: 1 } as never, []]);
  });
  return calls;
}

describe("process_master writes name columns that exist", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([[{ id: "p-1" }], []]);
  });

  it("create names no column the table lacks", async () => {
    const calls = capture();
    await processRepositoryMySQL.create(
      { processCode: "OPS", processName: "Operations", processType: "INBOUND" } as never,
      "user-1"
    );
    const insert = calls.find((c) => /INSERT INTO process_master/i.test(c.sql));
    expect(insert).toBeDefined();
    for (const col of PHANTOM_COLUMNS) expect(insert!.sql).not.toContain(col);
    for (const col of ["process_code", "process_name", "process_type", "active_status"]) {
      expect(insert!.sql).toContain(col);
    }
  });

  it("refuses fields the table cannot store instead of dropping them silently", async () => {
    const calls = capture();
    await expect(
      processRepositoryMySQL.create(
        {
          processCode: "OPS",
          processName: "Operations",
          description: "a description with nowhere to go",
        } as never,
        "user-1"
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "PROCESS_FIELDS_UNSUPPORTED" });

    expect(calls.some((c) => /INSERT INTO process_master/i.test(c.sql))).toBe(false);
  });

  it("names the offending field so the caller knows which one", async () => {
    capture();
    await expect(
      processRepositoryMySQL.create(
        { processCode: "OPS", processName: "Ops", branchName: "Noida" } as never,
        "user-1"
      )
    ).rejects.toThrow(/branchName/);
  });

  it("update no longer appends updated_by, which failed every update", async () => {
    const calls = capture();
    await processRepositoryMySQL.update("p-1", { processName: "Renamed" } as never, "user-1");
    const update = calls.find((c) => /UPDATE process_master SET/i.test(c.sql));
    expect(update).toBeDefined();
    expect(update!.sql).not.toContain("updated_by");
    expect(update!.sql).toContain("process_name");
  });

  it("update rejects unstorable fields too", async () => {
    capture();
    await expect(
      processRepositoryMySQL.update("p-1", { locationName: "Sector 62" } as never, "user-1")
    ).rejects.toMatchObject({ statusCode: 400, code: "PROCESS_FIELDS_UNSUPPORTED" });
  });

  it("an update with nothing storable re-fetches rather than writing", async () => {
    const calls = capture();
    await processRepositoryMySQL.update("p-1", {} as never, "user-1");
    expect(calls.some((c) => /UPDATE process_master SET/i.test(c.sql))).toBe(false);
  });

  it("updateStatus writes active_status alone", async () => {
    const calls = capture();
    await processRepositoryMySQL.updateStatus("p-1", false, "user-1");
    const update = calls.find((c) => /UPDATE process_master SET active_status/i.test(c.sql));
    expect(update).toBeDefined();
    expect(update!.sql).not.toContain("updated_by");
    expect(update!.params).toEqual([0, "p-1"]);
  });
});

/**
 * The Org Masters page posts to /api/org/processes, so this is the path a real
 * user hits. It is checked at the source level because org.service builds the
 * statement inline rather than through a repository.
 */
const ORG_SERVICE = path.resolve(__dirname, "../../org/org.service.ts");

function orgProcessStatements(): string {
  const src = fs
    .readFileSync(ORG_SERVICE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  // just the two statements that touch process_master
  return (src.match(/(INSERT INTO process_master|UPDATE process_master SET)[\s\S]{0,600}/g) ?? []).join("\n");
}

describe("org.service process writes", () => {
  it("no longer name department_id, which process_master does not have", () => {
    const statements = orgProcessStatements();
    expect(statements).not.toContain("department_id");
  });

  it("still write the columns that do exist", () => {
    const statements = orgProcessStatements();
    for (const col of ["process_code", "process_name", "branch_id", "business_lob", "client_id", "client_name", "workload_type"]) {
      expect(statements).toContain(col);
    }
  });
});
