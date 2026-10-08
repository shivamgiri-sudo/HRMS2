import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PF and ESI applicability, resolved together from one db_bill row.
 *
 * Owner ruling 2026-08-17 (option A): db_bill's monthly payroll row is the authoritative answer to
 * "does this scheme apply to this employee for this period", because it is what actually happened
 * to their money. HRMS has never released a salary; db_bill has.
 *
 * Measured live 2026-08-17 against 1,327 active employees, period 2026-07:
 *
 *                                   PF                    ESI
 *   db_bill salary_data        1,231 (93%)           1,231 (93%)   zero unreadable either side
 *   employee_statutory_info       69 (5.2%)             69 (5.2%)
 *   applicable                   910                   722
 *
 * ESIElig was nearly missed entirely: a search for "%esic%" does not match it, because the column
 * is spelled ESI. Before it was found, ESI applicability was believed to have no source at all,
 * and 745 employees without an ESIC number read as 745 gaps. With it, the real gap is 196 — the
 * rest are simply not ESI-covered. That is the difference between a resolver existing and not.
 */

const { billQuery, execute } = vi.hoisted(() => ({
  billQuery: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("../../../db/billDb.js", () => ({ billQuery }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const {
  resolveStatutoryApplicabilityForPeriod,
  resolveStatutoryApplicability,
  summariseApplicability,
  loadStatutoryNotApplicable,
} = await import("../statutory-applicability.service.js");

beforeEach(() => {
  billQuery.mockReset();
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

describe("both schemes resolve from one payroll row", () => {
  it("reads PF and ESI independently off the same row", async () => {
    billQuery.mockResolvedValue([
      { EmpCode: "MAS001", PFELig: "YES", ESIElig: "NO" },
    ]);
    const all = await resolveStatutoryApplicabilityForPeriod("2026-07");
    expect(all.get("MAS001")?.pf.status).toBe("APPLICABLE");
    expect(all.get("MAS001")?.esi.status).toBe("NOT_APPLICABLE");
  });

  it("queries db_bill exactly once for both schemes", async () => {
    // The whole reason these share a resolver: db_bill is MySQL 5.5 across the WAN, and a
    // readiness screen asking each scheme separately would pay for the round trip twice.
    billQuery.mockResolvedValue([
      { EmpCode: "MAS001", PFELig: "YES", ESIElig: "YES" },
    ]);
    await resolveStatutoryApplicabilityForPeriod("2026-07");
    expect(billQuery).toHaveBeenCalledTimes(1);
    expect(String(billQuery.mock.calls[0][0])).toMatch(/ESIElig/);
    expect(String(billQuery.mock.calls[0][0])).toMatch(/PFELig/);
  });

  it("db_bill outranks the HRMS record — what was actually paid wins", async () => {
    billQuery.mockResolvedValue([
      { EmpCode: "MAS001", PFELig: "NO", ESIElig: "NO" },
    ]);
    execute.mockResolvedValue([
      [{ employee_code: "MAS001", pf_eligible: 1, esi_eligible: 1 }],
      [],
    ]);
    const all = await resolveStatutoryApplicabilityForPeriod("2026-07");
    expect(all.get("MAS001")?.pf.status).toBe("NOT_APPLICABLE");
    expect(all.get("MAS001")?.esi.source).toBe("db_bill_payroll");
  });
});

describe("HRMS keeps working as payroll moves across", () => {
  it("falls back to the HRMS record for an employee that period never paid", async () => {
    billQuery.mockResolvedValue([]);
    execute.mockResolvedValue([
      [{ employee_code: "MAS900", pf_eligible: 1, esi_eligible: 0 }],
      [],
    ]);
    const all = await resolveStatutoryApplicabilityForPeriod("2026-07");
    expect(all.get("MAS900")?.pf.status).toBe("APPLICABLE");
    expect(all.get("MAS900")?.esi.status).toBe("NOT_APPLICABLE");
    expect(all.get("MAS900")?.pf.source).toBe("hrms_statutory_info");
  });

  it("resolves one scheme even when the other is unreadable on the same HRMS row", async () => {
    billQuery.mockResolvedValue([]);
    execute.mockResolvedValue([
      [{ employee_code: "MAS901", pf_eligible: 1, esi_eligible: null }],
      [],
    ]);
    const all = await resolveStatutoryApplicabilityForPeriod("2026-07");
    expect(all.get("MAS901")?.pf.status).toBe("APPLICABLE");
    expect(all.get("MAS901")?.esi.status).toBe("UNRESOLVED");
  });

  it("drops an HRMS row where NEITHER scheme is readable rather than reporting it resolved", async () => {
    billQuery.mockResolvedValue([]);
    execute.mockResolvedValue([
      [{ employee_code: "MAS902", pf_eligible: null, esi_eligible: null }],
      [],
    ]);
    const all = await resolveStatutoryApplicabilityForPeriod("2026-07");
    expect(all.has("MAS902")).toBe(false);
  });
});

describe("it never guesses", () => {
  it("reports UNRESOLVED for both when neither source knows", async () => {
    billQuery.mockResolvedValue([]);
    const r = await resolveStatutoryApplicability("MAS404", "2026-07");
    expect(r.pf.status).toBe("UNRESOLVED");
    expect(r.esi.status).toBe("UNRESOLVED");
    expect(r.esi.source).toBe("none");
  });

  it("treats an unreadable ESI flag as UNRESOLVED, never as 'not applicable'", async () => {
    // db_bill's eligibility columns are known to carry misaligned junk — one row holds an IFSC
    // code and a person's name. Reading that as "no" would silently drop a real contributor from
    // a statutory filing, which is the one direction this must never fail in.
    billQuery.mockResolvedValue([
      { EmpCode: "MAS003", PFELig: "YES", ESIElig: "CNRB0001769" },
    ]);
    const all = await resolveStatutoryApplicabilityForPeriod("2026-07");
    expect(all.get("MAS003")?.esi.status).toBe("UNRESOLVED");
    expect(all.get("MAS003")?.pf.status).toBe("APPLICABLE"); // the good flag still resolves
  });

  it("THROWS when db_bill is unreachable instead of returning an empty population", async () => {
    // A statutory population that silently empties when a remote host is down would read as
    // "nobody is covered this month" — the worst possible failure for a filing.
    billQuery.mockImplementation(async () => {
      throw new Error("ETIMEDOUT");
    });
    await expect(
      resolveStatutoryApplicabilityForPeriod("2026-07"),
    ).rejects.toThrow(/unreachable/i);
  });

  it("rejects a malformed period rather than scanning everything", async () => {
    await expect(
      resolveStatutoryApplicabilityForPeriod("July 2026"),
    ).rejects.toThrow(/YYYY-MM/);
    expect(billQuery).not.toHaveBeenCalled();
  });

  it("contains no wage-threshold inference for either scheme", async () => {
    // ESI coverage is wage-linked and PF has its own rules, but deriving either from salary here
    // would be inventing statutory policy. 21000 and 15000 are the thresholds someone would most
    // plausibly hard-code.
    const src = (await import("node:fs"))
      .readFileSync(
        (await import("node:path")).resolve(
          process.cwd(),
          "src/modules/payroll/statutory-applicability.service.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(
      /15000|15_000|21000|21_000|basic\s*[<>]=?|gross\s*[<>]=?/i,
    );
  });
});

describe("summary keeps unresolved visible", () => {
  it("counts per scheme and does not fold unresolved into not-applicable", () => {
    const rows = [
      {
        employeeCode: "A",
        pf: {
          status: "APPLICABLE" as const,
          source: "db_bill_payroll" as const,
          reason: "",
        },
        esi: {
          status: "NOT_APPLICABLE" as const,
          source: "db_bill_payroll" as const,
          reason: "",
        },
      },
      {
        employeeCode: "B",
        pf: {
          status: "UNRESOLVED" as const,
          source: "none" as const,
          reason: "",
        },
        esi: {
          status: "APPLICABLE" as const,
          source: "hrms_statutory_info" as const,
          reason: "",
        },
      },
    ];
    expect(summariseApplicability(rows, "pf")).toMatchObject({
      applicable: 1,
      notApplicable: 0,
      unresolved: 1,
    });
    expect(summariseApplicability(rows, "esi")).toMatchObject({
      applicable: 1,
      notApplicable: 1,
      unresolved: 0,
    });
  });
});

describe("loadStatutoryNotApplicable - what the payroll ENGINE honours", () => {
  // Aug 2026: db_bill deducts nothing for any employee it flags NO (ESIC 502/502, PF 313/313), yet
  // HRMS deducted ESIC from 91 and PF from 12 of them. Only an explicit NO may switch a deduction
  // off; YES / unreadable leave the engine's own wage rules alone.
  it("returns only the employees explicitly flagged NOT applicable, per scheme", async () => {
    billQuery.mockResolvedValue([
      { EmpCode: "mas001 ", PFELig: "YES", ESIElig: "NO" },
      { EmpCode: "MAS002", PFELig: "NO", ESIElig: "NO" },
      { EmpCode: "MAS003", PFELig: "YES", ESIElig: "YES" },
      { EmpCode: "MAS004", PFELig: "junk", ESIElig: "" },
    ]);
    const r = await loadStatutoryNotApplicable("2026-08");
    expect([...(r?.esi ?? [])].sort()).toEqual(["MAS001", "MAS002"]);
    expect([...(r?.pf ?? [])]).toEqual(["MAS002"]);
  });

  it("includes an approved HRMS opt-out for the month", async () => {
    billQuery.mockResolvedValue([{ EmpCode: "MAS010", PFELig: "YES", ESIElig: "YES" }]);
    execute
      .mockResolvedValueOnce([[], []]) // employee_statutory_info
      .mockResolvedValueOnce([[{ employee_code: "MAS010", override_type: "pf_opt_out" }], []]);
    const r = await loadStatutoryNotApplicable("2026-08");
    expect(r?.pf.has("MAS010")).toBe(true);
    expect(r?.esi.has("MAS010")).toBe(false);
  });

  it("never throws: db_bill unreachable gives null so the run keeps its own rules", async () => {
    billQuery.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(loadStatutoryNotApplicable("2026-08")).resolves.toBeNull();
  });
});

describe("loadStatutoryNotApplicable - assignment flags as the fallback", () => {
  it("uses the active salary assignment only where db_bill / HRMS statutory record could not decide", async () => {
    billQuery.mockResolvedValue([
      { EmpCode: "MAS100", PFELig: "YES", ESIElig: "YES" }, // db_bill decides YES: assignment NO must NOT override
    ]);
    execute
      .mockResolvedValueOnce([[], []]) // employee_statutory_info
      .mockResolvedValueOnce([[], []]) // approved overrides
      .mockResolvedValueOnce([[
        { code: "MAS100", pf_applicable: 0, esi_applicable: 0 }, // db_bill YES wins
        { code: "MAS200", pf_applicable: 0, esi_applicable: 1 }, // db_bill silent: assignment decides PF
        { code: "MAS300", pf_applicable: null, esi_applicable: null }, // unknown stays unknown
      ], []]);
    const r = await loadStatutoryNotApplicable("2026-09");
    expect(r?.pf.has("MAS100")).toBe(false);
    expect(r?.esi.has("MAS100")).toBe(false);
    expect(r?.pf.has("MAS200")).toBe(true);
    expect(r?.esi.has("MAS200")).toBe(false);
    expect(r?.pf.has("MAS300")).toBe(false);
  });
});
