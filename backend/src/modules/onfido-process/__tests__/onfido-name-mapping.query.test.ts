import { beforeEach, describe, expect, it, vi } from "vitest";

// The service imports both pools at module load; mock before importing the service.
const onfidoQuery = vi.fn();
const hrmsExecute = vi.fn();

vi.mock("../../../db/onfidoDb.js", () => ({
  getOnfidoPool: vi.fn().mockResolvedValue({ query: (...args: unknown[]) => onfidoQuery(...args) }),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => hrmsExecute(...args) },
}));

const {
  getDistinctOnfidoNames,
  getEmployeeCandidates,
  upsertMapping,
  getMappingByNameAndRole,
} = await import("../onfido-name-mapping.service.js");

beforeEach(() => {
  onfidoQuery.mockReset();
  hrmsExecute.mockReset();
});

describe("getDistinctOnfidoNames", () => {
  it("returns distinct raw names tagged with their role, sourced from the onfido pool", async () => {
    onfidoQuery
      .mockResolvedValueOnce([[{ name: "Priya Sharma" }, { name: "Rahul Verma" }]]) // tl_name query
      .mockResolvedValueOnce([[{ name: "Amit Kumar" }]]); // am_name query

    const result = await getDistinctOnfidoNames();

    expect(result).toEqual([
      { rawName: "Priya Sharma", rawRole: "tl" },
      { rawName: "Rahul Verma", rawRole: "tl" },
      { rawName: "Amit Kumar", rawRole: "am" },
    ]);
    expect(onfidoQuery).toHaveBeenCalledTimes(2);
  });
});

describe("getEmployeeCandidates", () => {
  it("returns only active employees mapped to id/fullName/employeeCode", async () => {
    hrmsExecute.mockResolvedValueOnce([
      [
        { id: "emp-1", full_name: "Priya Sharma", employee_code: "MAS001" },
        { id: "emp-2", full_name: "Rahul Verma", employee_code: "MAS002" },
      ],
    ]);

    const result = await getEmployeeCandidates();

    expect(result).toEqual([
      { id: "emp-1", fullName: "Priya Sharma", employeeCode: "MAS001" },
      { id: "emp-2", fullName: "Rahul Verma", employeeCode: "MAS002" },
    ]);
    const [sql] = hrmsExecute.mock.calls[0];
    expect(sql).toContain("active_status = 1");
    expect(sql).toContain("employees");
  });
});

describe("upsertMapping", () => {
  it("inserts a new mapping row when none exists for that raw_name/raw_role", async () => {
    hrmsExecute
      .mockResolvedValueOnce([[]]) // SELECT verified_by_hr check: no existing row
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT ... ON DUPLICATE KEY UPDATE

    await upsertMapping({
      rawName: "Priya Sharma",
      rawRole: "tl",
      employeeId: "emp-1",
      matchConfidence: 1.0,
      matchMethod: "exact_name",
    });

    expect(hrmsExecute).toHaveBeenCalledTimes(2);
  });

  it("never overwrites a row that HR has already verified", async () => {
    hrmsExecute.mockResolvedValueOnce([[{ verified_by_hr: 1 }]]); // existing row is HR-verified

    await upsertMapping({
      rawName: "Priya Sharma",
      rawRole: "tl",
      employeeId: "emp-999",
      matchConfidence: 0.5,
      matchMethod: "ambiguous",
    });

    // Only the guard SELECT should run — no INSERT/UPDATE follows.
    expect(hrmsExecute).toHaveBeenCalledTimes(1);
  });
});

describe("getMappingByNameAndRole", () => {
  it("returns the mapping row for a given raw name and role", async () => {
    hrmsExecute.mockResolvedValueOnce([
      [
        {
          id: "map-1",
          raw_name: "Priya Sharma",
          raw_role: "tl",
          employee_id: "emp-1",
          match_confidence: 1.0,
          match_method: "exact_name",
          verified_by_hr: 0,
        },
      ],
    ]);

    const result = await getMappingByNameAndRole("Priya Sharma", "tl");

    expect(result?.employeeId).toBe("emp-1");
    expect(result?.matchMethod).toBe("exact_name");
  });

  it("returns null when no mapping row exists for that name/role", async () => {
    hrmsExecute.mockResolvedValueOnce([[]]);

    const result = await getMappingByNameAndRole("Nobody Here", "am");

    expect(result).toBeNull();
  });
});
