import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Candidate-registration recruiter dropdown: every ACTIVE HR employee at the branch must appear
 * without needing an ats_recruiter_roster row (nothing auto-syncs employees into it), and branch
 * spellings ("Noida 2", "NOIDA-2", "Noida (Okaya)") must all resolve to the same branch.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("./process-options.js", () => ({ listActiveProcessNames: vi.fn() }));
import { atsFormConfigService } from "../ats-form-config.service.js";

const ALIASES = [
  { canonical_key: "NOIDA-2", display_name: "Noida (Okaya)", alias_text: "Noida2 Okaya N2" },
  { canonical_key: "NOIDA", display_name: "Noida (Trapezoid)", alias_text: "Noida Trapezoid TPZ Sector" },
];
const BRANCHES = [
  { id: "b-noida", branch_name: "NOIDA", branch_code: "NOIDA" },
  { id: "b-noida2", branch_name: "NOIDA-2", branch_code: "NOIDA-2" },
];

describe("getRecruitersByBranch", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("ats_branch_alias_master")) return [ALIASES, []];
      if (sql.includes("FROM branch_master")) return [BRANCHES, []];
      if (sql.includes("FROM employees e")) {
        // no roster join required: only the branch id decides
        return [params[0] === "b-noida2"
          ? [{ id: null, employee_id: "e1", employee_code: "MAS63582", name: "HR One", email: null, mobile: null }]
          : [], []];
      }
      return [[], []];
    });
  });

  it.each(["Noida 2", "NOIDA-2", "noida_2", "Noida (Okaya)", "Okaya"])(
    "resolves %s to NOIDA-2 and lists an HR employee with no roster row",
    async (name) => {
      const list = await atsFormConfigService.getRecruitersByBranch(name);
      expect(list.map((r) => r.employee_code)).toEqual(["MAS63582"]);
    },
  );

  it("does not leak NOIDA-2 recruiters into plain NOIDA", async () => {
    expect(await atsFormConfigService.getRecruitersByBranch("Noida")).toEqual([]);
  });
});
