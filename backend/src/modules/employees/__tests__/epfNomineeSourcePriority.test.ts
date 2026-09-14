import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The EPF compliance screen writes nominees to employee_epf_nominee. Form 2 read
 * employee_nominee instead, so that table was write-only: every nominee HR
 * entered there was discarded at render time, along with the share, guardian and
 * address that Part A actually asks for and that the general table does not
 * always carry.
 *
 * It is empty in production today, which is the only reason no document has been
 * wrong yet — the loss would have started the moment the screen was used.
 */

const EMPLOYEE = "cccccccc-1111-2222-3333-444444444444";

let epfNominees: Array<Record<string, unknown>> = [];
let generalNominees: Array<Record<string, unknown>> = [];

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("employee_epf_nominee")) return [epfNominees];
      if (s.includes("FROM employee_nominee")) return [generalNominees];
      if (s.includes("FROM employees e")) return [[{ id: EMPLOYEE, full_name: "TEST MEMBER" }]];
      return [[]];
    }),
  },
}));

vi.mock("../branchPayrollHrSignatory.service.js", () => ({
  getPayrollHrSignatoryForEmployee: async () => null,
  mergeBranchSignatureIntoSeal: async () => null,
}));

const { buildSourceContext } = await import("../universalDigitalFormFill.service.js");

const nomineeOf = async () => {
  const ctx = (await buildSourceContext(EMPLOYEE, null)) as Record<string, never>;
  return ctx.nominee as Record<string, unknown>;
};

beforeEach(() => {
  epfNominees = [];
  generalNominees = [];
});

describe("Form 2 nominee source priority", () => {
  it("uses the EPF compliance nominee when one exists", async () => {
    // The SQL aliases guardian_relationship -> guardian_relation and builds the
    // address from its four parts, so assert the shape the flattener consumes.
    epfNominees = [{
      nominee_name: "MEENA DEVI", relationship: "Mother", date_of_birth: "1970-04-02",
      share_percentage: 100, guardian_name: null, guardian_relation: null,
      address: "12 Nehru Nagar, Bhopal, Madhya Pradesh, 462001", is_minor: 0,
    }];
    generalNominees = [{ nominee_name: "SOMEONE ELSE", relationship: "Father" }];

    const nominee = await nomineeOf();
    expect(nominee.n1_name).toBe("MEENA DEVI");
    expect(nominee.n1_share_percentage).toBe("100");
    expect(nominee.n1_address).toContain("Bhopal");
  });

  it("falls back to the general nominee table when the EPF one is empty", async () => {
    // 33,438 employees have rows only in the general table; they must not
    // regress to a blank Part A.
    generalNominees = [{ nominee_name: "RAMESH SINGH", relationship: "Father", date_of_birth: "1966-11-02" }];
    const nominee = await nomineeOf();
    expect(nominee.n1_name).toBe("RAMESH SINGH");
  });

  it("keeps the guardian for a minor nominee entered on the EPF screen", async () => {
    // employee_epf_nominee has no is_minor column and the flattener prints a
    // guardian only for a minor, so a hardcoded 0 would drop the guardian that
    // screen had just collected.
    epfNominees = [{
      nominee_name: "AARAV SINGH", relationship: "Son", date_of_birth: "2015-06-30",
      share_percentage: 100, guardian_name: "MEENA DEVI", guardian_relation: "Mother",
      address: "12 Nehru Nagar", is_minor: 1,
    }];
    const nominee = await nomineeOf();
    expect(nominee.n1_guardian_name).toBe("MEENA DEVI");
  });

  it("does not print a guardian for an adult nominee", async () => {
    epfNominees = [{
      nominee_name: "MEENA DEVI", relationship: "Mother", date_of_birth: "1970-04-02",
      share_percentage: 100, guardian_name: null, guardian_relation: null,
      address: "12 Nehru Nagar", is_minor: 0,
    }];
    const nominee = await nomineeOf();
    expect(nominee.n1_guardian_name).toBeNull();
  });
});
