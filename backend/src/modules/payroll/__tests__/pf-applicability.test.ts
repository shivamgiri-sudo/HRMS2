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

const { resolvePfApplicabilityForPeriod, resolvePfApplicability, summarisePfApplicability } =
  await import("../pf-applicability.service.js");

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
    const src = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "src/modules/payroll/pf-applicability.service.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/15000|15_000|basic\s*[<>]=?/i);
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
