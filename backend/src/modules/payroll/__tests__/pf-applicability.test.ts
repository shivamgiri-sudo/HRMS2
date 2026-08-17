import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner ruling 2026-08-17 (option A): db_bill's monthly payroll row is the authoritative answer to
 * "is this employee PF-applicable for this period", because it is what actually happened to their
 * money. HRMS has never released a salary; db_bill has.
 *
 * Measured live the same day, against 1,327 active employees:
 *   employee_statutory_info.pf_eligible      69   (5.2%)
 *   db_bill salary_data PFELig, 2026-07   1,231   (93%, zero unresolved)
 *   combined through this resolver        1,284   (96.8%, 43 unresolved)
 *
 * The second half of the ruling — "make sure HRMS also functions going onward" — is why db_bill is
 * the FIRST source rather than the only one. An HRMS-native joiner db_bill never paid still
 * resolves, so the resolver does not stop working the day payroll moves across.
 */

const { billQuery, execute } = vi.hoisted(() => ({ billQuery: vi.fn(), execute: vi.fn() }));
vi.mock("../../../db/billDb.js", () => ({ billQuery }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const {
  resolvePfApplicabilityForPeriod, resolvePfApplicability, summarisePfApplicability,
  resolveUanFilingReadinessForPeriod, summariseUanFilingReadiness,
} = await import("../pf-applicability.service.js");

beforeEach(() => {
  billQuery.mockReset();
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

describe("db_bill payroll is authoritative", () => {
  it("resolves applicability from the period's payroll row", async () => {
    billQuery.mockResolvedValue([
      { EmpCode: "MAS001", PFELig: "YES" },
      { EmpCode: "MAS002", PFELig: "NO" },
    ]);
    const all = await resolvePfApplicabilityForPeriod("2026-07");
    expect(all.get("MAS001")?.status).toBe("PF_APPLICABLE");
    expect(all.get("MAS002")?.status).toBe("PF_NOT_APPLICABLE");
    expect(all.get("MAS001")?.source).toBe("db_bill_payroll");
  });

  it("wins over the HRMS record — what was actually paid outranks what HRMS thinks", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS001", PFELig: "NO" }]);
    execute.mockResolvedValue([[{ employee_code: "MAS001", pf_eligible: 1 }], []]);
    const all = await resolvePfApplicabilityForPeriod("2026-07");
    expect(all.get("MAS001")?.status).toBe("PF_NOT_APPLICABLE");
    expect(all.get("MAS001")?.source).toBe("db_bill_payroll");
  });
});

describe("HRMS keeps working as payroll moves across", () => {
  it("falls back to the HRMS record for an employee that period never paid", async () => {
    billQuery.mockResolvedValue([]);
    execute.mockResolvedValue([[{ employee_code: "MAS900", pf_eligible: 1 }], []]);
    const all = await resolvePfApplicabilityForPeriod("2026-07");
    expect(all.get("MAS900")?.status).toBe("PF_APPLICABLE");
    expect(all.get("MAS900")?.source).toBe("hrms_statutory_info");
  });
});

describe("it never guesses", () => {
  it("reports UNRESOLVED when neither source knows", async () => {
    billQuery.mockResolvedValue([]);
    const r = await resolvePfApplicability("MAS404", "2026-07");
    expect(r.status).toBe("PF_APPLICABILITY_UNRESOLVED");
    expect(r.source).toBe("none");
  });

  it("treats an unreadable eligibility value as UNRESOLVED, never as 'not applicable'", async () => {
    // db_bill's eligibility columns are known to carry misaligned junk — one row holds an IFSC
    // code and a person's name. Reading that as "no" would silently drop a real contributor from
    // a statutory filing, which is the one direction this must never fail in.
    billQuery.mockResolvedValue([{ EmpCode: "MAS003", PFELig: "CNRB0001769" }]);
    const all = await resolvePfApplicabilityForPeriod("2026-07");
    expect(all.get("MAS003")?.status).toBe("PF_APPLICABILITY_UNRESOLVED");
  });

  it("leaves an unreadable HRMS value unresolved rather than defaulting it", async () => {
    billQuery.mockResolvedValue([]);
    execute.mockResolvedValue([[{ employee_code: "MAS901", pf_eligible: null }], []]);
    const all = await resolvePfApplicabilityForPeriod("2026-07");
    expect(all.has("MAS901")).toBe(false);
  });

  it("THROWS when db_bill is unreachable instead of returning an empty population", async () => {
    // A statutory population that silently empties when a remote host is down would read as
    // "nobody is PF-applicable this month" — the worst possible failure for a filing.
    billQuery.mockImplementation(async () => { throw new Error("ETIMEDOUT"); });
    await expect(resolvePfApplicabilityForPeriod("2026-07")).rejects.toThrow(/unreachable/i);
  });

  it("rejects a malformed period rather than scanning everything", async () => {
    await expect(resolvePfApplicabilityForPeriod("July 2026")).rejects.toThrow(/YYYY-MM/);
    expect(billQuery).not.toHaveBeenCalled();
  });

  it("contains no wage-threshold inference — that would be inventing statutory policy", async () => {
    // Asserted against the SHARED resolver, not this file. The PF service is now a projection of
    // statutory-applicability.service.ts and holds no rules of its own, so pointing this at
    // pf-applicability.service.ts would pass for the trivial reason that there is nothing there —
    // a guard that cannot fail, which is worse than no guard at all.
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "src/modules/payroll/statutory-applicability.service.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/15000|15_000|21000|21_000|basic\s*[<>]=?|gross\s*[<>]=?/i);
  });
});

describe("summary keeps unresolved visible", () => {
  it("does not fold unresolved into not-applicable", () => {
    const s = summarisePfApplicability([
      { employeeCode: "A", status: "PF_APPLICABLE", source: "db_bill_payroll", reason: "" },
      { employeeCode: "B", status: "PF_NOT_APPLICABLE", source: "db_bill_payroll", reason: "" },
      { employeeCode: "C", status: "PF_APPLICABILITY_UNRESOLVED", source: "none", reason: "" },
    ]);
    expect(s).toMatchObject({ applicable: 1, notApplicable: 1, unresolved: 1 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UAN filing readiness — applicability plus identity
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Two db.execute calls happen per resolution: (1) resolvePfApplicabilityForPeriod's own
 * employee_statutory_info fallback, (2) this resolver's UAN query. Order matters for the mock.
 */
function mockUanQuery(rows: Array<Record<string, unknown>>) {
  execute.mockResolvedValueOnce([[], []]); // (1) HRMS-native PF fallback — empty, db_bill decides
  execute.mockResolvedValueOnce([rows, []]); // (2) the UAN query itself
}

describe("UAN filing readiness — READY only when applicable AND a valid UAN exists", () => {
  it("READY: PF-applicable with a valid 12-digit UAN", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS001", PFELig: "YES" }]);
    mockUanQuery([{ employee_code: "MAS001", uan_employees: "123456789012", uan_statutory_info: null, uan_employee_uan: null }]);

    const all = await resolveUanFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS001")).toMatchObject({
      status: "READY", pfStatus: "PF_APPLICABLE", uan: "123456789012", uanSource: "employees", uanValid: true,
    });
  });

  it("NOT_APPLICABLE: PF resolver says not applicable — UAN is irrelevant, even if present", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS002", PFELig: "NO" }]);
    mockUanQuery([{ employee_code: "MAS002", uan_employees: "123456789012", uan_statutory_info: null, uan_employee_uan: null }]);

    const all = await resolveUanFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS002")?.status).toBe("NOT_APPLICABLE");
  });

  it("MISSING_UAN: PF-applicable, no UAN in any of the three stores", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS003", PFELig: "YES" }]);
    mockUanQuery([{ employee_code: "MAS003", uan_employees: null, uan_statutory_info: "", uan_employee_uan: null }]);

    const all = await resolveUanFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS003")).toMatchObject({ status: "MISSING_UAN", uan: null, uanSource: "none", uanValid: null });
  });

  it("INVALID_UAN: PF-applicable, a UAN exists but is not 12 digits — never silently accepted as present", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS004", PFELig: "YES" }]);
    mockUanQuery([{ employee_code: "MAS004", uan_employees: "12345", uan_statutory_info: null, uan_employee_uan: null }]);

    const all = await resolveUanFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS004")).toMatchObject({ status: "INVALID_UAN", uan: "12345", uanValid: false });
  });

  it("PF_APPLICABILITY_UNRESOLVED: propagated from the underlying PF resolver, not silently dropped", async () => {
    billQuery.mockResolvedValue([]); // MAS005 never appears in db_bill or employee_statutory_info
    mockUanQuery([{ employee_code: "MAS005", uan_employees: "123456789012", uan_statutory_info: null, uan_employee_uan: null }]);

    const all = await resolveUanFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS005")?.status).toBe("PF_APPLICABILITY_UNRESOLVED");
  });

  it("precedence: employees.uan_number wins over employee_statutory_info and employee_uan", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS006", PFELig: "YES" }]);
    mockUanQuery([{ employee_code: "MAS006", uan_employees: "111111111111", uan_statutory_info: "222222222222", uan_employee_uan: "333333333333" }]);

    const all = await resolveUanFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS006")).toMatchObject({ uan: "111111111111", uanSource: "employees" });
  });

  it("falls through to employee_statutory_info, then employee_uan, when earlier sources are empty", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS007", PFELig: "YES" }]);
    mockUanQuery([{ employee_code: "MAS007", uan_employees: null, uan_statutory_info: null, uan_employee_uan: "333333333333" }]);

    const all = await resolveUanFilingReadinessForPeriod("2026-07");
    expect(all.get("MAS007")).toMatchObject({ uan: "333333333333", uanSource: "employee_uan" });
  });
});

describe("summariseUanFilingReadiness counts every state distinctly", () => {
  it("keeps INVALID_UAN separate from MISSING_UAN, and unresolved separate from both", () => {
    const s = summariseUanFilingReadiness([
      { employeeCode: "A", pfStatus: "PF_APPLICABLE", pfSource: "db_bill_payroll", uan: "123456789012", uanSource: "employees", uanValid: true, status: "READY" },
      { employeeCode: "B", pfStatus: "PF_NOT_APPLICABLE", pfSource: "db_bill_payroll", uan: null, uanSource: "none", uanValid: null, status: "NOT_APPLICABLE" },
      { employeeCode: "C", pfStatus: "PF_APPLICABLE", pfSource: "db_bill_payroll", uan: null, uanSource: "none", uanValid: null, status: "MISSING_UAN" },
      { employeeCode: "D", pfStatus: "PF_APPLICABLE", pfSource: "db_bill_payroll", uan: "abc", uanSource: "employees", uanValid: false, status: "INVALID_UAN" },
      { employeeCode: "E", pfStatus: "PF_APPLICABILITY_UNRESOLVED", pfSource: "none", uan: null, uanSource: "none", uanValid: null, status: "PF_APPLICABILITY_UNRESOLVED" },
    ]);
    expect(s).toEqual({ ready: 1, notApplicable: 1, missingUan: 1, invalidUan: 1, unresolved: 1 });
  });
});
