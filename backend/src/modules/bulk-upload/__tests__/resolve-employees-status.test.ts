/**
 * Which employees a bulk upload may name.
 *
 * This used to be `employment_status = 'active'`, and it rejected people who were at work.
 * Measured on live 2026-09-02 from BATCH-1788287542227: 86 of its 90 failed rows were refused
 * as "not found or not active", and every one of those employees was flagged `inactive` while
 * recording 43-45 attendance days in the preceding 60, all with a punch on 18 Aug 2026. HR
 * could not correct attendance for staff who were coming in every day.
 *
 * The column cannot carry that much weight: across 58,975 rows it holds 'Active' (1,115),
 * 'inactive' (27,052), 'Resigned' (30,309) and 'terminated' (499), and `date_of_leaving` is
 * NULL for 30,307 of the 30,309 Resigned — so no status is corroborated by anything, and
 * 'inactive' carries no exit evidence at all.
 *
 * So the rule is now a denylist of the two statuses that actually assert someone has left.
 * These tests pin both halves: that 'inactive' is admitted, and that the deliberate exits
 * are still kept out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: vi.fn() } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(),
  hasScopedAccess: vi.fn(),
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../communication/email.service.js", () => ({ emailService: {} }));

const { resolveEmployees } = await import("../bulk-approval.service.js");

/** Stands in for the employees table; the mock applies the same rule MySQL would. */
const DENY = ["resigned", "terminated"];
function tableRows() {
  return [
    { id: "e1", employee_code: "MAS0001", employment_status: "Active" },
    { id: "e2", employee_code: "MAS0002", employment_status: "inactive" },
    { id: "e3", employee_code: "MAS0003", employment_status: "Resigned" },
    { id: "e4", employee_code: "MAS0004", employment_status: "terminated" },
    { id: "e5", employee_code: "MAS0005", employment_status: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockImplementation(async (_sql: string, params: unknown[]) => {
    // Everything before the trailing status parameters is the employee_code list.
    const codes = (params as string[]).slice(0, params.length - DENY.length);
    const rows = tableRows()
      .filter((r) => codes.includes(r.employee_code))
      .filter((r) => r.employment_status === null
        || !DENY.includes(String(r.employment_status).toLowerCase()))
      .map((r) => ({ ...r, branch_id: "b1", process_id: "p1", first_name: "A", last_name: "B" }));
    return [rows, []];
  });
});

describe("resolveEmployees — employment status", () => {
  it("accepts an employee marked inactive", async () => {
    // The whole point: BATCH-1788287542227's 86 rejected rows were all this case.
    const map = await resolveEmployees(["MAS0002"]);
    expect(map.get("MAS0002")).toBeDefined();
  });

  it("still accepts an active employee", async () => {
    const map = await resolveEmployees(["MAS0001"]);
    expect(map.get("MAS0001")).toBeDefined();
  });

  it("accepts an employee whose status was never set", async () => {
    // A NULL is an unknown, not an exit. Rejecting it would repeat the original mistake.
    const map = await resolveEmployees(["MAS0005"]);
    expect(map.get("MAS0005")).toBeDefined();
  });

  it("refuses a resigned employee", async () => {
    const map = await resolveEmployees(["MAS0003"]);
    expect(map.get("MAS0003")).toBeUndefined();
  });

  it("refuses a terminated employee", async () => {
    const map = await resolveEmployees(["MAS0004"]);
    expect(map.get("MAS0004")).toBeUndefined();
  });

  it("names the excluded statuses instead of filtering to one allowed value", async () => {
    // Guards the shape, not just the outcome: reverting to `employment_status = 'active'`
    // would pass the cases above only until someone changed the fixture.
    await resolveEmployees(["MAS0001"]);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/NOT IN/);
    expect(sql).not.toMatch(/employment_status\s*=\s*'active'/i);
    expect(params).toEqual(expect.arrayContaining(["Resigned", "terminated"]));
  });

  it("keeps a NULL status out of the NOT IN trap", async () => {
    // `NULL NOT IN ('Resigned','terminated')` is NULL, not TRUE, so without an explicit
    // IS NULL branch every status-less employee would silently drop out.
    await resolveEmployees(["MAS0005"]);
    expect(execute.mock.calls[0][0]).toMatch(/employment_status IS NULL/);
  });

  it("still chunks large code lists", async () => {
    // The status parameters are appended per chunk; getting that wrong would corrupt the
    // placeholder/parameter alignment on any upload above 500 rows.
    const codes = Array.from({ length: 1200 }, (_, i) => `MAS${i}`);
    await resolveEmployees(codes);
    expect(execute).toHaveBeenCalledTimes(3);
    for (const [, params] of execute.mock.calls) {
      const p = params as unknown[];
      expect(p.slice(-DENY.length)).toEqual(["Resigned", "terminated"]);
    }
  });
});
