import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Contract test for GET /api/employees/:id at the response boundary.
 *
 * Before this change the controller returned employeeService.getEmployee() verbatim, and
 * that service is `SELECT * FROM employees`. The route admits wfm, manager, branch_head,
 * process_manager and it_head alongside hr/payroll/finance, so those five roles received
 * raw Aadhaar, PAN, bank account, IFSC and UAN for anyone inside their row scope, plus the
 * at-rest ciphertext and blind-index columns.
 *
 * This asserts the shape of what the controller actually writes to the response, which is
 * the thing the client receives — the helper's own unit tests cannot prove the controller
 * calls it.
 */

const ROW = {
  id: "emp-1",
  employee_code: "MAS1234",
  full_name: "Test Person",
  aadhaar_number: "123456789012",
  pan_number: "ABCDE1234F",
  bank_account_number: "50100234567890",
  ifsc_code: "HDFC0001234",
  uan_number: "100234567890",
  aadhaar_number_encrypted: "eyJ2IjoxfQ==",
  aadhaar_blind_index: "9f2b3c",
  pan_enc_key_version: 1,
};

vi.mock("../employee.service.js", () => ({
  employeeService: { getEmployee: vi.fn(async () => ({ ...ROW })) },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn() } }));

const { employeeController } = await import("../employee.controller.js");

function invoke(roles: string[] | undefined) {
  const req = { params: { id: "emp-1" }, authUser: roles ? { id: "u1", roles } : { id: "u1" } };
  let payload: any;
  const res = { json: (b: any) => { payload = b; return res; }, status: () => res };
  return employeeController.getEmployee(req as any, res as any).then(() => payload.data);
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/employees/:id response", () => {
  it.each([["wfm"], ["manager"], ["branch_head"], ["process_manager"], ["it_head"]])(
    "does not return a raw statutory or bank identifier to %s",
    async (role) => {
      const data = await invoke([role]);

      expect(data.aadhaar_number).not.toBe("123456789012");
      expect(data.pan_number).not.toBe("ABCDE1234F");
      expect(data.bank_account_number).not.toBe("50100234567890");
      expect(data.uan_number).not.toBe("100234567890");

      // Nothing anywhere in the payload may still carry the raw values.
      expect(JSON.stringify(data)).not.toContain("123456789012");
      expect(JSON.stringify(data)).not.toContain("ABCDE1234F");
      expect(JSON.stringify(data)).not.toContain("50100234567890");
    },
  );

  it("never returns ciphertext, blind indexes or key versions, whatever the role", async () => {
    for (const role of ["wfm", "hr", "payroll", "super_admin"]) {
      const data = await invoke([role]);
      expect(data).not.toHaveProperty("aadhaar_number_encrypted");
      expect(data).not.toHaveProperty("aadhaar_blind_index");
      expect(data).not.toHaveProperty("pan_enc_key_version");
    }
  });

  it("still returns raw identifiers to payroll, so statutory filing is unaffected", async () => {
    const data = await invoke(["payroll"]);
    expect(data.aadhaar_number).toBe("123456789012");
    expect(data.pan_number).toBe("ABCDE1234F");
    expect(data.bank_account_number).toBe("50100234567890");
  });

  it("masks when the request carries no resolved roles at all", async () => {
    const data = await invoke(undefined);
    expect(data.aadhaar_number).not.toBe("123456789012");
  });

  it("leaves the rest of the record intact", async () => {
    const data = await invoke(["wfm"]);
    expect(data.id).toBe("emp-1");
    expect(data.employee_code).toBe("MAS1234");
    expect(data.full_name).toBe("Test Person");
  });
});
