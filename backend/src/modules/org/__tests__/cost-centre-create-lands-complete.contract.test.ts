import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Creating a cost centre through HRMS must actually be possible, and the row it writes must
 * look like every other cost centre in the table.
 *
 * Two defects, found 2026-09-08 when the business asked why a cost centre created in HRMS does
 * not land properly:
 *
 * 1. It could not be created at all. create() refused while ANY active cost centre was missing
 *    client_id/lob_id/branch_id/process_id — 406 of 406 at the time, because nothing has ever
 *    populated client_id and lob_id (the db_bill import carries the client as TEXT in
 *    client_name). Clearing that backlog would have meant hand-creating ~650 client_master rows
 *    first: 696 distinct client names appear on cost centres and only 17 match one of the 44
 *    clients that exist. The Add button was permanently dead.
 *
 * 2. Had it worked, the row would have been the odd one out: client_name and company_name NULL,
 *    and status defaulting to 'draft' while all ~940 imported rows sit at 'active', inside an
 *    approval workflow nothing drives — so it would have stayed draft forever.
 *
 * client_name is the column the list DISPLAYS (COALESCE(cl.client_name, cc.client_name)) and
 * searches. Writing only the FK is what produced the sibling bug where searching "Satya"
 * returned nothing about a row the same screen was showing.
 */

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));
vi.mock("../../../shared/cost-centre-sync.js", () => ({
  syncCostCentreRelatedTables: vi.fn().mockResolvedValue(undefined),
}));

const { costCentreService } = await import("../org.service.js");

const VALID = {
  cost_centre_code: "BSS/OB/Noida/1046",
  cost_centre_name: "BSS/OB/Noida/1046",
  client_id: "client-1",
  lob_id: "lob-1",
  branch_id: "branch-noida",
  process_id: "process-1",
};

/** Every active cost centre is missing client_id and lob_id — the real production shape. */
function withFullOrphanBacklog() {
  dbExecute.mockImplementation(async (sql: unknown, params: unknown[]) => {
    const text = String(sql);
    if (/SUM\(CASE WHEN client_id IS NULL/i.test(text)) {
      return [[{ total: 406, orphaned: 406, missing_client: 406, missing_lob: 406,
                 missing_branch: 0, missing_process: 384 }], []];
    }
    if (/FROM client_master WHERE id = \?/i.test(text)) {
      return [[{ client_name: "SATYA E-COM SERVICES LIMITED" }], []];
    }
    if (/SELECT company_name FROM branch_master/i.test(text)) {
      return [[{ company_name: "Mas Callnet India Pvt Ltd" }], []];
    }
    if (/INSERT INTO cost_centre_master/i.test(text)) return [{ affectedRows: 1 }, []];
    if (/FROM cost_centre_master WHERE id/i.test(text)) {
      return [[{ id: "new-id", ...VALID }], []];
    }
    return [[], []];
  });
}

function insertCall() {
  const call = dbExecute.mock.calls.find(([sql]) => /INSERT INTO cost_centre_master/i.test(String(sql)));
  return { sql: String(call?.[0] ?? ""), params: (call?.[1] ?? []) as unknown[] };
}

beforeEach(() => {
  dbExecute.mockReset();
  withFullOrphanBacklog();
});

describe("creating a cost centre in HRMS", () => {
  it("is NOT blocked by the legacy backlog of incomplete cost centres", async () => {
    await expect(costCentreService.create({ ...VALID })).resolves.toBeTruthy();
    expect(insertCall().sql).toMatch(/INSERT INTO cost_centre_master/);
  });

  it("still refuses a record that is itself incomplete", async () => {
    // The gate that matters: this record, not the other 406.
    for (const missing of ["client_id", "lob_id", "branch_id", "process_id"] as const) {
      dbExecute.mockClear();
      await expect(costCentreService.create({ ...VALID, [missing]: "" }))
        .rejects.toThrow(/required/i);
      expect(insertCall().sql).toBe("");
    }
  });

  it("writes the denormalised client_name the list displays and searches", async () => {
    await costCentreService.create({ ...VALID });
    const { sql, params } = insertCall();
    expect(sql).toMatch(/client_name/);
    expect(params).toContain("SATYA E-COM SERVICES LIMITED");
  });

  it("writes company_name from the chosen branch", async () => {
    await costCentreService.create({ ...VALID });
    expect(insertCall().params).toContain("Mas Callnet India Pvt Ltd");
  });

  it("lands active, not draft", async () => {
    await costCentreService.create({ ...VALID });
    const { sql, params } = insertCall();
    // Stated explicitly rather than left to the column default, which is 'draft'. Passed as a
    // bound parameter so the column/placeholder count invariant in
    // cost-centre-create-columns.contract.test.ts still holds.
    expect(sql).toMatch(/status/);
    expect(sql).toMatch(/active_status/);
    expect(params).toContain("active");
    expect(params).toContain(1);
  });

  it("carries every relationship the form collected into the row", async () => {
    await costCentreService.create({ ...VALID, department_id: "dept-1" });
    const { params } = insertCall();
    for (const v of ["client-1", "lob-1", "branch-noida", "process-1", "dept-1"]) {
      expect(params).toContain(v);
    }
  });
});

describe("re-assigning a cost centre keeps the client text in step with the FK", () => {
  it("update() re-points client_name whenever client_id is supplied", async () => {
    await costCentreService.update("cc-1", { client_id: "client-2" });
    const call = dbExecute.mock.calls.find(([sql]) => /UPDATE cost_centre_master SET/i.test(String(sql)));
    expect(String(call?.[0])).toMatch(/client_name = CASE/);
  });

  it("update() leaves client_name alone when no client is supplied", async () => {
    await costCentreService.update("cc-1", { cost_centre_name: "Renamed" });
    const call = dbExecute.mock.calls.find(([sql]) => /UPDATE cost_centre_master SET/i.test(String(sql)));
    // The CASE is always present; what matters is that a null client_id selects the
    // "keep what is there" branch rather than blanking the column.
    expect(String(call?.[0])).toMatch(/WHEN NULLIF\(\?, ''\) IS NULL THEN client_name/);
  });

  it("migrate() carries client_name across with client_id", async () => {
    await costCentreService.migrate("cc-1", {
      client_id: "client-2", lob_id: "lob-1", branch_id: "branch-noida", process_id: "process-1",
    });
    const call = dbExecute.mock.calls.find(([sql]) => /UPDATE cost_centre_master SET/i.test(String(sql)));
    expect(String(call?.[0])).toMatch(/client_name = COALESCE\(\(SELECT cl\.client_name/);
  });
});

describe("the migration banner reports which relationship is missing", () => {
  it("counts each field separately instead of naming all four", async () => {
    const counts = await costCentreService.countOrphanedRecords();
    expect(counts).toMatchObject({
      total: 406, orphaned: 406,
      missingClient: 406, missingLob: 406,
      // Branch is complete — the old message claimed otherwise and sent people looking.
      missingBranch: 0,
      missingProcess: 384,
    });
  });
});
