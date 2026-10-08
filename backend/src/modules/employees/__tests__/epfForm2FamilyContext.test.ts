import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * EPF Form 2 Part B declares the member's family for the pension scheme. It
 * printed blank on every form ever issued because nothing supplied it: the PF
 * nominee is a different question, and copying it across would have been a false
 * statutory declaration.
 *
 * The candidate now declares their family during onboarding, so these assertions
 * cover the path from that table to the Part B boxes — including the rule that a
 * family member and a nominee never leak into each other's section.
 */

const EMPLOYEE = "aaaaaaaa-1111-2222-3333-444444444444";
const CANDIDATE = "bbbbbbbb-5555-6666-7777-888888888888";

let familyRows: Array<Record<string, unknown>> = [];
let nomineeRows: Array<Record<string, unknown>> = [];

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("candidate_onboarding_family_member")) return [familyRows];
      if (s.includes("FROM employee_nominee")) return [nomineeRows];
      if (s.includes("FROM employees e")) {
        return [[{ id: EMPLOYEE, full_name: "TEST MEMBER", employee_code: "MAS00001" }]];
      }
      return [[]];
    }),
  },
}));

// Branch signatory and attendance fan out to their own queries and are not what
// this test is about.
vi.mock("../branchPayrollHrSignatory.service.js", () => ({
  getPayrollHrSignatoryForEmployee: async () => null,
  mergeBranchSignatureIntoSeal: async () => null,
}));

const { buildSourceContext } = await import("../universalDigitalFormFill.service.js");

const member = (over: Record<string, unknown> = {}) => ({
  member_name: "RUKHSANA BEGUM",
  relation: "Mother",
  dob: "1968-07-14",
  address: "12 Nehru Nagar, Bhopal 462001",
  is_eps_nominee: 0,
  ...over,
});

beforeEach(() => {
  familyRows = [];
  nomineeRows = [];
});

describe("EPF Form 2 Part B family context", () => {
  it("exposes a declared family member as family.f1_*", async () => {
    familyRows = [member()];
    const ctx = (await buildSourceContext(EMPLOYEE, CANDIDATE)) as Record<string, never>;
    const family = ctx.family as Record<string, unknown>;

    expect(family.f1_name).toBe("RUKHSANA BEGUM");
    expect(family.f1_relationship).toBe("Mother");
    expect(family.f1_date_of_birth).toBe("1968-07-14");
    expect(family.f1_address).toBe("12 Nehru Nagar, Bhopal 462001");
  });

  it("routes the EPS-flagged row to eps_nominee and keeps it out of the family table", async () => {
    // The EPS block is the fallback for a member with no eligible family, so a
    // row flagged for it must not also appear as family_1 — that would declare
    // the same person twice in two different capacities.
    familyRows = [
      member({ member_name: "SULTAN AHMED", relation: "Father", is_eps_nominee: 1 }),
      member({ member_name: "RUKHSANA BEGUM" }),
    ];
    const ctx = (await buildSourceContext(EMPLOYEE, CANDIDATE)) as Record<string, never>;
    const family = ctx.family as Record<string, unknown>;
    const eps = ctx.eps_nominee as Record<string, unknown>;

    expect(eps.name).toBe("SULTAN AHMED");
    expect(eps.relationship).toBe("Father");
    expect(family.f1_name).toBe("RUKHSANA BEGUM");
    expect(Object.values(family)).not.toContain("SULTAN AHMED");
  });

  it("never derives a family from the PF nominee", async () => {
    // The original hazard: a nominee is not a family member. With no declared
    // family, Part B must stay empty even though a nominee exists.
    familyRows = [];
    nomineeRows = [{ nominee_name: "SULTAN AHMED", relationship: "Father", date_of_birth: "1980-02-04" }];

    const ctx = (await buildSourceContext(EMPLOYEE, CANDIDATE)) as Record<string, never>;
    const family = ctx.family as Record<string, unknown>;
    const eps = ctx.eps_nominee as Record<string, unknown>;
    const nominee = ctx.nominee as Record<string, unknown>;

    expect(nominee.n1_name).toBe("SULTAN AHMED");
    expect(Object.keys(family)).toHaveLength(0);
    expect(eps.name).toBeNull();
  });

  it("prints at most the four rows the form has", async () => {
    familyRows = Array.from({ length: 6 }, (_, i) => member({ member_name: `MEMBER ${i + 1}` }));
    const ctx = (await buildSourceContext(EMPLOYEE, CANDIDATE)) as Record<string, never>;
    const family = ctx.family as Record<string, unknown>;

    expect(family.f4_name).toBe("MEMBER 4");
    expect(family.f5_name).toBeUndefined();
  });

  it("treats an empty string as absent, not as a value", async () => {
    // These onboarding columns hold '' rather than NULL in places; `??` would
    // accept '' and print an empty box as though it were declared data.
    familyRows = [member({ address: "   ", relation: "" })];
    const ctx = (await buildSourceContext(EMPLOYEE, CANDIDATE)) as Record<string, never>;
    const family = ctx.family as Record<string, unknown>;

    expect(family.f1_address).toBeNull();
    expect(family.f1_relationship).toBeNull();
  });
});
