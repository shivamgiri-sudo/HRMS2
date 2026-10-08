import { describe, expect, it } from "vitest";
import { normalizeRoleInputs } from "../roles.js";

describe("normalizeRoleInputs", () => {
  it("maps legacy role labels to canonical roles", () => {
    expect(normalizeRoleInputs(["hr_admin"])).toEqual(["hr"]);
    expect(normalizeRoleInputs(["QA_Manager"])).toEqual(["qa"]);
    expect(normalizeRoleInputs(["Operations_Manager"])).toEqual(["operations_manager"]);
    expect(normalizeRoleInputs(["payroll_admin"])).toEqual(["payroll"]);
    expect(normalizeRoleInputs(["wfm_spoc"])).toEqual(["wfm"]);
    expect(normalizeRoleInputs(["branch_it"])).toEqual(["it"]);
    expect(normalizeRoleInputs(["Super Admin"])).toEqual(["super_admin"]);
  });

  it("expands grouped legacy roles into canonical access sets", () => {
    expect(normalizeRoleInputs(["management"])).toEqual([
      "ceo",
      "coo",
      "branch_head",
      "operations_manager",
      "manager",
      "process_manager",
    ]);

    expect(normalizeRoleInputs(["finance_admin"])).toEqual([
      "finance",
      "finance_head",
      "accounts_head",
    ]);
  });
});
