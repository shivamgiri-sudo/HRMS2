import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { bulkValidate } from "../salary-revision.service.js";

const VALID_DATE = "2024-06-01";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bulkValidate()", () => {
  it("returns ok for valid employee with active assignment and no pending request", async () => {
    // execute call 1: employee lookup
    execute.mockResolvedValueOnce([[{ id: "42", name: "Alice Smith", date_of_joining: "2020-01-01" }]]);
    // execute call 2: active salary assignment
    execute.mockResolvedValueOnce([[{ id: 99 }]]);
    // execute call 3: pending revision check
    execute.mockResolvedValueOnce([[]]); // no pending

    const result = await bulkValidate({
      employee_codes: ["EMP001"],
      requested_effective_from: VALID_DATE,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: "EMP001",
      status: "ok",
      employee_id: "42",
      name: "Alice Smith",
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("returns error when employee code not found — only 1 execute call fires", async () => {
    // execute call 1: employee lookup returns empty
    execute.mockResolvedValueOnce([[]]); // not found

    const result = await bulkValidate({
      employee_codes: ["BADCODE"],
      requested_effective_from: VALID_DATE,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: "BADCODE",
      status: "error",
      reason: "Employee not found",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns error when requested date is before date of joining — only 1 execute call fires after emp lookup", async () => {
    // execute call 1: employee lookup returns emp with future DOJ
    execute.mockResolvedValueOnce([[{ id: "5", name: "Bob Jones", date_of_joining: "2025-01-01" }]]);

    const result = await bulkValidate({
      employee_codes: ["EMP002"],
      requested_effective_from: "2024-01-01", // before 2025-01-01
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: "EMP002",
      status: "error",
      employee_id: "5",
      name: "Bob Jones",
      reason: "Date is before date of joining",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns error when no active salary assignment exists — 2 execute calls", async () => {
    // execute call 1: employee lookup
    execute.mockResolvedValueOnce([[{ id: "7", name: "Carol White", date_of_joining: "2020-03-01" }]]);
    // execute call 2: active salary assignment returns empty
    execute.mockResolvedValueOnce([[]]); // no assignment

    const result = await bulkValidate({
      employee_codes: ["EMP003"],
      requested_effective_from: VALID_DATE,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: "EMP003",
      status: "error",
      employee_id: "7",
      name: "Carol White",
      reason: "No active salary assignment",
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns error when pending revision already exists — 3 execute calls", async () => {
    // execute call 1: employee lookup
    execute.mockResolvedValueOnce([[{ id: "10", name: "Dave Brown", date_of_joining: "2019-05-01" }]]);
    // execute call 2: active salary assignment exists
    execute.mockResolvedValueOnce([[{ id: 50 }]]);
    // execute call 3: pending revision found
    execute.mockResolvedValueOnce([[{ id: 200 }]]); // has pending

    const result = await bulkValidate({
      employee_codes: ["EMP004"],
      requested_effective_from: VALID_DATE,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: "EMP004",
      status: "error",
      employee_id: "10",
      name: "Dave Brown",
      reason: "Pending request already exists",
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("deduplicates input codes with whitespace — 2 codes [EMP001, ' EMP001 '] → only 1 result, only 3 execute calls", async () => {
    // execute call 1: employee lookup (deduplicated to one code)
    execute.mockResolvedValueOnce([[{ id: "42", name: "Alice Smith", date_of_joining: "2020-01-01" }]]);
    // execute call 2: active assignment
    execute.mockResolvedValueOnce([[{ id: 99 }]]);
    // execute call 3: pending check
    execute.mockResolvedValueOnce([[]]); // no pending

    const result = await bulkValidate({
      employee_codes: ["EMP001", " EMP001 "],
      requested_effective_from: VALID_DATE,
    });

    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("EMP001");
    expect(result[0].status).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("throws on invalid date format — no execute calls", async () => {
    await expect(
      bulkValidate({
        employee_codes: ["EMP001"],
        requested_effective_from: "not-a-date",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_DATE",
    });

    expect(execute).not.toHaveBeenCalled();
  });
});
