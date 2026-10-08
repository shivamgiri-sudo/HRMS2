import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { findDuplicateAccountOwner, computeAccountBlindIndex } = await import("../bankAccountDuplicate.js");
const { blindIndex } = await import("../fieldEncryption.js");

const EMPLOYEE_A = "11111111-1111-1111-1111-111111111111";
const EMPLOYEE_B = "22222222-2222-2222-2222-222222222222";
const ACCOUNT = "50100234567890";

describe("computeAccountBlindIndex", () => {
  it("is deterministic for the same input", () => {
    expect(computeAccountBlindIndex(ACCOUNT)).toBe(computeAccountBlindIndex(ACCOUNT));
  });

  it("matches shared/fieldEncryption.ts's blindIndex() directly — same HMAC, no drift", () => {
    expect(computeAccountBlindIndex(ACCOUNT)).toBe(blindIndex(ACCOUNT));
  });

  it("differs for different account numbers", () => {
    expect(computeAccountBlindIndex(ACCOUNT)).not.toBe(computeAccountBlindIndex("99999999999999"));
  });
});

describe("findDuplicateAccountOwner", () => {
  beforeEach(() => dbExecute.mockReset());

  it("returns null when no other employee holds a matching active account", async () => {
    dbExecute.mockResolvedValueOnce([[]]);
    const result = await findDuplicateAccountOwner(ACCOUNT, EMPLOYEE_A);
    expect(result).toBeNull();
  });

  it("returns the other employee's identity when a match exists", async () => {
    dbExecute.mockResolvedValueOnce([[{
      bank_detail_id: "bd-1",
      employee_id: EMPLOYEE_B,
      employee_code: "MAS9999",
      employee_name: "Priya Sharma",
    }]]);

    const result = await findDuplicateAccountOwner(ACCOUNT, EMPLOYEE_A);

    expect(result).toEqual({
      employeeId: EMPLOYEE_B,
      employeeCode: "MAS9999",
      employeeName: "Priya Sharma",
      bankDetailId: "bd-1",
    });
  });

  it("queries with the blind index of the account number and excludes the caller's own employee_id", async () => {
    dbExecute.mockResolvedValueOnce([[]]);
    await findDuplicateAccountOwner(ACCOUNT, EMPLOYEE_A);

    const [sql, params] = dbExecute.mock.calls[0];
    expect(String(sql)).toContain("account_number_blind_index = ?");
    expect(String(sql)).toContain("employee_id <> ?");
    expect(String(sql)).toContain("active_status = 1");
    expect(params).toEqual([blindIndex(ACCOUNT), EMPLOYEE_A]);
  });
});
