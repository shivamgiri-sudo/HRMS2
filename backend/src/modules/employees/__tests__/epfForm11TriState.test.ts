import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Form 11's previous-membership boxes are Yes/No pairs, and the resolution was
 * `Number(x ?? 0) === 1` for Yes and `!== 1` for No. Since the source table holds
 * 4 rows in production, nearly every member had "No" ticked for them — a
 * declaration that they were never in the PF or the EPS, made by the system on
 * their behalf and printed on a form they then sign.
 *
 * Not knowing is a third state, and it must leave both boxes blank.
 */

const EMPLOYEE = "dddddddd-1111-2222-3333-444444444444";
const CANDIDATE = "eeeeeeee-5555-6666-7777-888888888888";

let epfRow: Record<string, unknown> | null = null;
let onboardingRow: Record<string, unknown> | null = null;

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("employee_epf_compliance_profile")) return [epfRow ? [epfRow] : []];
      if (s.includes("candidate_onboarding_family_member")) return [[]];
      if (s.includes("candidate_onboarding_profile")) return [onboardingRow ? [onboardingRow] : []];
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

const epfOf = async () => {
  const ctx = (await buildSourceContext(EMPLOYEE, CANDIDATE)) as Record<string, never>;
  return ctx.epf as Record<string, unknown>;
};

beforeEach(() => { epfRow = null; onboardingRow = null; });

describe("Form 11 previous-membership boxes", () => {
  it("leaves both boxes blank when nobody answered", async () => {
    const epf = await epfOf();
    expect(epf.previous_pf_member).toBe(false);
    expect(epf.previous_pf_member_no).toBe(false);
    expect(epf.previous_eps_member).toBe(false);
    expect(epf.previous_eps_member_no).toBe(false);
  });

  it("ticks No only when someone actually answered no", async () => {
    onboardingRow = { previous_pf_member: 0, eps_member: 0 };
    const epf = await epfOf();
    expect(epf.previous_pf_member).toBe(false);
    expect(epf.previous_pf_member_no).toBe(true);
    expect(epf.previous_eps_member_no).toBe(true);
  });

  it("ticks Yes from the member's own onboarding answer", async () => {
    onboardingRow = { previous_pf_member: 1, eps_member: 1 };
    const epf = await epfOf();
    expect(epf.previous_pf_member).toBe(true);
    expect(epf.previous_pf_member_no).toBe(false);
    expect(epf.previous_eps_member).toBe(true);
  });

  it("does not read a freshly created profile's defaults as answers", async () => {
    // Every flag on employee_epf_compliance_profile is NOT NULL DEFAULT 0, so a
    // row created for an employee who has answered nothing arrives with five
    // zeros. Treating those as declarations put "No" on the form the moment HR
    // opened the record — which is how SOFIYA SULTAN (MAS63086) came to have
    // previous_pf_member = 0 without anyone asking her.
    epfRow = {
      previous_pf_member: 0, previous_eps_member: 0, international_worker: 0,
      employee_name: "SOFIYA SULTAN",
    };
    const epf = await epfOf();
    expect(epf.previous_pf_member).toBe(false);
    expect(epf.previous_pf_member_no).toBe(false);
    expect(epf.previous_eps_member_no).toBe(false);
    expect(epf.international_worker_no).toBe(false);
  });

  it("lets the member's nullable onboarding answer through a profile default", async () => {
    // The profile's 0 is not an answer, so her actual "no" from the statutory
    // step must still reach the form.
    epfRow = { previous_pf_member: 0 };
    onboardingRow = { previous_pf_member: 0 };
    const epf = await epfOf();
    expect(epf.previous_pf_member_no).toBe(true);
  });

  it("trusts an affirmative on the EPF record over onboarding", async () => {
    epfRow = { previous_pf_member: 1 };
    onboardingRow = { previous_pf_member: 0 };
    const epf = await epfOf();
    expect(epf.previous_pf_member).toBe(true);
    expect(epf.previous_pf_member_no).toBe(false);
  });

  it("does not read international_worker's default 0 as an answer", async () => {
    // That column is DEFAULT 0, and 32,762 of 32,764 rows hold the default. A 0
    // there means "never asked", so neither box may tick.
    onboardingRow = { international_worker: 0 };
    const epf = await epfOf();
    expect(epf.international_worker).toBe(false);
    expect(epf.international_worker_no).toBe(false);
  });

  it("still trusts an affirmative international_worker", async () => {
    onboardingRow = { international_worker: 1 };
    const epf = await epfOf();
    expect(epf.international_worker).toBe(true);
    expect(epf.international_worker_no).toBe(false);
  });
});
