/**
 * Raising an exit must be possible using the employee CODE, not only an opaque UUID.
 *
 * The exit form's only identity field was a free-text box labelled "Employee ID / UUID" with
 * the placeholder "Enter employee UUID", and createExitRequestSchema accepted nothing but
 * `z.string().uuid()`. HR knows people as MAS63193, not as
 * 8e3e0434-6584-11f1-adb1-00155d0ab410, so raising an involuntary termination meant going and
 * finding a UUID first. That is a plausible part of why exit_request holds 2 rows against
 * 57,517 inactive employees.
 *
 * Resolution is deterministic and safe: employee_code is unique across active employees —
 * 1,297 rows, 1,297 distinct codes, 0 duplicates, measured live 2026-08-11. There is no name
 * or fuzzy matching here; an unresolvable code is an error, never a guess.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import { resolveEmployeeRef } from "../resolveEmployeeRef.js";
import { createExitRequestSchema } from "../exit.validation.js";

const UUID = "8e3e0434-6584-11f1-adb1-00155d0ab410";

beforeEach(() => { execute.mockReset(); });

describe("createExitRequestSchema accepts a code", () => {
  const base = { exitDate: "2026-08-15", exitType: "involuntary" as const };

  it("accepts employeeCode without a uuid", () => {
    const parsed = createExitRequestSchema.parse({ ...base, employeeCode: "MAS63193" });
    expect(parsed.employeeCode).toBe("MAS63193");
  });

  it("still accepts a uuid", () => {
    expect(createExitRequestSchema.parse({ ...base, employeeId: UUID }).employeeId).toBe(UUID);
  });

  it("rejects a request identifying nobody", () => {
    expect(() => createExitRequestSchema.parse(base)).toThrow(/employeeId or employeeCode/i);
  });
});

describe("resolveEmployeeRef", () => {
  it("returns a supplied uuid unchanged, without querying", async () => {
    expect(await resolveEmployeeRef(UUID, undefined)).toBe(UUID);
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves an employee code to its id", async () => {
    execute.mockResolvedValueOnce([[{ id: UUID }], []]);
    expect(await resolveEmployeeRef(undefined, "MAS63193")).toBe(UUID);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/FROM employees/i);
    expect(String(sql)).toMatch(/employee_code = \?/);
    expect(params[0]).toBe("MAS63193");
  });

  it("trims and upper-cases the code, so 'mas63193 ' still resolves", async () => {
    execute.mockResolvedValueOnce([[{ id: UUID }], []]);
    await resolveEmployeeRef(undefined, "  mas63193 ");
    expect(execute.mock.calls[0][1][0]).toBe("MAS63193");
  });

  it("throws a message naming the code when it matches nobody", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveEmployeeRef(undefined, "MAS99999")).rejects.toThrow(/MAS99999/);
  });

  it("never falls back to a name or email match", async () => {
    execute.mockResolvedValueOnce([[{ id: UUID }], []]);
    await resolveEmployeeRef(undefined, "MAS63193");
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).not.toMatch(/full_name|first_name|email|LIKE/i);
  });

  it("throws when neither identifier is supplied", async () => {
    await expect(resolveEmployeeRef(undefined, undefined)).rejects.toThrow(/employeeId or employeeCode/i);
  });
});
