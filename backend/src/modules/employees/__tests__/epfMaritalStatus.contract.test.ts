/**
 * The EPF forms' marital status boxes must actually tick.
 *
 * Form 11 has four boxes — Married, Unmarried, Widow/Widower, Divorcee — each
 * selected by an exact, case-insensitive match against epf.marital_status
 * (pdfAcroFormFill.service.ts:212). Two things stopped any of them ever ticking:
 *
 *  1. epf.marital_status read only employee_epf_compliance_profile, which holds
 *     4 rows in production and every one of them has a NULL marital_status.
 *  2. The populated sources spell it differently. candidate_onboarding_profile
 *     has "Single" (29,848), "Married" (2,848), "DIVORCE" (4), "WIDOW" (2);
 *     employees has "single" (27,570), "married" (2,548), "divorced", "widowed".
 *     "Single" is not "Unmarried", so the box stayed empty even where the datum
 *     was known.
 *
 * So the value is taken from whichever source has it and normalised to the four
 * discriminants the form actually compares against.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  employee: Record<string, unknown> | null;
  onboarding: Record<string, unknown> | null;
  epf: Record<string, unknown> | null;
} = { employee: null, onboarding: null, epf: null };

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("candidate_onboarding_profile")) return [state.onboarding ? [state.onboarding] : []];
      if (s.includes("employee_epf_compliance_profile")) return [state.epf ? [state.epf] : []];
      if (s.includes("FROM employees")) return [state.employee ? [state.employee] : []];
      return [[]];
    }),
    query: vi.fn(async () => [[]]),
  },
}));

const { buildSourceContext } = await import("../universalDigitalFormFill.service.js");

const maritalOf = async () => {
  const ctx = await buildSourceContext("emp-1", "cand-1");
  return (ctx as Record<string, Record<string, unknown>>).epf.marital_status;
};

beforeEach(() => {
  state.employee = { full_name: "A B", gender: "Male" };
  state.onboarding = null;
  state.epf = null;
});

describe("EPF marital status", () => {
  it("normalises the onboarding form's 'Single' to the box the form compares against", async () => {
    state.onboarding = { marital_status: "Single" };
    expect(await maritalOf()).toBe("Unmarried");
  });

  it("normalises the employees table's lowercase 'single'", async () => {
    state.employee = { full_name: "A B", marital_status: "single" };
    expect(await maritalOf()).toBe("Unmarried");
  });

  it("keeps Married as Married", async () => {
    state.onboarding = { marital_status: "Married" };
    expect(await maritalOf()).toBe("Married");
  });

  it("maps the onboarding form's shouted DIVORCE to Divorcee", async () => {
    state.onboarding = { marital_status: "DIVORCE" };
    expect(await maritalOf()).toBe("Divorcee");
  });

  it("maps WIDOW and 'widowed' to Widow/Widower", async () => {
    state.onboarding = { marital_status: "WIDOW" };
    expect(await maritalOf()).toBe("Widow/Widower");
    state.onboarding = { marital_status: "widowed" };
    expect(await maritalOf()).toBe("Widow/Widower");
  });

  it("prefers the EPF profile when it actually carries a value", async () => {
    state.epf = { marital_status: "Married" };
    state.onboarding = { marital_status: "Single" };
    expect(await maritalOf()).toBe("Married");
  });

  it("falls through an empty EPF profile to the onboarding value", async () => {
    // This is the live shape: the profile row exists but the column is NULL.
    state.epf = { marital_status: null };
    state.onboarding = { marital_status: "Married" };
    expect(await maritalOf()).toBe("Married");
  });

  it("stays null when nothing anywhere records it, rather than guessing", async () => {
    expect(await maritalOf()).toBeNull();
  });

  it("leaves an unrecognised value alone rather than forcing it into a box", async () => {
    state.onboarding = { marital_status: "Separated" };
    // No Form 11 box means "Separated". Ticking the nearest one would assert
    // something about a real person that the record does not say.
    expect(await maritalOf()).toBe("Separated");
  });
});
